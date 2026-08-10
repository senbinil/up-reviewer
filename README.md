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

Requires Node >= 22.18 (native TypeScript type-stripping).

## How it works

```
npm run review <base> [head]
        │
        ▼
src/workflow/review.ts          fetches `git diff --no-color -U3 <base> [head]`
        │                       (execFile, no shell; raw text, zero parsing)
        ▼
src/agents/reviewer.ts          sandbox-less agent, single validated tool
        │                       `submit_findings` ({findings: [...]})
        ▼
workflow validates the tool     captures the tool call via toolCallId,
output + renders findings       falls back to parsing a JSON reply
```

Design decisions (hard-won):

- **No diff parsing anywhere.** The raw unified diff goes straight to the
  model; stats come free from `git diff --stat`. The original hand-rolled
  parser was both inefficient and buggy (`diffInParts[-1]`), and was removed.
- **Structured output rides on a schema-validated tool call, not free text.**
  The model's most reliable behavior is calling tools; `submit_findings` has a
  valibot `input` schema, so the runner can trust it.
- **No sandbox, no harness, no second model conversation.** Earlier versions
  let the agent run `git` itself and used `harness.prompt({ result })` — the
  scratch conversation inherited the full tool set, so the model wandered
  (75–186 tool batches observed) or answered an empty diff in prose and never
  finished → the CLI hung. Both paths are gone.
- **The CLI cannot hang.** `Reviewer.durability = { timeoutMs: 240_000 }`
  bounds every submission; the workflow's `git` calls have their own timeouts;
  an empty diff short-circuits without a model call.
- **Untrusted diff text is marked as data** in the prompt (injection surface).

## Scripts

| Command | What it does |
| --- | --- |
| `npm run review [-- <base> [head]] [-- --format json]` | Full review of a local git diff. Default output is GitHub-flavored markdown (paste into a PR comment). `--format json` emits `{ summary, comments }` where `comments` match the GitHub review-comments API shape (`path`, `line`, `body`) for scripting. `base` defaults to `HEAD` (working-tree review). |
| `npx flue run src/agents/reviewer.ts -m "<diff text>"` | Interactive/durable agent conversation. The diff must be in the message — the agent has no git or file access. Pass `--id <id>` to continue a conversation. |
| `npx flue run src/agents/hello.ts -m "Hi"` | Sanity check that the provider/API key works. |
| `npm run check:types` | Typecheck (`tsc --noEmit`, strict). |
| `npm test` | Not implemented yet (stub). |

## Finding shape

Validated by `submit_findings` (schema in `src/lib/findings.ts`):

```json
[{
  "file": "src/foo.ts",
  "line": 42,
  "severity": "high | medium | low",
  "title": "short headline",
  "body": "why it matters + suggested fix"
}]
```

- `line` is 1-based in the HEAD revision, computed by the model from the
  `@@` hunk headers; omitted for file-level findings (e.g. missing tests).
- `high` = correctness/security/reliability, `medium` = performance/
  maintainability, `low` = readability/style.

## Current progress

Done:

- [x] Local-git-diff review pipeline (`npm run review`) with validated,
      line-anchored, severity-labeled findings
- [x] Empty-diff fast path, 100 KB diff cap, shell-safe ref validation
      (refs go to `git` as argv, never through a shell)
- [x] Anti-hang guarantees: submission timeout, exec timeouts, no harness
- [x] `check:types` script (was documented but missing) + `valibot` /
      `typescript` deps; Node `engines` guard

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

- [ ] `--post <owner>/<repo> <pr>` mode: POST the review to a GitHub PR
      (`POST /repos/{o}/{r}/pulls/{n}/reviews` with the `comments` array from
      `--format json`; needs `GH_TOKEN`)
- [ ] Wire the `evals/` corpus (10 seeded diffs + expected findings) into an
      automated evaluation of the reviewer
- [ ] Unit tests for `assertGitRef` / `diffBetweenRefs` / `parseFindings`
      and the workflow's capture/render paths (`npm test` is still a stub)
- [ ] Replace the 100 KB cap with chunked reviews of large diffs

## Layout

```
src/
  agents/reviewer.ts     the review agent (sandbox-less, one validated tool)
  agents/hello.ts        boilerplate hello agent (provider sanity check)
  workflow/review.ts     the runner: git diff → dispatch → validate → render
  lib/git-diff.ts        shell-safe `git diff` fetch (execFile, no parsing)
  lib/findings.ts        shared findings schema + tolerant reply parser
  types/review.ts        ReviewFinding types
  db.ts                  SQLite persistence adapter (durable conversations)
evals/                   evaluation fixtures (not wired in yet)
```

## Learn more

- [Flue docs](https://flueframework.com/docs/) — or `npx flue docs` from the
  terminal.
