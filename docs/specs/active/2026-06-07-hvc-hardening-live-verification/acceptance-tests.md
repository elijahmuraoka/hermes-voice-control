# Acceptance Tests

## Required Before Shipping

- `pnpm test`
- `pnpm build`
- `pnpm perf:budget`
- `pnpm docs:verify`
- `HVC_REAL_HERMES_HARNESS=1 HVC_HERMES_ADAPTER=local pnpm hermes:harness`
  when a trusted local Hermes runtime is available.
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
- 2026-06-08: issue #16 adds CI-safe fake-process tests for the local Hermes
  bridge contract: `ask_agent`, `ask_bob`, cancellation, timeout,
  malformed/empty output, local binary readiness, safe toolsets, and read-only
  prompt/no-action semantics.
- 2026-06-08: live real-Hermes evidence is written by the opt-in harness to
  `docs/specs/active/2026-06-07-hvc-hardening-live-verification/evidence/hermes-bridge-harness-latest.json`.
- 2026-06-08: local harness run resolved `/opt/homebrew/bin/hermes` and invoked
  `hermes chat -q <read-only prompt> --toolsets safe`, but the real Hermes
  runtime returned CLI failure output for `ask_agent`, `ask_bob`, and no-action
  probes. The recorded blocker is `HERMES_AGENT_FAILURE`.
- 2026-06-08: issue #16 verification passed `pnpm env:check`, `pnpm verify`
  (web: 4 files / 27 tests; backend: 35 tests with one Starlette/httpx
  deprecation warning), `tomoji docs index --verify --json`,
  `tomoji docs audit --json`, and `git diff --check`.
