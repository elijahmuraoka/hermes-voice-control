# Hermes integration

The app integrates with Bob/Hermes through an adapter interface.

Adapters:

- `MockHermesAdapter` — default; deterministic tests and local UX development.
- `LocalHermesAdapter` — optional; invokes local Hermes only when `HVC_HERMES_ADAPTER=local`.

The adapter is intentionally narrow: `ask_bob(message, mode, transcript_window) -> speakable response`.

Safety contract:

- `ask_bob` is for answers only. It accepts `quick` and `deep` modes.
- The backend denies unknown tools.
- Risky requests should be represented as `propose_action` confirmation records.
- Approving a confirmation records approval only; it does not execute a real Hermes/local action.
- `LocalHermesAdapter` invokes the configured Hermes binary only for `ask_bob` and frames the prompt as read-only.

## Local adapter shape

The local adapter runs the configured Hermes binary directly with an argument
array rather than through a shell. Its default binary path is the local Hermes
agent virtualenv path on Bob's machine, and it invokes:

```bash
hermes chat -q <prompt> --toolsets safe
```

Timeouts, cancellation, and process launch failures are surfaced as controlled
errors so the browser does not hang behind a failed local Hermes bridge.
