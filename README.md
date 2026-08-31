# up-reviewer

A [Flue](https://flueframework.com) agent that reviews local git diffs and
reports **structured, line-anchored findings** (file, line, severity, title,
body). Built for the "review your change before you commit" loop, and later
for GitHub PR review.

## Quick start

```sh
npm install
# .env must contain a provider key, e.g. DEEPSEEK_API_KEY=...

npm run review              # review the working tree vs HEAD
npm run review -- 8592245   # review the working tree vs a commit
npm run review -- main feature/x   # review a branch diff
npm run review -- --format json main feature/x   # API-ready JSON
```

Requires Node >= 24 (native TypeScript type-stripping).

## Model Configuration

The agent reads its model and provider from environment variables, with sensible
defaults. Built-in providers work out of the box; custom providers (e.g., Mimo,
Ollama) are registered dynamically.

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `AGENT_MODEL` | No | `deepseek/deepseek-v4-flash` | Model specifier (`provider/model-id`) |
| `AGENT_PROVIDER_ID` | No | Extracted from `AGENT_MODEL` | Override provider ID for custom providers |
| `AGENT_PROVIDER_BASE_URL` | No* | — | Base URL for custom providers (*required for custom providers) |
| `AGENT_PROVIDER_API` | No | `openai-completions` | Wire protocol: `openai-completions` or `anthropic-messages` |
| `AGENT_API_KEY` | No | — | API key for custom providers |
| `AGENT_MODEL_MAX_TOKENS` | No | `8192` | Max output tokens |
| `AGENT_MODEL_CONTEXT_WINDOW` | No | `1000000` | Context window size (1M) |
| `AGENT_MODEL_REASONING` | No | `false` | Enable reasoning/thinking (`true`/`false`) |

### Built-in Providers

No extra configuration needed — just set the provider's API key:

```bash
# DeepSeek (default)
DEEPSEEK_API_KEY=sk-xxx npm run review

# Anthropic
ANTHROPIC_API_KEY=sk-ant-xxx AGENT_MODEL=anthropic/claude-sonnet-4-6 npm run review

# OpenAI
OPENAI_API_KEY=sk-xxx AGENT_MODEL=openai/gpt-5.5 npm run review
```

### Custom Providers

For providers not in the built-in set (Mimo, Ollama, etc.), register dynamically:

```bash
AGENT_MODEL=mimo/mimo-model-id \
  AGENT_PROVIDER_BASE_URL=https://api.mimo.example.com/v1 \
  AGENT_API_KEY=sk-xxx \
  AGENT_MODEL_MAX_TOKENS=16384 \
  AGENT_MODEL_CONTEXT_WINDOW=256000 \
  AGENT_MODEL_REASONING=true \
  npm run review
```

See `.env.example` for a template.

## Install

```sh
npm install up-reviewer
```

Published at [npmjs.com/package/up-reviewer](https://www.npmjs.com/package/up-reviewer).

## GitHub Actions

The agent reviews every PR automatically via a GitHub Actions workflow.

**Setup:**
1. Add `AGENT_API_KEY` (or provider key like `XIAOMI_API_KEY`) as a repository secret
2. Drop [samples/review-pr.yml](samples/review-pr.yml) into `.github/workflows/`
3. Push to the default branch — it activates on the next PR

The workflow uses `pull_request_target` so only base-branch code runs with secrets.
Fork PRs are skipped. After each run, it verifies a review was actually posted
and fails loudly otherwise.

## CI

`.github/workflows/ci.yml` runs `npm run check:types` and `npm test` on
every push to any branch and on pull requests (opened/reopened only —
every PR update is a push, so `synchronize` would be a duplicate). It
runs on Node 24 (read from `.nvmrc`), carries no secrets — permissions are read-only contents.

Concurrency is grouped per branch with `cancel-in-progress`: a new push
cancels the in-flight run from the previous commit on the same branch, so
CI never backs up behind stale runs. Docs-only pushes (markdown) skip CI
to save runner minutes.

Fork PRs are un-gated (GitHub denies repository secrets to fork runs +
the read-only token is the real boundary, not an inline `if:` that a fork
can delete from its copy).

## How it works

Local CLI:

```
npm run review <base> [head]
        │
        ▼
src/workflow/review.ts          loads src/app.ts (provider registration)
        │                       fetches `git diff --no-color -U3 <base> [head]`
        │                       (execFile, no shell; raw text, zero parsing)
        ▼
src/agents/reviewer.ts          sandbox-less review, single validated tool
        │                       `submit_findings` ({findings: [...]})
        ▼
workflow validates the tool     captures the tool call via toolCallId,
output + renders findings       falls back to parsing a JSON reply
```

GitHub Actions (same agent, different mode):

```
PR opened/synchronized
        │
        ▼
.github/workflows/pr-review.yml  `npx flue run src/agents/reviewer.ts`
        │                         with GH_TOKEN + AGENT_API_KEY env
        ▼
src/agents/reviewer.ts           GITHUB ACTIONS MODE: `fetch_pr_diff` loads
        │                         the PR diff via `gh pr diff`; the agent
        ▼                         reviews it
`post_review` tool               validates findings, POSTs a PR review
                                 (event COMMENT + inline comments) via `gh api`
```

Design decisions (hard-won):

- **No diff parsing anywhere.** The raw unified diff goes straight to the
  model; stats come free from `git diff --stat`. The original hand-rolled
  parser was both inefficient and buggy (`diffInParts[-1]`), and was removed.
- **Structured output rides on a schema-validated tool call, not free text.**
  The model's most reliable behavior is calling tools; `submit_findings` has a
  valibot `input` schema, so the runner can trust it. The same schema gates
  `post_review` before anything is sent to GitHub.
- **No sandbox, no gh tools for LOCAL MODE.** The `submit_findings`-only
  configuration is what the CLI was designed with: a crafted inline diff
  cannot steer the model into GitHub writes, because the tools that could do
  so are simply not registered. Under GitHub Actions the gh-backed
  `fetch_pr_diff` / `post_review` tools are registered — narrow and
  schema-validated, never an open-ended model-directed shell, and the token
  never reaches the model. Mode is decided by the `GITHUB_ACTIONS` env var,
  never by parsing the (untrusted) user message.
- **The CLI cannot hang.** `Reviewer.durability = { timeoutMs: 240_000 }`
  bounds every submission; the workflow's `git` calls have their own timeouts;
  an empty diff short-circuits without a model call.
- **Untrusted diff text is marked as data** in the prompt (injection surface).

## Current progress

Done:

- [x] Local-git-diff review pipeline (`npm run review`) with validated,
      line-anchored, severity-labeled findings
- [x] Empty-diff fast path, 100 KB diff cap, shell-safe ref validation
      (refs go to `git` as argv, never through a shell)
- [x] Anti-hang guarantees: submission timeout, exec timeouts, no harness
- [x] `check:types` script (was documented but missing) + `valibot` /
      `typescript` deps; Node `engines` guard
- [x] GitHub Actions workflow (`.github/workflows/pr-review.yml`): reviews
      every same-repo PR on open/synchronize and posts the findings as a PR
      review (event `COMMENT` with inline comments) via `gh`, using
      `GITHUB_TOKEN`; triggered as `pull_request_target` with a base-branch
      checkout so PR-controlled code never runs with secrets (fork PRs are
      skipped — under `pull_request_target` they would receive repo secrets);
      mode and tools are gated on the `GITHUB_ACTIONS` env (no gh tools in
      LOCAL MODE — no injection surface, no model-directed shell, token never
      exposed to the model); the PR number comes from the workflow env, never
      from the model
- [x] `post_review` resilience: `line >= 1` schema constraint; if inline
      comments are rejected by GitHub (422), the review falls back to a
      body-only summary so the review still lands
- [x] Unit tests for `assertGitRef` / `diffBetweenRefs` / `parseFindings` and
      the render paths, run via `npm test` (`node --test`, colocated in
      `src/lib/*.test.ts`)
- [x] CI workflow (`.github/workflows/ci.yml`): runs `check:types` and
      `npm test` on every push and PR, with per-branch concurrency -
      cancellation so CI never backs up behind stale runs
- [x] Template-based response format (`templates/`): summary, finding, and
      inline-comment output is rendered from plain-text markdown templates;
      the format can be restyled without touching code
- [x] Schema-enforced brevity: `title` capped at 100 chars, `body` at 300
      chars — the model's tool call is rejected if a finding exceeds the cap,
      so reviews stay short and focused
- [x] Dynamic model/provider configuration: model and provider are read from
      env vars (`AGENT_MODEL`, `AGENT_PROVIDER_BASE_URL`, etc.); built-in
      providers work out of the box, custom providers are registered
      dynamically via `src/app.ts`

Known limitations:

- `git diff` only sees **tracked** changes — untracked files are invisible to
  a working-tree review. Run `git add -N <file>` to include them.
- Findings are AI output: useful, but fallible (the agent itself produced a
  false-positive "high" on a lockfile during testing). Treat output as review
  *input*, not verdict.
- Model behavior is nondeterministic; the pipeline is designed so that any
  reply (tool call, JSON, prose) degrades gracefully instead of hanging.
- Each `npm run review` uses a fresh conversation instance (no stale history).

## Next steps

- [ ] Replace the 100 KB cap with chunked reviews of large diffs
- [ ] Rebuild a quality-eval harness: seeded diffs with golden findings
      compared against the agent's output on every run (the `evals/` corpus
      exists but is not wired into an automated harness yet)
- [ ] Support fork PRs (they are skipped today because fork runs do not receive
      repository secrets)
- [ ] Publish as an npm package and GitHub Actions reusable workflow
      (see `feature/npm-package` — `package.json` has `bin`, `files`, `exports`;
      needs `npm publish` + a `workflow_call` trigger on `pr-review.yml`)
- [ ] User-supplied review skills: scan `.agents/skills/` (or `--skills-dir`)
      before dispatch, inject discovered `SKILL.md` files into the system prompt
      so teams can layer on project-specific review rules without changing the
      agent code

## Learn more

- [Flue docs](https://flueframework.com/docs/) — or `npx flue docs` from the
  terminal.
