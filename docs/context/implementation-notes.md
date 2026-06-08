# Implementation notes

## Design decisions

- Product name is `hermes-voice-control`; `hermes-voice-portal` remains
  planning-only.
- The orb is both status indicator and primary input control.
- Hands-free and hold-to-talk are complementary modes.
- Tap starts, pauses, or resumes. Hold captures a longer thought. Holding while
  the Hermes agent is speaking is the interrupt/barge-in gesture.
- No visible Interrupt button and no default PIN wall for direct localhost
  development. Tailscale Serve should use PIN/session auth.
- Transcript drawer and floating text fallback are first-class.
- Backend defaults to mock Gemini and mock Hermes so local development cannot
  accidentally spend API quota or mutate local systems.
- FastAPI is used because the local Hermes adapter path is Python-native.
- Confirmation approval records intent only. No real external action execution
  is wired to approvals.

## Current implementation

- Browser UI is wired to `GeminiLiveSession`.
- Browser receives only backend-issued Gemini ephemeral tokens, never long-lived
  Gemini/Google API keys.
- Browser audio worklets capture PCM, resample to Gemini input requirements, and
  play Gemini PCM output.
- Gemini Live protocol support is split across a public `geminiLive.ts` facade
  plus focused `gemini-live/` modules for types, defaults, protocol helpers,
  and tool-call normalization.
- Gemini Live setup normalizes model names to the `models/<model>` resource
  form.
- Gemini Live client sends `audioStreamEnd` when finalizing captured audio.
- Gemini Live tool calls are routed through backend `/tools/call` with an
  allowlist.
- Backend supports cancellable agent-answer tool calls, `propose_action`
  confirmation records, and `/tools/cancel`.
- Canonical tool/state identifiers use `ask_agent`, `agent-thinking`,
  `agent-speaking`, and transcript role `agent`. The backend still accepts
  `ask_bob` as a compatibility alias for older clients.
- Backend exposes `/readyz` for safe readiness checks. It verifies database
  writeability and fails when real Gemini mode is configured without an API key.
- Backend prunes audit logs at startup with `HVC_AUDIT_LOG_RETENTION_DAYS` and
  `HVC_AUDIT_LOG_MAX_ROWS`.
- `/logs` is disabled by default and only available with
  `HVC_ALLOW_LOGS_ENDPOINT=true`.
- PIN session cookies can be marked secure with `HVC_SECURE_COOKIES=true` for
  HTTPS/private reverse-proxy deployments.
- Mock Gemini mode can smoke-test the local app and token broker without real
  Gemini credentials.
- Real Gemini Live requires `HVC_GEMINI_MODE=real`, `google-genai`, and a Gemini
  API key in the backend environment. The constrained Live model is configurable
  with `HVC_GEMINI_MODEL`.
- No-PIN remote/proxy access is blocked unless explicitly overridden; Tailscale
  Serve should use PIN/session auth.
- `LocalHermesAdapter` launches Hermes with a direct argv, safe toolset, timeout
  handling, cancellation handling, and launch-error handling.
- Root operator scripts now include `pnpm dev`, `pnpm env:check`,
  `pnpm smoke:browser`, `pnpm screenshots:update`, and `pnpm perf:budget`.

## Tradeoffs

- Custom CSS is used instead of Tailwind to avoid generic dashboard aesthetics.
- SQLite uses stdlib `sqlite3` instead of an ORM to keep the backend small and
  auditable.
- PIN auth is intentionally simple for a one-user private app, with server-side
  sessions and rate limits when enabled.
- The real Gemini websocket/audio path is unit-tested, browser-wired, and has a
  credentialed live smoke test in the active spec evidence.

## Fresh verification notes

- 2026-06-07: `pnpm test` passed. Web: 4 files / 26 tests. Backend: 21 tests
  with one Starlette/httpx deprecation warning.
- 2026-06-07: `pnpm build` passed. Vite production build emitted about 216 KB JS
  and 7 KB CSS before gzip.
- 2026-06-07: `tomoji docs index --verify --json` passed with `inSync: true`.
- 2026-06-07: `tomoji docs audit --json` passed with zero findings.
- 2026-06-07: public repo target selected:
  `https://github.com/elijahmuraoka/hermes-voice-control`.
- 2026-06-07: public copy and visible app labels were generalized to a
  configurable Hermes agent name via `VITE_HVC_AGENT_NAME`.
- 2026-06-07: README screenshots were regenerated from local Vite using Chrome
  DevTools Protocol at 390x844 and 1280x900. The README now embeds one mobile
  screenshot and one desktop screenshot.
- 2026-06-07: after the generalization pass, `pnpm test`, `pnpm build`,
  `tomoji docs index --verify --json`, `tomoji docs audit --json`, and
  `git diff --check` passed.
- 2026-06-07: GitHub issues #1-#10 were created from a production-readiness
  audit covering CI, browser smoke, real Gemini validation, auth/log hardening,
  generic internal ids, dependency pinning, runbooks, observability, UX
  budgets, and action semantics.
- 2026-06-07: CI workflow runs `pnpm test`, `pnpm build`,
  `pnpm smoke:browser`, and `pnpm docs:verify`. Root `@playwright/test`,
  repo-contained docs verification, and Dependabot config were added.
- 2026-06-07: `pnpm smoke:browser` passed four responsive viewport tests and
  skipped only the explicitly gated real backend token-flow test.
- 2026-06-07: after auth/readiness hardening, `pnpm test` passed. Web: 4 files /
  26 tests. Backend: 26 tests with one Starlette/httpx deprecation warning.
- 2026-06-07: `pnpm build`, `pnpm docs:verify`, and `tomoji docs audit --json`
  passed after productionization changes.
- 2026-06-07: follow-up productionization added generic agent identifiers,
  private-network runbook/env validation, startup audit-log pruning, DB
  writeability readiness, reduced-motion/focus browser checks, screenshot
  update script, bundle budget, read-only v1 action semantics, and configurable
  `HVC_GEMINI_MODEL`.
- 2026-06-07: follow-up verification passed `pnpm env:check`, `pnpm verify`,
  `tomoji docs index --verify --json`, `tomoji docs audit --json`,
  `pnpm smoke:browser`, and `git diff --check`.
- 2026-06-08: real Gemini Live smoke passed against a loopback backend started
  with `HVC_GEMINI_MODE=real` and the `real-gemini` optional dependency. The
  script waited for the Live `setupComplete` handshake, observed real audio
  output, and stored redacted evidence in the active spec.

## Remaining gaps

- Decide the default Gemini voice/personality guidance for Hermes agents once
  real audio is enabled.
- Do a final independent review after credentialed real Gemini Live smoke.
