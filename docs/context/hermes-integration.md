# Hermes integration

The app integrates with a local Hermes-compatible agent through an adapter
interface.

Adapters:

- `MockHermesAdapter` — default; deterministic tests and local UX development.
- `LocalHermesAdapter` — optional; invokes local Hermes only when `HVC_HERMES_ADAPTER=local`.

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
writes redacted evidence to:

```text
docs/specs/active/2026-06-07-hvc-hardening-live-verification/evidence/hermes-bridge-harness-latest.json
```

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
private HVC server without printing raw Hermes response content:

```bash
HVC_LIVE_TEXT_HARNESS=1 pnpm hermes:text-latency -- --base-url http://127.0.0.1:8765
```

Use `HVC_PIN` or `HVC_PIN_FILE` when the target requires PIN auth. The harness
sends `X-HVC-Adapter-Diagnostics: 1`, writes redacted evidence to
`.private/evidence/live-text-latency-latest.json` by default, and records
response length, HTTP status, adapter phase timings, client timeout, and
cancellation status only.
