# Tailscale private exposure

Do not run this until local verification passes and the operator explicitly
approves private-network exposure.

Required shape:

```bash
umask 077
mkdir -p .private/rehearsal
if [ -t 0 ]; then
  printf "HVC PIN: "
  stty -echo
  IFS= read -r HVC_PIN
  stty echo
  printf "\n"
else
  IFS= read -r HVC_PIN
fi
printf "%s\n" "$HVC_PIN" > .private/rehearsal/hvc-pin.txt
```

Start the supported one-origin private runner. It keeps FastAPI and the static
frontend/API proxy bound to localhost, requires PIN auth, uses secure cookies,
keeps `/logs` disabled, and configures Tailscale Serve only when `--serve` is
provided. Before changing Serve, it snapshots `tailscale serve status --json`
and refuses to overwrite a non-empty config unless it already points at the
same HVC proxy target:

```bash
HVC_PIN_FILE=.private/rehearsal/hvc-pin.txt pnpm private:tailscale -- --serve
```

Use Tailscale Serve, not Funnel. Tailscale Serve shares a local service inside
the tailnet; Tailscale Funnel exposes a service publicly on the internet and is
out of scope for v1.
The private runner fails closed if Funnel status cannot prove the endpoint is
tailnet-only, and it rejects `--smoke --serve` so smoke checks cannot leave a
stale Serve endpoint behind. It also rejects `--no-build --serve` so private
deployments do not publish a stale bundle with a localhost API base. The runner
requires an explicit mode: `--smoke`, `--local`, or `--serve`; use `--local`
only for a long-lived localhost-only soak. Non-serve modes print the localhost
URL and refuse to start if Tailscale Serve already references the selected
proxy or backend port. Use the printed `localhost` URL for local browser
testing; the services still bind to `127.0.0.1`, but secure cookies are not
consistently accepted by browsers on plain-HTTP `127.0.0.1` origins. If
`--serve` configures a previously empty Serve state and post-config verification
fails, the runner resets Serve automatically before exiting.

Because Tailscale Serve forwards traffic through a local reverse proxy, enable
app-level PIN/session auth before exposing the privileged tool surface to any
remote browser.

Current v1 default: no-PIN mode is for direct localhost development only. For
Tailscale Serve, the private runner sets:

```bash
HVC_REQUIRE_PIN=true
HVC_SECURE_COOKIES=true
HVC_ALLOW_LOGS_ENDPOINT=false
```

Keep the server bound to `127.0.0.1`. Do not set
`HVC_ALLOW_REMOTE_BIND=true` for the standard Tailscale Serve path.

Do not set `HVC_ALLOW_NO_PIN_REMOTE=true` for private deployment. That override
exists for explicit local diagnostics, not for an HVC release candidate.

The private runner uses one-origin reverse-proxy hosting. It routes backend
endpoints through the same origin and builds the frontend with a relative API
base:

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

Use the rollback line printed by the runner. When there was no previous Serve
config, the rollback is:

```bash
tailscale serve reset
tailscale serve status --json
```

When the previous config already pointed at the same HVC proxy target, no Serve
rollback is needed. The saved status snapshot is evidence, not a `set-config`
file; do not feed it to `tailscale serve set-config`.

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
