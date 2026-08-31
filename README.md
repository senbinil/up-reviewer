# up-github-agents

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

## Requirements

**Node >= 24.** The package ships TypeScript sources and runs them directly on
Node's native type-stripping — there is no build/compile step. The
`review-diff` bin and all `npm run` scripts therefore need a Node version that
strips types at runtime; older LTS releases are not supported. `package.json`
declares `"engines": { "node": ">=24.0.0" }` (npm warns on install if your
Node is older) and `.nvmrc` pins 24.

## Review pull requests on GitHub Actions

The same agent runs as a GitHub Actions workflow that posts a review to every
pull request:

- `.github/workflows/pr-review.yml` triggers on `pull_request_target`
  (opened and synchronize), runs `npx flue run src/agents/reviewer.ts --message
  "Review pull request #N"`, and grants `pull-requests: write` so the review
  lands.
- `pull_request_target` (not `pull_request`) deliberately: the workflow and
  its `npm ci` / agent code come from the base branch, never from the PR's
  merge commit — a PR author cannot rewrite the workflow to exfiltrate
  `DEEPSEEK_API_KEY`. The reviewer gets the diff over the API (`gh pr
  diff`) and never executes PR code. Consequence: the workflow only activates
  once it exists on the default branch, so the PR that introduces it is not
  auto-reviewed.
- The agent runs in GITHUB ACTIONS MODE (decided by the environment, not by
  the message): it fetches the PR diff with `gh pr diff` (via the
  `fetch_pr_diff` tool), reviews it, and posts the findings as a PR review
  (event `COMMENT`) with inline comments via `post_review`.
- After the run, the workflow verifies via the API that a review was actually
  submitted by this run (comparing `submitted_at` to the job start) and fails
  the job loudly otherwise — a model that replies in prose instead of posting
  is a visible failure, not a silent no-op.
- Add `DEEPSEEK_API_KEY` as a repository secret. `GITHUB_TOKEN` is provided
  automatically and passed as `GH_TOKEN`; the gh-backed tools read it from
  `process.env` — the model never sees the token (Flue docs' "tighter
  boundary" pattern: a narrow tool reads the secret, the agent only sees
  parameters and results).

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
src/workflow/review.ts          fetches `git diff --no-color -U3 <base> [head]`
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
        │                         with GH_TOKEN + DEEPSEEK_API_KEY env
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

## Scripts

| Command | What it does |
| --- | --- |
| `npm run review [-- <base> [head]] [-- --format json]` | Full review of a local git diff. Default output is GitHub-flavored markdown (paste into a PR comment). `--format json` emits `{ summary, comments }` where `comments` match the GitHub review-comments API shape (`path`, `line`, `body`) for scripting. `base` defaults to `HEAD` (working-tree review). |
| `npx flue run src/agents/reviewer.ts -m "<diff text>"` | LOCAL MODE: interactive/durable agent conversation. The diff must be in the message — the agent reviews it and calls `submit_findings`. Pass `--id <id>` to continue a conversation. |
| `npx flue run src/agents/reviewer.ts -m "Review pull request #N"` | GITHUB ACTIONS MODE (runs under `.github/workflows/pr-review.yml`; requires the Actions env): the agent fetches the PR diff and posts the review to the PR via `gh api`. |
| `npx flue run src/agents/hello.ts -m "Hi"` | Sanity check that the provider/API key works. |
| `npm run check:types` | Typecheck (`tsc --noEmit`, strict). |
| `npm test` | Unit tests via `node --test` (colocated as `src/lib/*.test.ts`). |

## Finding shape

Validated by `submit_findings` (schema in `src/lib/findings.ts`):

```json
[{
  "file": "src/foo.ts",
  "line": 42,
  "severity": "high | medium | low",
  "title": "short headline",
  "body": "problem + suggested fix"
}]
```

- `line` is 1-based in the HEAD revision, computed by the model from the
  `@@` hunk headers; omitted for file-level findings (e.g. missing tests).
- `high` = correctness/security/reliability, `medium` = performance/
  maintainability, `low` = readability/style.
- The model is instructed to keep `title` under ~8 words and `body` to
  1-2 sentences (problem + fix), so reviews stay short and focused. The
  schema also hard-enforces these limits (`v.maxLength(100)` for `title`,
  `v.maxLength(300)` for `body`) — a tool call with a finding that exceeds
  them is rejected, and the model retries shorter.

## Response templates

The human- and API-facing output is rendered from plain-text templates in
`templates/`, so the format can be changed without touching code. Each
`{{placeholder}}` is substituted by `src/lib/render.ts`; unknown
placeholders render empty. Model-produced text is sanitized before
substitution (control characters stripped), so templates can't be used to
smuggle terminal escapes or invalid paths.

| Template | Used for | Placeholders |
| --- | --- | --- |
| `templates/review.summary.md` | The whole report (local CLI output + PR review body) | `{{count}}`, `{{high}}`, `{{medium}}`, `{{low}}`, and **`{{findings}}`** — the finding blocks joined by blank lines |
| `templates/review.finding.md` | One block per finding, repeated inside `{{findings}}` | `{{severity_label}}` (emoji + name), `{{severity}}` (raw), `{{file}}`, `{{line}}`, `{{anchor}}` (`` `file:line` `` or `` `file` ``), `{{title}}`, `{{body}}` |
| `templates/review.comment.md` | The body of each GitHub inline review comment | same per-finding placeholders |
| `templates/review.clean.md` | Rendered when the review found nothing to report | (none) |

To restyle output, edit the templates — e.g. switch `{{severity_label}}` to
`{{severity}}` for plain text, or change the header line in the summary
without touching `render.ts`.

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

## Layout

```
src/
  agents/reviewer.ts     the review agent (LOCAL MODE + GITHUB ACTIONS MODE,
                         tools: submit_findings / fetch_pr_diff / post_review)
  agents/hello.ts        boilerplate hello agent (provider sanity check)
  workflow/review.ts     the local runner: git diff → dispatch → validate → render
  lib/git-diff.ts        shell-safe `git diff` fetch (execFile, no parsing)
  lib/findings.ts        shared findings schema + tolerant reply parser
  lib/render.ts          template-based output rendering (markdown + GitHub payload)
  types/review.ts        ReviewFinding types
  db.ts                  SQLite persistence adapter (durable conversations)
  lib/*.test.ts          unit tests for the lib modules (npm test → node --test)
.github/workflows/       pr-review.yml + ci.yml — review every PR; CI on every push
evals/                   seeded diffs + golden reviews (not wired in yet)
templates/               response format templates (summary, finding, comment, clean)
```

## Learn more

- [Flue docs](https://flueframework.com/docs/) — or `npx flue docs` from the
  terminal.
