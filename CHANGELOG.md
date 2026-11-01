# Changelog

## [0.4.0](https://github.com/senbinil/up-reviewer/compare/v0.3.1...v0.4.0) (2026-11-01)

### ⚠ BREAKING CHANGES

* **node:** Minimum runtime is now Node.js 24.22.2, and 25.x plus 26.0–26.12.0
  are excluded. The Brotli decoder bundled in those releases allows an
  out-of-bounds write on malformed input (CVE-2026-111497), reachable from
  `node:zlib`; patched in 22.23.4, 24.22.1 and 26.12.1.

  Before:
  ```json
  "engines": { "node": ">=24.0.0" }
  ```

  After:
  ```json
  "engines": { "node": "^24.22.2 || >=26.12.1" }
  ```

### Security

* Require a patched Node runtime (CVE-2026-111497)
* Read the Node version from `.nvmrc` in the publish workflow instead of a
  hardcoded `24`

### Features

* Bump `@flue/runtime` and `@flue/cli` from 2.0.3 to 2.3.0

### CI

* Enable Dependabot version updates for npm and GitHub Actions
* Skip the review agent on Dependabot PRs

### Documentation

* Document the optional Context7 MCP variables (`CONTEXT7_API_KEY`,
  `CONTEXT7_URL`) in `.env.example`

## [0.3.1](https://github.com/senbinil/up-reviewer/compare/v0.3.0...v0.3.1) (2026-09-02)

### Features

* Increase default context window from 128K to 1M tokens for modern models

### Refactor

* Extract local and GitHub Actions modes into separate modules (`local.ts`, `github.ts`)
* Extract tool-call tracking into reusable `tool-tracker.ts`
* Add `parseArgs` tests for CLI argument parsing

### CI

* Bump publish workflow actions to v7
* Audit cleanup — align all workflows to v7 actions

### Documentation

* Fix README instructions for npm users

## [0.3.0](https://github.com/senbinil/up-reviewer/compare/v0.2.0...v0.3.0) (2026-09-02)

### ⚠ BREAKING CHANGES

* **bin:** The CLI command has been renamed from `review-diff` to `review`.

  Before:
  ```sh
  npx review-diff
  npx review-diff 8592245
  ```

  After:
  ```sh
  npx review
  npx review 8592245
  ```

### Features

* **bin:** rename command from `review-diff` to `review` for simpler usage

### Documentation

* Fix README instructions for npm users
* Add notes clarifying npm package vs source repo usage
* Update GitHub Actions section to note source repo requirement
* Update all examples to use `npx review`

## [0.2.0](https://github.com/senbinil/up-reviewer/compare/v0.1.0...v0.2.0) (2026-09-01)

### Features

* GitHub Actions workflow for automated PR reviews
* Dynamic model/provider configuration via environment variables
* Template-based response format
* Schema-enforced brevity for findings

## [0.1.0](https://github.com/senbinil/up-reviewer/releases/tag/v0.1.0) (2026-08-31)

Initial release.

### Features

* Local git diff review pipeline
* Line-anchored, severity-labeled findings
* Empty-diff fast path and 100 KB diff cap
* Anti-hang guarantees with submission timeout
