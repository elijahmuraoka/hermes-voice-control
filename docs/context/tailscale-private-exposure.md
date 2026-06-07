# Tailscale private exposure

Do not run this until local verification passes and the operator explicitly
approves private-network exposure.

Planned shape:

```bash
# server remains bound to localhost
tailscale serve --bg http://127.0.0.1:8765
```

Use Tailscale Serve, not Funnel. Because Tailscale Serve forwards traffic through a local reverse proxy, enable app-level PIN/session auth before exposing the privileged tool surface to any remote browser.

Current v1 default: no-PIN mode is for direct localhost development only. For Tailscale Serve, set:

```bash
HVC_REQUIRE_PIN=true
HVC_PIN=<at-least-8-chars-not-000000>
```

Keep the server bound to `127.0.0.1`. The backend refuses non-local binds unless `HVC_ALLOW_REMOTE_BIND=true` is set intentionally.

## Remote Header Guard

The backend treats no-PIN remote/proxy access as unsafe. Requests that arrive
with forwarded host headers or non-local host context are rejected in no-PIN
mode unless `HVC_ALLOW_NO_PIN_REMOTE=true` is set intentionally. For normal
Tailscale Serve operation, use the PIN session path instead of the override.
