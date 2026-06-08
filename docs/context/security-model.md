# Security model

Defaults:

- Bind to `127.0.0.1` only.
- Mock Gemini and Hermes adapters by default.
- Use no-PIN mode only for direct localhost development.
- Require `HVC_REQUIRE_PIN=true` before exposing through Tailscale Serve.
- Keep optional PIN/session auth available behind `HVC_REQUIRE_PIN=true`.
- Reject weak configured PINs such as empty values, `000000`, `123456`, or
  values shorter than 8 characters when PIN auth is required.
- Reject wildcard CORS origins because credentials are enabled.
- Keep `/logs` disabled unless `HVC_ALLOW_LOGS_ENDPOINT=true` is set for a
  trusted debugging session.
- Prune audit logs at startup with `HVC_AUDIT_LOG_RETENTION_DAYS` and
  `HVC_AUDIT_LOG_MAX_ROWS`.
- Allow secure session cookies with `HVC_SECURE_COOKIES=true` when serving over
  HTTPS/private reverse proxy.
- Deny unknown tools.
- Execute only the narrow agent-answer tool by default.
- Queue risky action proposals for explicit confirmation.
- Record confirmation approval without executing external actions.
- Redact secrets before logging or persisting events.
- Treat the browser and reverse-proxy headers as untrusted inputs.

Not allowed by default:

- Public network bind.
- Tailscale Funnel.
- Twilio webhooks.
- Direct browser access to API keys.
- Direct Gemini/browser access to arbitrary local tools.
- Logging raw Gemini tokens, session IDs, PINs, cookies, or API keys.

## Gemini token broker

`/gemini/ephemeral-token` returns a short-lived Gemini token to the browser, but audit logs only record mode, expiry, and that a token was issued. `/gemini/status` reports whether a real Gemini key is configured as a boolean and never returns the key value.

`/readyz` reports safe runtime posture, including database writeability, Gemini
mode/model, adapter mode, PIN requirement, log-retention controls, and whether
the logs endpoint is enabled. It returns `503` when real Gemini mode is selected
without a configured API key or without the `google-genai` client installed.

## Hermes agent bridge

The backend allowlist exposes `ask_agent` for speakable agent answers and keeps
`ask_bob` as a compatibility alias. `propose_action` records action proposals
for review. Approval records intent only and does not execute external actions
in v1. Agent-answer requests accept only `quick` and `deep` modes. The local
Hermes adapter prompt is read-only and tells Hermes not to mutate files, send
messages, or claim an action was performed.

## Cancellation

Tool calls carry request ids. When the user barges in, ends the session, or the
frontend aborts a tool call, `/tools/cancel` records cancellation in SQLite.
The backend checks cancellation before returning speakable tool output, and the
frontend ignores late responses for cancelled calls.
