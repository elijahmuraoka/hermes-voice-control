# Security model

Hermes Voice Control is a private, localhost-first voice surface for a single
operator. The browser, Gemini Live session, reverse proxy, and local Hermes
adapter are all treated as untrusted boundaries. The backend is the only place
that can read long-lived provider credentials, enforce app auth, broker
ephemeral Gemini tokens, route tools, persist confirmations, and write audit
logs.

## Production hardening gate

Before private-network exposure or release:

- Keep the server bound to `127.0.0.1`.
- Run `pnpm env:check`, `pnpm verify`, `pnpm docs:verify`,
  `tomoji docs index --verify --json`, and `tomoji docs audit --json`.
- For Tailscale Serve, set `HVC_REQUIRE_PIN=true`,
  `HVC_PIN=<strong-private-pin>`, and `HVC_SECURE_COOKIES=true`.
- Do not use Tailscale Funnel or public unauthenticated exposure.
- Keep `/logs` disabled except during a trusted debugging session.
- Keep v1 action approvals read-only: approval records intent only and does not
  execute external actions.
- Run one credentialed Gemini Live smoke before claiming real-provider
  readiness.

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
- Logging raw free-text tool prompts, transcript windows, agent answers, or
  confirmation summaries in audit logs.

## Gemini token broker

`/gemini/ephemeral-token` returns a short-lived Gemini token to the browser, but
audit logs only record mode, expiry, and that a token was issued.
`/gemini/status` reports whether a real Gemini key is configured as a boolean
and never returns the key value.

Real Gemini mode creates constrained tokens with one use, a short expiry, a
short new-session window, the configured Live model, and audio-only response
modalities. The browser still receives the ephemeral token by design, so a
compromised browser can use that token until it expires. That is the accepted
residual risk for direct Gemini Live browser streaming; long-lived Gemini API
keys never leave the backend.

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

Audit logs for tool traffic record metadata such as tool name, mode, character
counts, transcript item counts, result presence, request id, and status. They do
not persist raw free-text prompts, transcript windows, agent answers, or
confirmation summaries. Confirmation records can still hold the visible summary
and payload needed for review, but approval remains non-executing in v1.

## Cancellation

Tool calls carry request ids. When the user barges in, ends the session, or the
frontend aborts a tool call, `/tools/cancel` records cancellation in SQLite.
The backend checks cancellation before returning speakable tool output, and the
frontend ignores late responses for cancelled calls.

## Threat register

| Threat | Risk | Current mitigation and gate | Residual disposition |
|---|---|---|---|
| Browser compromise | High | Browser is treated as untrusted. It receives only Gemini ephemeral tokens and, when PIN auth is enabled, an HttpOnly `hvc_session` cookie. Long-lived Gemini keys stay backend-only. PIN login no longer returns the raw session token in JSON. CORS is allowlisted, wildcard origins fail closed, `/logs` is disabled by default, and audit payloads avoid raw free text. | Accepted for v1: a compromised browser can act as the user until the session cookie or Gemini token expires. Keep TTLs short for exposed deployments and revoke with logout or DB cleanup if compromise is suspected. |
| Gemini token theft | High | Tokens are minted only after backend auth. Real tokens are constrained to one use, short expiry, short new-session window, configured Live model, and audio-only response modalities. Token values are not logged. | Accepted for v1 because direct browser-to-Gemini Live streaming requires an ephemeral browser token. The non-goal is hiding the active ephemeral token from the active browser session. |
| PIN and session abuse | High | PIN auth is required for Tailscale Serve. Weak/default PINs fail closed when `HVC_REQUIRE_PIN=true`. PIN attempts are rate-limited per client. Sessions are random, stored hashed server-side, expire by TTL, and can be revoked. Cookies are HttpOnly, SameSite=Lax, and can be Secure. | No multi-user RBAC or IdP in v1. Add a follow-up before shared-team use or before enabling external action execution. |
| CSRF and origin abuse | Medium | Credentialed CORS allows only configured origins and rejects `*`. Browser fetch calls use credentials against configured origins, PIN sessions use SameSite=Lax cookies, and v1 confirmation approval does not execute external actions. | No separate CSRF token or strict Origin/Referer gate in v1. Add one before any approval can perform a real external action. |
| Reverse-proxy header spoofing | High | Default bind is localhost. Non-local binds require `HVC_ALLOW_REMOTE_BIND=true`. No-PIN mode rejects non-local clients, forwarded/proxy identity headers, and non-local Host headers unless `HVC_ALLOW_NO_PIN_REMOTE=true` is set intentionally. `pnpm env:check` fails unsafe private-network posture. | Explicit override is treated as an operator-accepted exception for debugging only. Normal Tailscale Serve uses PIN/session auth. |
| Tool prompt injection | High | Gemini/browser tool calls hit a backend allowlist. Unknown tools are denied. `ask_agent` accepts only `quick` and `deep` modes. Local Hermes is launched with the safe toolset and a read-only prompt. Risky requests can only create `propose_action` confirmations, and approval records intent without executing. | Agent text can still contain bad advice. V1 non-goal: autonomous file, message, shell, or network actions from voice. |
| Audit-log leakage | Medium | `/logs` is disabled by default. Audit payloads redact secret-shaped keys, hide session hashes in API responses, prune by age and row count at startup, and avoid raw prompt/transcript/result/summary text for tool traffic. Tests assert PINs, session ids, Gemini tokens, payload secrets, and free-text tool secrets do not appear in logs. | Debug log access remains sensitive even when redacted. Keep `HVC_ALLOW_LOGS_ENDPOINT=false` outside trusted local debugging. |
| Dependency compromise | Medium | The app defaults to mock provider/adapters, keeps real Gemini behind env gates, uses lockfiles, validates env posture, and runs `pnpm verify` plus backend tests before release. Local Hermes execution uses direct argv instead of shell interpolation. | No vendored dependency audit is included in v1. Run package-manager audit and review Dependabot updates before public release or long-lived deployment. |
| Accidental public exposure | High | Server defaults to `127.0.0.1`, Tailscale Serve is documented instead of Funnel, remote bind and no-PIN remote access require explicit env overrides, and env validation blocks unsafe remote/private-network access without PIN auth. Open-source boundary docs keep `.env`, transcripts, hostnames, and local context private. | Public internet exposure is a v1 non-goal. Any future public deployment needs a new threat model, auth design, abuse controls, and external security review. |

## Security review result

The 2026-06-08 local security review for issue #15 found no blocking issue
after the audit-log and login-response hardening in this branch. Remaining
non-blocking follow-ups are provider/dependency audit before public release,
credentialed real Gemini Live smoke, and a new CSRF/origin gate if approval ever
executes a real external action.
