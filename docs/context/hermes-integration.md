# Hermes integration

The app integrates with a local Hermes-compatible agent through an adapter
interface.

Adapters:

- `MockHermesAdapter` — default; deterministic tests and local UX development.
- `LocalHermesAdapter` — optional; invokes local Hermes only when `HVC_HERMES_ADAPTER=local`.
- `ApiHermesAdapter` — optional; connects to a loopback `hermes serve` websocket
  when `HVC_HERMES_ADAPTER=api`.

The adapter is intentionally narrow: an `ask_agent` request becomes a speakable
response. The backend still accepts `ask_bob` as a compatibility alias for older
clients, but new frontend and Gemini declarations use generic agent naming.

Safety contract:

- Agent-answer requests are for answers only. They accept `quick` and `deep`
  modes.
- The backend denies unknown tools.
- Risky requests may be represented as `propose_action` confirmation records.
- Approving a confirmation records intent only; it does not execute a real
  Hermes/local action in v1.
- `LocalHermesAdapter` invokes the configured Hermes binary only for
  agent-answer requests and frames the prompt as read-only.
- `ApiHermesAdapter` never sends the Hermes dashboard token to the browser and
  never auto-responds to `approval.request` events.

## Local adapter shape

The local adapter runs the configured Hermes binary directly with an argument
array rather than through a shell. Its default binary path is the local Hermes
agent binary path from configuration, and it invokes:

```bash
hermes chat -Q -q <prompt> --toolsets safe
```

Timeouts, cancellation, process launch failures, empty output, and Hermes CLI
failure transcripts are surfaced as controlled errors so the browser does not
hang behind or misreport a failed local Hermes bridge. The quiet chat query path
preserves Hermes approval semantics while keeping stdout limited to the final
answer text for the bridge.

`/readyz` includes local-adapter diagnostics when `HVC_HERMES_ADAPTER=local`,
including whether the configured binary resolves, the read-only command shape,
the safe toolset, and the adapter timeout. A missing local Hermes binary makes
readiness fail closed with a controlled diagnostic.

Configure the timeout with:

```bash
HVC_HERMES_TIMEOUT_SECONDS=90
```

## Stateful API adapter shape

The API adapter connects from the HVC backend to a local Hermes serve websocket:

```bash
HVC_HERMES_ADAPTER=api
HVC_HERMES_API_URL=ws://127.0.0.1:9119/api/ws
HVC_HERMES_API_TOKEN=<same-token-used-by-hermes-serve>
```

`HERMES_DASHBOARD_SESSION_TOKEN` can provide the token instead of
`HVC_HERMES_API_TOKEN`. `HVC_HERMES_API_URL` must stay a loopback `ws://` URL;
startup and `pnpm env:check` reject remote URLs so a dashboard token is not sent
outside the local machine.

On each private HVC session, the adapter creates or resumes a Hermes serve
session, persists the returned `stored_session_id` in the HVC SQLite store, and
submits prompts through `prompt.submit`. It streams `message.delta` text into
the background chat job `partial_text` field so the transcript can show progress
while the answer is still running. `session.interrupt` is used for cancellation
or barge-in.

Hold-mode voice output reuses the same Hermes serve trust boundary. The browser
calls authenticated HVC `POST /tts` with answer text; the backend derives the
Hermes HTTP base from `HVC_HERMES_API_URL`, calls Hermes serve
`POST /api/audio/speak` with the dashboard token, and returns the audio data URL
to the browser for playback through an already-unlocked `AudioContext`. This
uses the voice configured in Hermes itself, such as Bob's ElevenLabs voice,
without exposing the dashboard token to the browser.

If Hermes emits `approval.request`, HVC returns a `pending_confirmation` result
and the chat job becomes `needs_permission`. The voice/browser path does not call
`approval.respond`; the operator must handle approval in the desktop Hermes
session.

## Safe real-Hermes harness

Real local Hermes verification is intentionally opt-in. Normal tests and
`pnpm verify` do not call the user's Hermes runtime.

Run the live read-only harness only from a trusted local shell:

```bash
HVC_REAL_HERMES_HARNESS=1 HVC_HERMES_ADAPTER=local pnpm hermes:harness
```

Optional overrides:

```bash
HVC_REAL_HERMES_HARNESS=1 HVC_HERMES_ADAPTER=local HVC_HERMES_BIN=/opt/homebrew/bin/hermes HVC_HERMES_TIMEOUT_SECONDS=90 HVC_AGENT_NAME="My Hermes Agent" pnpm hermes:harness
```

The harness invokes the same `LocalHermesAdapter` contract as the backend and
writes redacted local evidence to an ignored private path by default:

```text
.private/evidence/hermes-bridge-harness-latest.json
```

Use `--output <path>` only when intentionally writing a sanitized artifact for
review. Public docs and PRs should record summaries, timings, and pass/fail
status rather than raw live Hermes responses.

It probes:

- `ask_agent`
- `ask_bob` compatibility
- v1 no-action semantics, where the agent must explain that no external action
  was executed

Cancellation, timeout, malformed/empty output, and binary-resolution behavior
are covered by backend tests with fake local Hermes processes so CI does not
depend on a developer's local credentials or runtime state.

## Live text latency harness

The typed fallback path can be measured against an already-running local or
private HVC server without printing raw Hermes response content. By default the
harness uses the same background job flow as the browser: `/chat/text` should
return a visible job quickly, then the harness polls `/chat/jobs/{id}` for the
terminal result.

```bash
HVC_LIVE_TEXT_HARNESS=1 pnpm hermes:text-latency -- --base-url http://127.0.0.1:8765
```

Use `HVC_PIN` or `HVC_PIN_FILE` when the target requires PIN auth. The harness
sends `X-HVC-Adapter-Diagnostics: 1`, writes redacted evidence to
`.private/evidence/live-text-latency-latest.json` by default, and records
response length, HTTP status, job states, adapter phase timings, client
timeout, and cancellation status only.

For debugging the legacy synchronous path, add `--sync`. The production browser
path should use the default job mode so slow Hermes responses stay visible and
cancellable instead of dead-ending the text request.
