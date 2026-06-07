# Architecture

## Runtime Path

```text
Phone/laptop browser over localhost or Tailscale
  -> React voice UI
  -> FastAPI access check and optional PIN session
  -> Gemini ephemeral token broker
  -> browser Gemini Live websocket session
  -> Gemini tool call normalization
  -> backend tool policy and cancellation checks
  -> Hermes agent adapter
  -> speakable response or confirmation proposal
```

## Components

- `apps/web`: React voice UI, orb state machine, audio worklets, Gemini Live
  protocol wrapper, transcript drawer, and text fallback.
- `apps/server`: FastAPI auth/session layer, Gemini token broker, tool allowlist,
  SQLite store, confirmation queue, readiness/log controls, and Hermes adapter
  implementations.
- `scripts/browser-responsive.spec.ts`: Playwright responsive/browser smoke with
  fake microphone permission and screenshot capture.
- `scripts/e2e-real-gemini-live.mjs`: credentialed Gemini Live smoke that mints
  a backend token, sends generated speech PCM, terminates with
  `audioStreamEnd`, and waits for Gemini output.

## Trust Boundaries

The browser never receives long-lived Gemini/Google API keys, Hermes state, or
direct local-tool access. It receives backend-issued Gemini ephemeral tokens and
can ask the backend to run only allowlisted HVC tools.

No-PIN mode is a localhost development convenience. Remote/proxied access
without a PIN is blocked unless `HVC_ALLOW_NO_PIN_REMOTE=true` is set
intentionally. Tailscale Serve should run with `HVC_REQUIRE_PIN=true`.

Tool calls are cancellable. Barge-in or end-session cancellation asks the
backend to mark the tool call cancelled, aborts the frontend request, and causes
late responses for that call to be ignored.

## Data Stores

SQLite stores sessions, transcripts/events, confirmations, and tool-call
cancellation markers. Confirmation approval is intentionally not an external
action executor; it records intent for a future reviewed action path.

`/healthz` is a basic liveness endpoint. `/readyz` checks database reachability
and safe runtime posture without exposing secrets. `/logs` is disabled by
default and requires `HVC_ALLOW_LOGS_ENDPOINT=true`.

## Context Documents

- [Security model](context/security-model.md)
- [Tailscale private exposure](context/tailscale-private-exposure.md)
- [Hermes integration](context/hermes-integration.md)
- [UX state machine](context/ux-state-machine.md)
- [Implementation notes](context/implementation-notes.md)
- [Open-source boundary](context/open-source-boundary.md)
- [Open-source voice systems research](context/research/open-source-voice-systems.md)

## Current Work

The active hardening and live-verification bundle is
[2026-06-07-hvc-hardening-live-verification](specs/active/2026-06-07-hvc-hardening-live-verification/SPEC.md).
