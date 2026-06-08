# Tailscale private exposure

Do not run this until local verification passes and the operator explicitly
approves private-network exposure.

Required shape:

```bash
# FastAPI remains bound to localhost.
export HVC_HOST=127.0.0.1
export HVC_REQUIRE_PIN=true
read -rsp "HVC PIN: " HVC_PIN; export HVC_PIN; echo
export HVC_SECURE_COOKIES=true
export HVC_ALLOW_LOGS_ENDPOINT=false

pnpm env:check
tailscale serve --bg --https=443 http://127.0.0.1:8765
```

Use Tailscale Serve, not Funnel. Tailscale Serve shares a local service inside
the tailnet; Tailscale Funnel exposes a service publicly on the internet and is
out of scope for v1.

Because Tailscale Serve forwards traffic through a local reverse proxy, enable
app-level PIN/session auth before exposing the privileged tool surface to any
remote browser.

Current v1 default: no-PIN mode is for direct localhost development only. For Tailscale Serve, set:

```bash
HVC_REQUIRE_PIN=true
read -rsp "HVC PIN: " HVC_PIN; export HVC_PIN; echo
```

Keep the server bound to `127.0.0.1`. Do not set
`HVC_ALLOW_REMOTE_BIND=true` for the standard Tailscale Serve path.

Do not set `HVC_ALLOW_NO_PIN_REMOTE=true` for private deployment. That override
exists for explicit local diagnostics, not for an HVC release candidate.

Use exact frontend origins only:

```bash
export HVC_FRONTEND_ORIGINS='http://127.0.0.1:5173,http://localhost:5173,https://FRONTEND_DEVICE.TAILNET.ts.net'
```

Wildcard CORS is rejected by startup and `pnpm env:check`.

## Health Checks

Before Serve:

```bash
curl -fsS http://127.0.0.1:8765/healthz
curl -fsS http://127.0.0.1:8765/readyz
curl -i http://127.0.0.1:8765/auth/session
```

After Serve, from another tailnet device:

```bash
curl -fsS 'https://BACKEND_DEVICE.TAILNET.ts.net/readyz'
curl -i 'https://BACKEND_DEVICE.TAILNET.ts.net/auth/session'
```

Expected: readiness is HTTP 200 with `pin_required: true` and
`logs_endpoint_enabled: false`; unauthenticated `/auth/session` is HTTP 401.

## Rollback

Disable the exact Serve listener:

```bash
tailscale serve --https=443 off
tailscale serve status --json
```

Use `tailscale serve reset` only when this node has no other Serve
configuration to preserve. Check `tailscale serve get-config --all` first if
there is any chance the node serves other private services.

## Remote Header Guard

The backend treats no-PIN remote/proxy access as unsafe. Requests that arrive
with forwarded host headers or non-local host context are rejected in no-PIN
mode unless `HVC_ALLOW_NO_PIN_REMOTE=true` is set intentionally. For normal
Tailscale Serve operation, use the PIN session path instead of the override.
`pnpm env:check` rejects the override for release and private-deployment
rehearsal.

See [the private network runbook](runbooks/private-network.md) for the full
copy-paste rehearsal, unsafe config probes, evidence redaction rules, and
rollback checklist.
