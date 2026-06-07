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
hermes chat -q <prompt> --toolsets safe
```

Timeouts, cancellation, and process launch failures are surfaced as controlled
errors so the browser does not hang behind a failed local Hermes bridge.
