# Implementation Map

## Backend

- `apps/server/app/config.py`: bind/auth settings, weak PIN checks, safe default
  Hermes binary, and no-PIN remote override controls.
- `apps/server/app/main.py`: session/auth dependencies, remote/proxy guard, and
  `/tools/cancel`, and local Hermes readiness diagnostics. Successful PIN login
  sets the HttpOnly session cookie without returning the raw session token in
  JSON.
- `apps/server/app/store.py`: confirmation request ids and tool-call
  cancellation persistence.
- `apps/server/app/tools.py`: allowlisted tools, cancellable `ask_agent`
  requests, `ask_bob` compatibility alias, confirmation records, and
  cancellation checks. Audit logs for free-text tool traffic persist metadata
  rather than raw prompts, transcript windows, agent answers, or confirmation
  summaries.
- `apps/server/app/adapters.py`: mock/local Hermes adapters, direct argv launch,
  safe toolset, readiness diagnostics, timeout/cancel/error handling, and
  malformed empty-output handling. Local Hermes uses quiet chat query mode so it
  keeps final-answer stdout without bypassing Hermes approval semantics.
- `apps/server/app/gemini.py`: mock and real Gemini token brokerage, including
  one-use constrained real Live tokens.
- `apps/server/tests/test_backend.py`: auth, remote guard, token brokerage,
  audit-log leakage, local Hermes adapter/harness contract, confirmation, and
  cancellation coverage.

## Frontend

- `apps/web/src/geminiLive.ts`: Gemini Live session orchestration, model resource
  normalization, audio finalization, local diagnostics events, tool-call
  cancellation, and late-response suppression.
- `apps/web/src/diagnostics.ts`: local redacted diagnostics recorder, summaries,
  and launch-budget access for browser smoke/provider bakeoff.
- `apps/web/src/diagnosticsBudgets.json`: shared launch budgets for first audio,
  tool response, reconnect/resume, and smoke flake rate.
- `apps/web/src/realtime/`: provider-neutral frontend voice contract and Gemini
  adapter boundary for status/transcript normalization.
- `apps/web/src/gemini-live/defaults.ts`: default tool schemas and tool caller
  cancellation hooks.
- `apps/web/src/audio.ts` and worklets: capture/playback/resampling path.
- `apps/web/src/stateMachine.ts`: voice control state transitions.
- `apps/web/src/App.tsx` and components/styles: mobile layout, no visible
  interrupt/PIN controls, transcript and text fallback.

## Verification Scripts

- `scripts/browser-responsive.spec.ts`: Playwright responsive smoke plus real
  backend token-flow check and diagnostics privacy/budget assertions.
- `scripts/e2e-real-gemini-live.mjs`: real Gemini Live websocket/audio smoke.
- `scripts/validate-env.mjs`: fail-closed environment checks for private
  exposure, PIN strength, Gemini/local-Hermes prerequisites, and wildcard CORS.
- `scripts/run-local-hermes-harness.py`: opt-in real local Hermes bridge harness
  that records redacted read-only evidence when `HVC_REAL_HERMES_HARNESS=1`.

## Release And Deployment Docs

- `docs/context/runbooks/private-network.md`: localhost-first private deployment
  rehearsal, Tailscale Serve approval path, health checks, rollback, and
  evidence redaction.
- `docs/context/tailscale-private-exposure.md`: concise Tailscale Serve posture
  and PIN-required exposure constraints.
- `docs/context/open-source-boundary.md`: fresh-checkout mock gate,
  secret/history scan checklist, redaction rules, and v1.0 release checklist.

## Security Artifacts

- `docs/context/security-model.md`: system threat model, production hardening
  gate, and high/medium risk disposition table.
- `docs/specs/active/2026-06-07-hvc-hardening-live-verification/reviews/2026-06-08-security-review.md`:
  issue #15 security-focused review artifact.
