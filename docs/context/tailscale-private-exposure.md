# Tailscale private exposure

Do not run this until local verification passes and the operator explicitly
approves private-network exposure.

Required shape:

```bash
# FastAPI remains bound to localhost.
export HVC_HOST=127.0.0.1
export HVC_REQUIRE_PIN=true
if [ -t 0 ]; then
  printf "HVC PIN: "
  stty -echo
  IFS= read -r HVC_PIN
  stty echo
  printf "\n"
else
  IFS= read -r HVC_PIN
fi
export HVC_PIN
export HVC_SECURE_COOKIES=true
export HVC_ALLOW_LOGS_ENDPOINT=false

pnpm env:check
```

Start or restart the backend with those private-network environment variables
before configuring Serve:

```bash
cd apps/server
uv run uvicorn app.main:app --host "$HVC_HOST" --port "${HVC_PORT:-8765}"
```

Then, from another terminal, capture existing Serve state and expose the running
localhost backend:

```bash
mkdir -p .private/rehearsal
tailscale serve get-config .private/rehearsal/tailscale-serve-before.json --all
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
if [ -t 0 ]; then
  printf "HVC PIN: "
  stty -echo
  IFS= read -r HVC_PIN
  stty echo
  printf "\n"
else
  IFS= read -r HVC_PIN
fi
export HVC_PIN
```

Keep the server bound to `127.0.0.1`. Do not set
`HVC_ALLOW_REMOTE_BIND=true` for the standard Tailscale Serve path.

Do not set `HVC_ALLOW_NO_PIN_REMOTE=true` for private deployment. That override
exists for explicit local diagnostics, not for an HVC release candidate.

Use exact frontend origins only:

```bash
export HVC_FRONTEND_ORIGINS='http://127.0.0.1:5173,http://localhost:5173,https://FRONTEND_DEVICE.TAILNET.ts.net'
```

When the frontend runs on a separate private origin, set its API base before
starting Vite or building static assets so remote browsers call the backend
device instead of their own loopback:

```bash
export VITE_API_BASE='https://BACKEND_DEVICE.TAILNET.ts.net'
pnpm dev:web
```

For one-origin reverse-proxy hosting, route the backend endpoints through the
same origin and build or start the frontend with a relative API base:

```bash
export VITE_API_BASE=''
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

Restore the Serve configuration captured before the rehearsal:

```bash
tailscale serve set-config .private/rehearsal/tailscale-serve-before.json --all
tailscale serve status --json
```

Use `tailscale serve reset` only when the node is dedicated to HVC, no saved
preflight config exists, and the operator confirms there is no other Serve
configuration to preserve.

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
