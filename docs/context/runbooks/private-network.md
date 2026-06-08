# Private Network Runbook

Use this when exposing Hermes Voice Control beyond direct localhost, especially
through Tailscale Serve.

## Required posture

```bash
export HVC_HOST=127.0.0.1
export HVC_REQUIRE_PIN=true
export HVC_PIN=<at-least-8-chars-not-common>
export HVC_SECURE_COOKIES=true
export HVC_ALLOW_LOGS_ENDPOINT=false
export HVC_AUDIT_LOG_RETENTION_DAYS=30
export HVC_AUDIT_LOG_MAX_ROWS=5000
```

Run the validator before starting the server:

```bash
pnpm env:check
```

Keep unsafe public exposure out of scope for v1:

- Do not bind the backend to `0.0.0.0` unless `HVC_ALLOW_REMOTE_BIND=true` is
  deliberately set after review.
- Do not use Tailscale Funnel or any public reverse proxy without a separate
  auth, rate-limit, and logging review.
- Do not enable `/logs` except during a trusted debugging session.

## Mock mode

```bash
export HVC_GEMINI_MODE=mock
export HVC_HERMES_ADAPTER=mock
pnpm env:check
pnpm dev
```

Use mock mode for UI and access-control checks. It should not require Gemini
quota or a local Hermes binary.

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

## Tailscale Serve

Keep FastAPI bound to localhost and expose that local port through Tailscale:

```bash
tailscale serve --bg http://127.0.0.1:8765
```

Serve the frontend separately from the built static assets or through a local
frontend process on `127.0.0.1:5173`. Confirm the browser origin is listed in
`HVC_FRONTEND_ORIGINS`.

## Failure Modes

- `Non-local HVC_HOST requires HVC_ALLOW_REMOTE_BIND=true`: keep the backend on
  `127.0.0.1` and use a private reverse proxy.
- `Remote/private-network access requires HVC_REQUIRE_PIN=true`: set a strong
  PIN before private-network exposure.
- `HVC_GEMINI_MODE=real requires GEMINI_API_KEY or GOOGLE_API_KEY`: configure
  credentials on the backend only.
- `gemini_client_available=false` in `/readyz`: install the real Gemini extra
  with `cd apps/server && uv pip install -e '.[dev,real-gemini]'`.
- `HVC_HERMES_ADAPTER=local requires HVC_HERMES_BIN`: install Hermes or point
  `HVC_HERMES_BIN` at the executable.
