# Open-source boundary

Safe to open-source:

- UI and orb state machine
- backend auth/session/token broker patterns
- mock Gemini/Hermes adapters
- Tailscale-local deployment docs
- tool policy and confirmation queue patterns
- Gemini Live protocol wrapper and test scaffolding, after secret scanning
- generic comparison/research docs

Keep local/private:

- `.env`, `.env.*`, `.private/**`, local SQLite files, logs, and transcript
  captures.
- PINs, cookies, session ids, bearer tokens, Gemini/Google API keys, Tailscale
  auth/API keys, and local Hermes credentials.
- Tailscale account emails, tailnet names, MagicDNS hostnames, private
  Tailscale IPs, and device names.
- Personal prompt/context/memory files and screenshots that show private local
  context.

The `ask_bob` tool name is a documented compatibility alias in code and tests.
Do not add new local-only names to public docs or visible app copy.

## Fresh-Checkout Mock Gate

The public setup must work without private credentials or local machine state.

```bash
export HVC_RELEASE_CANDIDATE_REF='refs/pull/NUMBER/head'
tmpdir="$(mktemp -d)"
git clone --no-checkout https://github.com/elijahmuraoka/hermes-voice-control.git "$tmpdir/hermes-voice-control"
cd "$tmpdir/hermes-voice-control"
git fetch --depth=1 origin "$HVC_RELEASE_CANDIDATE_REF"
git checkout --detach FETCH_HEAD
git rev-parse HEAD

pnpm install
cd apps/server
uv venv
uv pip install -e '.[dev]'
cd ../..

pnpm env:check
pnpm verify
```

Expected:

- `HVC_RELEASE_CANDIDATE_REF` is set to the exact branch, tag, commit SHA, or
  pull-request ref being reviewed. The gate must not accidentally test only the
  repository default branch before the candidate is merged.
- No `.env` file is required.
- `HVC_GEMINI_MODE=mock` and `HVC_HERMES_ADAPTER=mock` are the defaults.
- No Gemini quota, local Hermes binary, Tailscale account, or personal context
  is required.
- README setup steps are generic and refer to "your Hermes agent" or the
  configurable `HVC_AGENT_NAME` / `VITE_HVC_AGENT_NAME`, not a specific local
  operator.

## Secret And History Scan

Run these before a public release PR is marked ready:

```bash
git status --short
git ls-files -o --exclude-standard
git ls-files
git log --all --name-only --pretty=format: | sort -u
```

Inspect the tracked and historical file lists for:

- `.env`, `.env.*` except `.env.example`.
- `.private/**`, `logs/**`, `*.sqlite`, `*.sqlite3`, `*.sqlite3-*`, and
  transcript captures.
- Screenshots or docs with local paths, account names, tailnet names, MagicDNS
  hostnames, or private IPs.

Run a content scan and treat hits outside documented placeholders/tests as
blockers:

```bash
git grep -n -I -E 'AIza[0-9A-Za-z_-]{20,}|sk-[A-Za-z0-9_-]{20,}|tskey-|BEGIN (RSA|OPENSSH|EC|PRIVATE) KEY|GEMINI_API_KEY|GOOGLE_API_KEY|HVC_PIN|Set-Cookie|hvc_session' -- .
git log --all -G 'AIza[0-9A-Za-z_-]{20,}|sk-[A-Za-z0-9_-]{20,}|tskey-|BEGIN (RSA|OPENSSH|EC|PRIVATE) KEY|GEMINI_API_KEY|GOOGLE_API_KEY|HVC_PIN|Set-Cookie|hvc_session' --oneline -- .
```

Allowed hits:

- `.env.example` placeholder names.
- README/setup docs that name environment variables without values.
- Source-code references to environment variable names, cookie names, or header
  names without real values.
- Tests that assert redaction behavior using fake values.
- This boundary document's scan patterns.

Everything else needs classification. Real credential values, private hostnames,
private IPs, cookies, or session ids need removal, rotation if exposed, and a
history-rewrite decision before tagging.

## Evidence Redaction

Record release-gate evidence as a short summary in the active spec. Do not paste
raw command output when it contains hostnames, paths under a user home
directory, cookies, or auth headers.

Use this format:

```text
2026-06-08 open-source gate:
- fresh checkout mock setup: pass/fail
- pnpm env:check: pass/fail
- pnpm verify: pass/fail
- secret/history scan: no unresolved private artifacts / blockers listed
- private-network rehearsal: local pass; Tailscale Serve pass or approved skip
```

## v1.0 Release Checklist

Do not tag v1.0 until all of these are true:

- #14 private deployment rehearsal evidence is recorded, including rollback and
  any approved skip for live Tailscale Serve.
- #19 fresh-checkout mock gate and secret/history scan are recorded with no
  unresolved private artifacts.
- `pnpm verify`, `pnpm smoke:browser`, `pnpm env:check`,
  `pnpm docs:verify`, `tomoji docs index --verify --json`, and
  `tomoji docs audit --json` pass on the release candidate.
- The README remains generic and mock-first.
- The public branch contains no `.env*` except `.env.example`, no `.private/**`,
  no logs, no SQLite state, and no untracked release artifacts.
- Credentialed real Gemini Live evidence is recorded or the release explicitly
  ships as mock/private-deployment-ready while issue #3 remains open.
- Final independent review/launch gate issue #18 is closed or explicitly
  deferred with owner and reason.
