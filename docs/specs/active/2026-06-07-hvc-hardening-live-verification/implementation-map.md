# Implementation Map

## Backend

- `apps/server/app/config.py`: bind/auth settings, weak PIN checks, safe default
  Hermes binary, and no-PIN remote override controls.
- `apps/server/app/main.py`: session/auth dependencies, remote/proxy guard, and
  `/tools/cancel`.
- `apps/server/app/store.py`: confirmation request ids and tool-call
  cancellation persistence.
- `apps/server/app/tools.py`: allowlisted tools, cancellable `ask_agent`
  requests, `ask_bob` compatibility alias, confirmation records, and
  cancellation checks.
- `apps/server/app/adapters.py`: mock/local Hermes adapters, direct argv launch,
  safe toolset, timeout/cancel/error handling.
- `apps/server/tests/test_backend.py`: auth, remote guard, confirmation, and
  cancellation coverage.

## Frontend

- `apps/web/src/geminiLive.ts`: Gemini Live session orchestration, model resource
  normalization, audio finalization, tool-call cancellation, and late-response
  suppression.
- `apps/web/src/gemini-live/defaults.ts`: default tool schemas and tool caller
  cancellation hooks.
- `apps/web/src/audio.ts` and worklets: capture/playback/resampling path.
- `apps/web/src/stateMachine.ts`: voice control state transitions.
- `apps/web/src/App.tsx` and components/styles: mobile layout, no visible
  interrupt/PIN controls, transcript and text fallback.

## Verification Scripts

- `scripts/browser-responsive.spec.ts`: Playwright responsive smoke plus real
  backend token-flow check.
- `scripts/e2e-real-gemini-live.mjs`: real Gemini Live websocket/audio smoke.
