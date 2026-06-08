# Acceptance Tests

## Required Before Shipping

- `pnpm test`
- `pnpm build`
- `pnpm perf:budget`
- `pnpm docs:verify`
- `tomoji docs index --verify`
- `tomoji docs audit`
- `pnpm smoke:browser`

- With real Gemini credentials configured on the backend, run:

```bash
node scripts/e2e-real-gemini-live.mjs
```

## Current Evidence

- 2026-06-07: `pnpm test` passed. Web: 4 files / 26 tests. Backend: 21 tests
  with one Starlette/httpx deprecation warning.
- 2026-06-07: `pnpm build` passed.
- 2026-06-07: `tomoji docs index --verify --json` passed with
  `inSync: true`.
- 2026-06-07: `tomoji docs audit --json` passed with zero findings.
- 2026-06-07: public repo target selected:
  `https://github.com/elijahmuraoka/hermes-voice-control`.
- 2026-06-07: README screenshots regenerated from local Vite with Chrome
  DevTools Protocol at 390x844 and 1280x900 after the public copy was
  generalized to a configurable Hermes agent.
- 2026-06-07: `git diff --check` passed and README references exactly one
  mobile screenshot plus one desktop screenshot.
- 2026-06-07: GitHub production issues #1-#10 were created from the audit.
- 2026-06-07: `@playwright/test` was added at the workspace root and
  `pnpm smoke:browser` now starts Vite, runs four responsive viewport tests,
  and skips the real backend token-flow test unless explicitly enabled.
- 2026-06-07: `pnpm test` passed after auth/readiness hardening. Web: 4 files /
  26 tests. Backend: 26 tests with one Starlette/httpx deprecation warning.
- 2026-06-07: `pnpm build`, `pnpm docs:verify`, `pnpm smoke:browser`, and
  `tomoji docs audit --json` passed after CI/smoke/backend changes.
- 2026-06-07: follow-up tests added backend audit-log pruning coverage,
  canonical `ask_agent` coverage with `ask_bob` alias coverage, browser
  keyboard/focus checks, reduced-motion checks, and bundle-budget verification.
- 2026-06-07: follow-up verification passed `pnpm env:check`, `pnpm verify`,
  `tomoji docs index --verify --json`, `tomoji docs audit --json`,
  `pnpm smoke:browser`, and `git diff --check`.
- 2026-06-08: issue #15 security gate added the production threat register,
  local security review artifact, cookie-only PIN login response, metadata-only
  free-text tool audit logging, real Gemini token-constraint coverage, and
  audit-leak regression tests.
- 2026-06-08: targeted backend gate passed with `uv run --extra dev pytest`
  before the root dependencies were restored: 34 tests, with the existing
  Starlette/httpx deprecation warning.
- 2026-06-08: `pnpm test`, `pnpm env:check`, `pnpm docs:verify`,
  `tomoji docs index --verify --json`, `tomoji docs audit --json`,
  `git diff --check`, and `pnpm verify` passed. `pnpm verify` covered web 27
  tests, backend 34 tests, web build, performance budget, and docs verify.
- 2026-06-08: independent external review attempts were blocked by local
  `agent-comms`/OpenClaw configuration and by rejected external Claude export
  approval. Treat strict independent review as a remaining pre-merge blocker
  unless the user explicitly approves external review or local review tooling is
  repaired.
