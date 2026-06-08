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
# Terminal 1
cd apps/server
export HVC_GEMINI_MODE=real
export GEMINI_API_KEY=<redacted>
uv run --extra dev --extra real-gemini uvicorn app.main:app --host 127.0.0.1 --port 8765

# Terminal 2, from the repo root
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
- 2026-06-08: issue #16 adds CI-safe fake-process tests for the local Hermes
  bridge contract: `ask_agent`, `ask_bob`, cancellation, timeout,
  malformed/empty output, local binary readiness, safe toolsets, and read-only
  prompt/no-action semantics.
- 2026-06-08: live real-Hermes evidence is written by the opt-in harness to
  `docs/specs/active/2026-06-07-hvc-hardening-live-verification/evidence/hermes-bridge-harness-latest.json`.
- 2026-06-08: local harness run resolved `/opt/homebrew/bin/hermes` and invoked
  `hermes chat -Q -q <read-only prompt> --toolsets safe`. The refreshed run
  passed `ask_agent`, `ask_bob`, and no-action probes with `blocker: null`.
- 2026-06-08: local adapter output now uses Hermes quiet query mode so stdout is
  already the final answer text; browser and harness evidence do not receive
  terminal banners, prompt echoes, or resume metadata.
- 2026-06-08: issue #16 verification passed `pnpm env:check`, `pnpm verify`
  (web: 4 files / 27 tests; backend: 46 tests with one Starlette/httpx
  deprecation warning), `tomoji docs index --verify --json`,
  `tomoji docs audit --json`, and `git diff --check`.
- 2026-06-08: real Gemini Live smoke passed against a loopback backend started
  with `HVC_GEMINI_MODE=real` and `uv run --extra dev --extra real-gemini`.
  The smoke obtained a backend-issued ephemeral token, opened the Gemini Live
  websocket, waited for `setupComplete`, streamed generated local speech audio,
  and observed audio output. Redacted evidence is stored in
  `evidence/gemini-live-smoke-latest.json`.
- 2026-06-08: issue #13 provider-neutral frontend boundary added under
  `apps/web/src/realtime/`; Gemini remains the only registered v1 provider.
