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
- 2026-06-08: issue #12 provider bakeoff docs decision was added at
  `docs/context/research/realtime-provider-bakeoff.md`. It keeps Gemini Live as
  the v1 default and marks credentialed Gemini plus alternate-provider smoke as
  pending until credentials are available.
- 2026-06-08: #14/#19 verification passed `pnpm docs:verify`,
  `tomoji docs index --verify --json`, `tomoji docs audit --json`,
  `pnpm env:check`, `pnpm verify`, `pnpm smoke:browser`, and
  `git diff --check`. `pnpm verify` passed after applying the README server
  setup step `uv pip install -e '.[dev]'`; the first attempt only failed
  because `pytest` was not installed in the fresh worktree venv.
- 2026-06-08: unsafe env probes failed as expected for wildcard
  `HVC_FRONTEND_ORIGINS`, `HVC_ALLOW_NO_PIN_REMOTE=true`, non-local host
  without PIN, weak PIN, and real Gemini mode without a key.
- 2026-06-08: local private-deployment mock rehearsal passed with PIN required,
  logs disabled, `/healthz` 200, `/readyz` 200, unauthenticated
  `/auth/session` 401, and PIN login 200. Tailscale Serve live mutation remains
  blocked until the local Tailscale CLI can load preferences and the operator
  approves the exact Serve change.
- 2026-06-08: open-source scan found no untracked non-ignored files, no tracked
  private env/log/SQLite/transcript paths beyond `.env.example`, no historical
  private artifact paths beyond `.env.example`, and no high-entropy token
  history hits. Current scan hits were limited to documented placeholders,
  environment variable names, cookie field names, and fake-secret tests.
