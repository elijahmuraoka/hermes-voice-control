# Architecture

## Runtime Path

```text
Phone/laptop browser over localhost or Tailscale
  -> React voice UI
  -> FastAPI access check and optional PIN session
  -> Gemini ephemeral token broker
  -> browser realtime provider adapter
  -> browser Gemini Live websocket session
  -> basic hold-to-talk browser interim text and backend Gemini STT
  -> /chat/text job lifecycle
  -> Gemini tool call normalization
  -> backend tool policy and cancellation checks
  -> Hermes agent adapter
  -> speakable response or recorded confirmation proposal
```

Live mode treats Gemini as the realtime audio transport, not the source of
agent answers. The browser sends a session instruction that requires
user-facing answers to go through the allowlisted `ask_agent` tool, and it
suppresses model audio/text until a backend tool response has unlocked the turn.
This keeps Live voice aligned with the same Hermes adapter path used by typed
chat and Basic Hold.

## Components

- `apps/web`: React voice UI, orb state machine, audio worklets, realtime
  provider boundary, Gemini Live protocol wrapper, opt-in basic hold-to-talk
  audio capture with browser interim text, local diagnostics recorder,
  transcript drawer, and text fallback.
- `apps/server`: FastAPI auth/session layer, Gemini token broker, tool allowlist,
  Gemini STT transcription endpoint, SQLite store, confirmation records,
  readiness/log controls, and Hermes adapter implementations.
- `scripts/browser-responsive.spec.ts`: Playwright responsive/browser smoke with
  fake microphone permission and screenshot capture.
- `scripts/e2e-real-gemini-live.mjs`: credentialed Gemini Live smoke that mints
  a backend token, sends generated speech PCM, terminates with
  `audioStreamEnd`, and waits for Gemini output.

## Trust Boundaries

The browser never receives long-lived Gemini/Google API keys, Hermes state, or
direct local-tool access. It receives backend-issued Gemini ephemeral tokens and
can ask the backend to run only allowlisted HVC tools.

Basic hold-to-talk records audio only while the operator holds the orb. Browser
speech recognition provides interim text and fallback; the authenticated backend
STT path can finalize the transcript before it enters the same chat job
lifecycle as typed messages. Audio is not persisted to disk.

No-PIN mode is a localhost development convenience. Remote/proxied access
without a PIN is blocked unless `HVC_ALLOW_NO_PIN_REMOTE=true` is set
intentionally. Tailscale Serve should run with `HVC_REQUIRE_PIN=true`.

Tool calls are cancellable. Barge-in or end-session cancellation asks the
backend to mark the tool call cancelled, aborts the frontend request, and causes
late responses for that call to be ignored.

## PWA and Resilience Features

- **Installable PWA:** The app ships a web manifest with `display: standalone`.
  Supported browsers can add HVC to the home screen or app launcher. The
  installed name is fixed at build time: "Hermes Voice Control" (short name
  "Hermes"). The in-app agent name is separately configurable via
  `VITE_HVC_AGENT_NAME`.
- **Live self-healing reconnect:** When the Gemini Live WebSocket drops, the
  client reconnects automatically — it re-mints a fresh ephemeral token from the
  backend, re-establishes the WebSocket, and applies exponential backoff with
  jitter. A wake lock is held during reconnect to prevent device sleep from
  interrupting recovery on mobile.
- **Unlock-time Hermes session warming:** When the operator unlocks the app
  (PIN entry or device-cookie auth), the backend immediately warms the Hermes
  session so the first agent answer is pre-warmed and lower-latency.

## Data Stores

SQLite stores sessions, transcripts/events, confirmations, audit logs, and
tool-call cancellation markers. Confirmation approval is intentionally not an
external action executor in v1; it records intent for a future reviewed action
path.

`/healthz` is a basic liveness endpoint. `/readyz` checks database reachability
and writeability plus safe runtime posture without exposing secrets. `/logs` is
disabled by default and requires `HVC_ALLOW_LOGS_ENDPOINT=true`. Audit logs are
pruned at startup with `HVC_AUDIT_LOG_RETENTION_DAYS` and
`HVC_AUDIT_LOG_MAX_ROWS`.

## Context Documents

- [Security model](context/security-model.md)
- [Private network runbook](context/runbooks/private-network.md)
- [Tailscale private exposure](context/tailscale-private-exposure.md)
- [Hermes integration](context/hermes-integration.md)
- [Realtime provider boundary](context/realtime-provider-boundary.md)
- [UX state machine](context/ux-state-machine.md)
- [Diagnostics](context/diagnostics.md)
- [Implementation notes](context/implementation-notes.md)
- [Open-source boundary](context/open-source-boundary.md)
- [Open-source voice systems research](context/research/open-source-voice-systems.md)
- [Realtime provider bakeoff](context/research/realtime-provider-bakeoff.md)

## Current Work

The active hardening and live-verification bundle is
[2026-06-07-hvc-hardening-live-verification](specs/active/2026-06-07-hvc-hardening-live-verification/SPEC.md).
