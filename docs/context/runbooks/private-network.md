# Private Network Runbook

Use this when exposing Hermes Voice Control beyond direct localhost, especially
through Tailscale Serve.

The default posture is still localhost first. Tailscale Serve is a private
tailnet exposure step, not a reason to bind FastAPI to a public interface.

## Required Private-Network Posture

```bash
export HVC_HOST=127.0.0.1
export HVC_PORT=8765
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
export HVC_AUDIT_LOG_RETENTION_DAYS=30
export HVC_AUDIT_LOG_MAX_ROWS=5000
export HVC_GEMINI_MODE=mock
export HVC_HERMES_ADAPTER=mock
```

Run the validator before starting the server:

```bash
pnpm env:check
```

Keep unsafe public exposure out of scope for v1:

- Do not bind the backend to `0.0.0.0` for Tailscale Serve. Keep
  `HVC_HOST=127.0.0.1`.
- Do not use Tailscale Funnel or any public reverse proxy without a separate
  auth, rate-limit, and logging review.
- Do not use `HVC_ALLOW_NO_PIN_REMOTE=true` for a private deployment. Use the
  PIN session path.
- Do not use wildcard CORS. `HVC_FRONTEND_ORIGINS=*` is unsafe with
  credentialed browser requests.
- Do not enable `/logs` except during a trusted debugging session.

## Fresh Local Mock Rehearsal

Use this to prove the production build, backend startup, readiness, auth guard,
and rollback without touching Gemini quota, local Hermes, or Tailscale state.

From a fresh checkout:

```bash
pnpm install
cd apps/server
uv venv
uv pip install -e '.[dev]'
cd ../..
```

Set a rehearsal-only PIN and keep the database under ignored local state:

```bash
export HVC_REHEARSAL_DIR="$PWD/.private/rehearsal"
mkdir -p "$HVC_REHEARSAL_DIR"
export HVC_PIN_FILE="$HVC_REHEARSAL_DIR/hvc-pin"
openssl rand -hex 12 > "$HVC_PIN_FILE"
chmod 600 "$HVC_PIN_FILE"

export HVC_GEMINI_MODE=mock
export HVC_HERMES_ADAPTER=mock
export HVC_HOST=127.0.0.1
export HVC_PORT=8765
export HVC_REQUIRE_PIN=true
export HVC_PIN="$(cat "$HVC_PIN_FILE")"
export HVC_SECURE_COOKIES=false
export HVC_ALLOW_LOGS_ENDPOINT=false
export HVC_DB_PATH="$HVC_REHEARSAL_DIR/hvc.sqlite3"

pnpm env:check
pnpm --filter @hvc/web build
```

`HVC_SECURE_COOKIES=false` is only for the localhost HTTP rehearsal. Switch it
back to `true` before HTTPS private-network exposure.

Start the backend in one terminal:

```bash
cd apps/server
uv run uvicorn app.main:app --host "$HVC_HOST" --port "$HVC_PORT"
```

Run health and auth checks from another terminal. Reload the same
rehearsal-only PIN from ignored local state before the positive login check:

```bash
export HVC_REHEARSAL_DIR="$PWD/.private/rehearsal"
export HVC_PIN="$(cat "$HVC_REHEARSAL_DIR/hvc-pin")"
curl -fsS http://127.0.0.1:8765/healthz
curl -fsS http://127.0.0.1:8765/readyz
curl -i http://127.0.0.1:8765/auth/session
curl -i -X POST http://127.0.0.1:8765/auth/pin \
  -H 'Content-Type: application/json' \
  --data "{\"pin\":\"$HVC_PIN\"}"
```

Expected results:

- `/healthz` returns `{"ok":true}`.
- `/readyz` returns HTTP 200 with `ok: true`, `database: "ok"`,
  `gemini_mode: "mock"`, `gemini_client_available: true`,
  `pin_required: true`, and `logs_endpoint_enabled: false`.
- `/auth/session` returns HTTP 401 until a valid PIN session is established.
- The PIN value, `Set-Cookie` header, session ids, hostnames, and tailnet names
  are not copied into committed evidence.

Stop the backend with `Ctrl-C` when the local rehearsal is complete.

## Unsafe Config Probes

These probes should fail before startup:

```bash
HVC_HOST=0.0.0.0 pnpm env:check
HVC_HOST=0.0.0.0 HVC_ALLOW_REMOTE_BIND=true HVC_REQUIRE_PIN=false pnpm env:check
HVC_ALLOW_NO_PIN_REMOTE=true pnpm env:check
HVC_FRONTEND_ORIGINS='*' pnpm env:check
HVC_REQUIRE_PIN=true HVC_PIN=00000000 pnpm env:check
HVC_GEMINI_MODE=real GEMINI_API_KEY= GOOGLE_API_KEY= pnpm env:check
```

Treat a passing unsafe probe as a release blocker.

## Local Hermes mode

```bash
export HVC_GEMINI_MODE=mock
export HVC_HERMES_ADAPTER=local
export HVC_HERMES_BIN=hermes
pnpm env:check
pnpm dev
```

`pnpm env:check` fails if the Hermes binary cannot be resolved. The local
adapter invokes only `hermes chat -Q -q <prompt> --toolsets safe`.

## Real Gemini mode

```bash
export HVC_GEMINI_MODE=real
export HVC_GEMINI_MODEL=gemini-2.5-flash-native-audio-latest
export GEMINI_API_KEY=<redacted>
pnpm env:check
cd apps/server && uv pip install -e '.[dev,real-gemini]'
```

Start the backend in one terminal:

```bash
cd apps/server
export HVC_GEMINI_MODE=real
export GEMINI_API_KEY=<redacted>
uv run --extra dev --extra real-gemini uvicorn app.main:app --host 127.0.0.1 --port 8765
```

Verify readiness from another terminal:

```bash
curl http://127.0.0.1:8765/readyz
```

`/readyz` returns `503` when real mode is selected without a configured API key
or without the `google-genai` client installed.

## Tailscale Serve Rehearsal

Do not run this section until the local rehearsal passes and the operator
explicitly approves private-network exposure on the current machine.

Preflight:

```bash
tailscale status
tailscale serve status --json
mkdir -p .private/rehearsal
```

Use the tracked private runner for a one-origin deployment. It builds the web
app with a relative API base, starts FastAPI on localhost, starts a localhost
static/proxy server for the built app, verifies readiness plus PIN auth, and
only configures Tailscale Serve when `--serve` is passed.

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

HVC_PIN_FILE=.private/rehearsal/hvc-pin.txt pnpm private:tailscale -- --serve
```

Then check from another tailnet device:

```bash
curl -fsS 'https://DEVICE.TAILNET.ts.net/readyz'
curl -i 'https://DEVICE.TAILNET.ts.net/auth/session'
```

Expected results:

- Tailscale Serve reports an HTTPS reverse proxy to `127.0.0.1:8787`.
- `/readyz` returns HTTP 200 with the same safe posture as the local rehearsal.
- `/auth/session` returns HTTP 401 before PIN login.
- `tailscale funnel status` shows tailnet-only Serve state and no public Funnel
  exposure; the runner fails closed if Funnel status cannot be verified.
- The web app, auth, and API share the same private HTTPS origin.
- The runner prints the path of the pre-change Tailscale Serve status snapshot.
- The runner refuses to overwrite a non-empty Serve config unless it already
  points at the same HVC proxy target.
- The runner rejects `--smoke --serve`; smoke runs are non-mutating and should
  be followed by a separate long-lived `--serve` deployment.
- The runner rejects `--no-build --serve`; private Serve deployments always
  rebuild with a same-origin API base.
- The runner requires an explicit mode: `--smoke`, `--local`, or `--serve`.
  Use `--local` only for a long-lived localhost-only soak without changing
  Tailscale Serve.
- Non-serve modes print the localhost URL and refuse to start if Tailscale Serve
  already references the selected proxy or backend port.
- Use the printed `localhost` URL for local browser testing; the services still
  bind to `127.0.0.1`, but secure cookies are not consistently accepted by
  browsers on plain-HTTP `127.0.0.1` origins.
- If `--serve` configures a previously empty Serve state and post-config
  verification fails, the runner resets Serve automatically before exiting.

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

Then stop the local backend and clean rehearsal-only state:

```bash
export HVC_REHEARSAL_DIR="$PWD/.private/rehearsal"
rm -f "$HVC_REHEARSAL_DIR"/hvc.sqlite3 "$HVC_REHEARSAL_DIR"/hvc.sqlite3-*
```

Rollback is complete only when:

- No Tailscale Serve entry points remain for HVC.
- No Tailscale Funnel entry points are active.
- `curl http://127.0.0.1:8765/healthz` fails after the backend is stopped.
- The ignored `.private/rehearsal` database files are removed or intentionally
  retained outside Git.

## Evidence Redaction

Record evidence in the active spec using summaries, not raw secrets.

Allowed:

- Command names and pass/fail status.
- Redacted `/readyz` keys such as `ok`, `database`, `gemini_mode`,
  `gemini_client_available`, `pin_required`, and `logs_endpoint_enabled`.
- Whether Tailscale Serve and rollback were executed or intentionally skipped.

Do not commit:

- `HVC_PIN`, Gemini/Google API keys, cookies, session ids, bearer tokens, or
  `Set-Cookie` headers.
- Tailnet names, MagicDNS hostnames, private Tailscale IPs, device names, or
  account emails unless already intended for public docs.
- Transcript logs, SQLite databases, `.env*` files, `.private/**`, screenshots
  containing private local context, or raw Tailscale status JSON.

## Failure Modes

- `Non-local HVC_HOST requires HVC_ALLOW_REMOTE_BIND=true`: keep the backend on
  `127.0.0.1` and use a private reverse proxy.
- `Remote/private-network access requires HVC_REQUIRE_PIN=true`: set a strong
  PIN before private-network exposure.
- `HVC_ALLOW_NO_PIN_REMOTE=true is a diagnostic override`: unset it for any
  release or private-network rehearsal.
- `HVC_FRONTEND_ORIGINS must not include wildcard '*'`: use exact localhost or
  private HTTPS origins.
- `HVC_GEMINI_MODE=real requires GEMINI_API_KEY or GOOGLE_API_KEY`: configure
  credentials on the backend only.
- `gemini_client_available=false` in `/readyz`: install the real Gemini extra
  with `cd apps/server && uv pip install -e '.[dev,real-gemini]'`.
- `HVC_HERMES_ADAPTER=local requires HVC_HERMES_BIN`: install Hermes or point
  `HVC_HERMES_BIN` at the executable.
- `tailscale serve status` fails locally: do not mutate Serve state until the
  local Tailscale client is healthy and the active account/tailnet are known.
