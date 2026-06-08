# Diagnostics

Hermes Voice Control keeps realtime diagnostics local to the browser. The app
does not send latency metrics, session markers, tool arguments, provider
payloads, or debug bundles to the backend.

## Local Bundle

Open browser devtools on the HVC page and run:

```js
window.__HVC_DIAGNOSTICS__.snapshot()
```

For a copyable JSON bundle:

```js
window.__HVC_DIAGNOSTICS__.copyText()
```

The bundle includes event timestamps, launch budgets, and a summary of latency
derived from local monotonic clock values. It intentionally omits Gemini tokens,
session IDs, tool arguments, response bodies, cookies, PINs, and authorization
headers. Free-form diagnostic strings pass through the same redactor exposed as:

```js
window.__HVC_DIAGNOSTICS__.redactText("token=...")
```

## Captured Events

- `session_start`: the app began a new local voice session recording window.
- `session_resume`: an existing browser session was resumed after pause.
- `mic_start`: microphone capture became available to the Gemini Live session.
- `provider_response_first`: the first parsed Gemini Live provider event
  arrived in the browser.
- `audio_playback_first`: the first provider PCM audio chunk was scheduled for
  playback.
- `tool_call_request`: Gemini requested an allowlisted backend tool call.
- `tool_call_response`: the backend tool call returned and was ready to send
  back to Gemini.
- `tool_call_cancellation`: Gemini or the client cancelled active tool calls.
- `session_close`: the Gemini Live websocket/session closed.
- `session_error`: the Gemini Live client reported an error.

Tool events use a local sequence number such as `toolCallSeq: 1`; they do not
include provider request IDs or session identifiers.

## Launch Budgets

The shared launch budgets live in
[`apps/web/src/diagnosticsBudgets.json`](../../apps/web/src/diagnosticsBudgets.json):

| Metric | Budget |
|---|---:|
| First audio latency | 2500ms |
| Tool response latency | 3000ms |
| Reconnect/resume latency | 1500ms |
| Browser smoke flake rate | 2% |

`pnpm perf:budget` validates these invariants, and `pnpm smoke:browser` checks
that the browser exposes a local, redacted diagnostics bundle.

## Provider Bakeoff Reuse

Provider bakeoff harnesses should consume the same browser-facing event names
and summaries instead of adding provider-specific metrics. Reuse
`createHvcDiagnosticsRecorder()` from `apps/web/src/diagnostics.ts`, start a new
recording window before each provider attempt, and feed `GeminiLiveSession`
`onDiagnosticsEvent` callbacks into the recorder.
