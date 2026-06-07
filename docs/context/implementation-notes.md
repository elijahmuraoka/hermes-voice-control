# Implementation notes

## Design decisions

- Product name is `hermes-voice-control`; `hermes-voice-portal` remains
  planning-only.
- The orb is both status indicator and primary input control.
- Hands-free and hold-to-talk are complementary modes.
- Tap starts, pauses, or resumes. Hold captures a longer thought. Holding while
  Bob is speaking is the interrupt/barge-in gesture.
- No visible Interrupt button and no default PIN wall for direct localhost
  development. Tailscale Serve should use PIN/session auth.
- Transcript drawer and floating text fallback are first-class.
- Backend defaults to mock Gemini and mock Hermes so local development cannot
  accidentally spend API quota or mutate local systems.
- FastAPI is used because the eventual real Bob/Hermes adapter is Python-native.
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
- Backend supports cancellable `ask_bob`, `propose_action` confirmation records,
  and `/tools/cancel`.
- Mock Gemini mode can smoke-test the local app and token broker without real
  Gemini credentials.
- Real Gemini Live requires `HVC_GEMINI_MODE=real`, `google-genai`, and a Gemini
  API key in the backend environment.
- No-PIN remote/proxy access is blocked unless explicitly overridden; Tailscale
  Serve should use PIN/session auth.
- `LocalHermesAdapter` launches Hermes with a direct argv, safe toolset, timeout
  handling, cancellation handling, and launch-error handling.

## Tradeoffs

- Custom CSS is used instead of Tailwind to avoid generic dashboard aesthetics.
- SQLite uses stdlib `sqlite3` instead of an ORM to keep the backend small and
  auditable.
- PIN auth is intentionally simple for a one-user private app, with server-side
  sessions and rate limits when enabled.
- The real Gemini websocket/audio path is unit-tested and browser-wired, but
  still needs a credentialed live smoke test.

## Fresh verification notes

- 2026-06-07: `pnpm test` passed. Web: 4 files / 26 tests. Backend: 21 tests
  with one Starlette/httpx deprecation warning.
- 2026-06-07: `pnpm build` passed. Vite production build emitted about 216 KB JS
  and 7 KB CSS before gzip.
- 2026-06-07: `tomoji docs index --verify --json` passed with `inSync: true`.
- 2026-06-07: `tomoji docs audit --json` passed with zero findings.
- 2026-06-07: local health probes to `127.0.0.1:8765` and `127.0.0.1:5173`
  failed because the backend and Vite app were not running.
- 2026-06-07: browser-responsive and real Gemini Live smoke scripts exist but
  were not rerun in this pass because the app/server were not running.
- 2026-06-07: public repo target selected:
  `https://github.com/elijahmuraoka/hermes-voice-control`.

## Remaining gaps

- Run one credentialed Gemini Live smoke test with real backend
  `HVC_GEMINI_MODE=real` and microphone permission.
- Decide whether `LocalHermesAdapter` should stay read-only only, or later
  support confirmation-gated actions.
- Decide the default Gemini voice/personality for Bob once real audio is
  enabled.
- If exposing beyond local/Tailscale, add an explicit auth/rate-limit/reverse
  proxy review before changing bind or access posture.
- Add CI after the first public push.
