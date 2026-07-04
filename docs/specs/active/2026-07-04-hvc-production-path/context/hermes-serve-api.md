# hermes serve API contract (for ApiHermesAdapter)

Mapped 2026-07-04 from Hermes Agent v0.18.0 source at ~/.hermes/hermes-agent
(upstream 5445e42b, +2 carried commits). Read-only audit; citations are
file:line in that repo.

## Transport

- `hermes serve` → uvicorn server, default `127.0.0.1:9119`
  (hermes_cli/web_server.py:15000; serve == dashboard with no_open,
  hermes_cli/subcommands/dashboard.py:135).
- WebSocket endpoint: `/api/ws` (web_server.py:13631 → tui_gateway/ws.py:283).
- Wire: newline-delimited JSON-RPC 2.0, bidirectional; server pushes
  notifications as `{"method":"event","params":{"type":..., "session_id":...,
  "payload":{...}}}`.
- On connect the server immediately emits `gateway.ready`.

## Auth (loopback)

- Connect `ws://127.0.0.1:9119/api/ws?token=<SESSION_TOKEN>`.
- Token = `HERMES_DASHBOARD_SESSION_TOKEN` env or per-process
  `secrets.token_urlsafe(32)` (web_server.py:269); HMAC constant-time check
  (web_server.py:12581); bad token → WS close 4401.
- Public binds use ticket/internal-credential auth (dashboard_auth/
  ws_tickets.py) — NOT our path; HVC stays loopback, Tailscale is the outer
  boundary.

## Methods HVC needs (of 79 total; tui_gateway/server.py:1079 registry)

| Method | Params (subset) | Returns |
|---|---|---|
| `session.create` | title, cwd, profile, model, messages(seed), close_on_disconnect | session_id, stored_session_id, info{model,tools,cwd,...} (server.py:4908) |
| `session.resume` | session_id, eager_build, close_on_disconnect | session_id, resumed, messages, running, status (server.py:5288) |
| `prompt.submit` | session_id, text | {status:"streaming"} immediately; then events (server.py:8141) |
| `session.interrupt` | session_id | {status:"interrupted"} (server.py:7835) |
| `session.status` | session_id | {running, status, model, ...} (server.py:7493) |
| `session.close` / `session.delete` | session_id | status (server.py:7752/5866) |
| `approval.respond` | session_id, approved | {status:"responded"} (server.py:9770) |

## Event stream (per prompt.submit)

`message.start` → `message.delta` {text, rendered} (coalesced ~33ms,
server.py:8614) → [`thinking.delta`/`reasoning.delta`, `tool.start`,
`tool.complete`, `status.update`] → `message.complete` {text, usage,
status: complete|error|interrupted} (server.py:8739). Errors: `error`
{message}. Session-level: `session.info`. Approval: `approval.request`
{command, context} (server.py:1014).

## Semantics that shape the adapter

- session_id (8-char hex) is per-runtime; stored_session_id persists across
  resume. Persist stored id in HVC DB; resume on reconnect.
- Concurrent prompt.submit on one session → queued; queue drains after turn.
- interrupt is cooperative: kills foreground subprocess, clears pending
  prompts and active approvals. Maps to voice barge-in.
- Multiple clients may attach to one session; events go to connected clients
  (last active client gets new frames). HVC should be the single owner of its
  voice session.
- create is lazy (agent builds in background after response) — first prompt
  may wait on build; warm the session at unlock, not at first utterance.

## Voice-safety rules (spec-mandated)

- NEVER auto-respond to `approval.request` from the voice path. Surface as
  "needs your approval on desktop" in UI; leave pending or respond
  approved=false only on explicit user action.
- Token comes from process env/config; never logged, never sent to browser.
- HVC backend remains the only client-facing boundary; browser never talks
  to 9119.

## Minimal client sequence

connect(?token) → recv gateway.ready → session.create (or resume stored id)
→ prompt.submit(text) → consume message.start/delta/complete (+surface
approval.request) → session.interrupt on barge-in → session.close on
teardown.

## Open questions for implementation

1. Server lifecycle: who runs `hermes serve`? Current gateway process is
   separate; serve may need its own launchd entry or on-demand spawn by HVC.
   Decide + document in the adapter PR (do NOT touch the running gateway).
2. Token plumbing: HERMES_DASHBOARD_SESSION_TOKEN into both serve and HVC env
   via .private/deployment/launchd.env.
3. Latency: create-lazy build time must be measured; warm at unlock.
