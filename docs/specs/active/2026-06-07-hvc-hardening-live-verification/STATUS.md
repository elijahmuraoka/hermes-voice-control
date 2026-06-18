# Status

## 2026-06-07

- Doc-maintenance initialized `VISION.md`, `BACKLOG.md`, and the active spec
  bundle.
- Existing flat docs were migrated into canonical `docs/context/**` locations.
- Open-source voice-system research was added under `docs/context/research/`.
- `tomoji docs index --verify --json` passed.
- `tomoji docs audit --json` passed with zero findings.
- `pnpm test` and `pnpm build` passed in the current working tree.
- Real Gemini Live smoke had not yet run on 2026-06-07; the 2026-06-08
  evidence below supersedes that gap.
- Public repo target selected:
  `https://github.com/elijahmuraoka/hermes-voice-control`.
- Public README and visible app copy were generalized from a named local
  persona to a configurable Hermes agent via `HVC_AGENT_NAME` /
  `VITE_HVC_AGENT_NAME`.
- README screenshots were regenerated with local Vite plus Chrome DevTools
  Protocol at 390x844 and 1280x900. The README now embeds one mobile screenshot
  and one desktop screenshot.
- `pnpm test`, `pnpm build`, `tomoji docs index --verify --json`,
  `tomoji docs audit --json`, and `git diff --check` passed after the
  generalization pass.
- GitHub issues #1-#10 were created from the production-readiness audit.
- CI now runs tests, build, browser smoke, and repo-contained docs verification.
  Dependabot, root `pnpm docs:verify`, and root `pnpm smoke:browser` were added.
- `pnpm smoke:browser` passed four responsive viewport checks and skipped only
  the explicitly gated real backend token-flow test.
- Backend hardening added configurable secure cookies, a default-disabled logs
  endpoint, `/readyz`, and tests for those controls.
- Follow-up productionization added generic `ask_agent`/`agent-*` identifiers
  with `ask_bob` compatibility, private-network runbook/env validation, audit
  log pruning, DB writeability readiness, reduced-motion/focus browser checks,
  bundle-size budget, screenshot update script, and read-only v1 action
  semantics.
- Follow-up verification passed `pnpm env:check`, `pnpm verify`,
  `tomoji docs index --verify --json`, `tomoji docs audit --json`,
  `pnpm smoke:browser`, and `git diff --check`.

## 2026-06-08

- Second-wave production launch plan added under
  `plans/2026-06-08-end-to-end-production-plan.md`.
- GitHub issues #12-#20 were created for provider bakeoff, provider adapter
  design, private deployment rehearsal, security threat modeling, real Hermes
  bridge verification, latency instrumentation, final review, open-source
  release safety, and mobile/audio QA.
- Issue #12 provider bakeoff decision artifact added under
  `docs/context/research/realtime-provider-bakeoff.md`.
- Decision: keep Gemini Live as the v1 default for this repo's private
  browser-to-Hermes use case. OpenAI Realtime and xAI Grok Voice Agent are the
  first alternates to benchmark; ElevenLabs Agents is deferred unless HVC needs
  managed hosted agents, telephony, monitoring/evals, or deeper voice catalog
  operations.
- Blocker: no provider credentials were available in this docs lane, so
  credentialed Gemini plus alternate-provider smoke and latency results remain
  pending for #12.
- Issues #14 and #19 release/deployment gate pass added copy-paste private
  network rehearsal steps, rollback, health checks, evidence redaction, public
  release checklist, fresh-checkout mock setup, and secret/history scan rules.
- `scripts/validate-env.mjs` now rejects wildcard
  `HVC_FRONTEND_ORIGINS='*'` and the `HVC_ALLOW_NO_PIN_REMOTE=true`
  diagnostic override during release env checks.
- Local private-deployment rehearsal passed in mock mode with backend bound to
  `127.0.0.1:8765`, PIN required, logs disabled, `/healthz` 200, `/readyz`
  200 with database `ok`, unauthenticated `/auth/session` 401, and PIN login
  200. Rehearsal SQLite state was removed afterward.
- Live Tailscale Serve was not mutated: read-only `tailscale status` and
  `tailscale serve status --json` both returned `Failed to load preferences`,
  so account/tailnet state could not be verified before a Serve change.
- Open-source gate scan found no tracked `.env` files beyond `.env.example`, no
  untracked non-ignored files, no private artifact paths in history beyond
  `.env.example`, and no high-entropy token/history hits beyond the documented
  scan pattern text itself. Broader env/cookie-name hits were limited to
  placeholders, code paths, and redaction tests.
- Issue #15 security gate completed the production threat register in
  `docs/context/security-model.md` and added a dated local security review
  under this active spec.
- Backend hardening removed the raw session token from successful PIN-login
  JSON responses and made free-text tool audit logs metadata-only.
- Security regression coverage now checks cookie-only PIN login, real Gemini
  token constraints, raw prompt/transcript/result omission from audit logs,
  validation-error input stripping, and confirmation-summary audit omission.
- Verification passed `uv run --extra dev pytest`, `pnpm test`,
  `pnpm env:check`, `pnpm docs:verify`,
  `tomoji docs index --verify --json`, `tomoji docs audit --json`,
  `git diff --check`, and `pnpm verify`.
- Strict independent external review remains blocked unless the user explicitly
  approves exporting branch contents or local agent review tooling is repaired.
- Issue #16 implementation adds local Hermes adapter readiness diagnostics,
  malformed empty-output handling, configurable adapter timeout, fake-process
  contract coverage, and an opt-in real local Hermes harness.
- The real local Hermes harness refuses accidental execution unless
  `HVC_REAL_HERMES_HARNESS=1` is set and records redacted evidence under the
  active spec bundle.
- The 2026-06-08 local harness run resolved `/opt/homebrew/bin/hermes` and
  exercised `ask_agent`, `ask_bob`, and no-action probes through the read-only
  safe command. The refreshed run passed with `blocker: null`.
- The local adapter now invokes Hermes in quiet query mode so stdout contains
  only the final speakable answer before returning it to the browser or harness
  evidence, while CLI provider failures still surface as controlled errors.
- Real Gemini Live smoke passed against a loopback backend started with the
  `real-gemini` optional dependency. The redacted evidence is in
  `evidence/gemini-live-smoke-latest.json` and confirms real mode, the
  `gemini-2.5-flash-native-audio-latest` model, the `setupComplete` handshake,
  and observed audio output.
- Issue #13 provider-neutral frontend boundary added under
  `apps/web/src/realtime/`. Gemini remains the only registered v1 provider, and
  future providers must use backend-minted ephemeral credentials or signed
  sessions rather than browser API keys.

## 2026-06-09

- PR #32 merged the tracked private Tailscale deployment runner into `main`.
  The merged path replaces the ignored rehearsal proxy/backend scripts with
  `pnpm private:tailscale -- --serve`, `--local`, and `--smoke` modes.
- Post-merge verification on `main` passed:
  `pnpm install --frozen-lockfile`, `pnpm verify`, `pnpm smoke:browser`,
  `pnpm env:check`, `tomoji docs audit --json`,
  `tomoji docs index --verify --json`, `git diff --check`, and syntax checks
  for both private runner scripts.
- Independent `codex-review --full-access` found no actionable correctness,
  security, or regression issues after the private runner, auth gate, proxy,
  and realtime-auth changes.
- `tomoji docs reconcile --yes` ran after the merge. It shipped no bundles and
  reported this active bundle has no PR signal, so it remains active until the
  remaining physical/mobile QA scope is resolved.
- The live private URL is
  `https://bobs-mac-mini.tail764d71.ts.net/`. Tailscale Serve is tailnet-only
  and proxies `/` to `http://127.0.0.1:8787`.
- The live tracked runner is running in `HVC_GEMINI_MODE=real` with
  `HVC_REQUIRE_PIN=true`, `HVC_SECURE_COOKIES=true`, logs endpoint disabled,
  backend bound to `127.0.0.1:8765`, and the one-origin proxy bound to
  `127.0.0.1:8787`.
- Live checks passed through the Tailscale URL: `/readyz` reported real Gemini
  mode, configured Gemini API key, available local Hermes adapter, and PIN
  required; unauthenticated `/auth/session` returned 401; PIN login returned an
  authenticated session; `/gemini/ephemeral-token` returned a real
  `gemini-2.5-flash-native-audio-latest` ephemeral token; `/chat/text`
  completed through the local read-only Hermes adapter.
- Visual fallback screenshot captured the unauthenticated mobile PIN gate at
  `.private/deployment/live-pin-mobile.png`. The in-app browser bridge was
  unavailable because its local runtime points `CODEX_HOME` at a missing path.
- Remaining known launch limitations: physical device/mobile audio QA is still
  tracked by #20, GitHub Actions Node.js deprecation is tracked by #30, and the
  durable launchd/service wrapper for the live runner is tracked by #33.
- Issue #33 implementation added a tracked macOS LaunchDaemon wrapper around
  `pnpm private:tailscale -- --serve`. The generated plist references only
  paths, loads secrets from an ignored chmod-600 env file, writes logs under
  `.private/deployment/logs/`, and documents render, install, bootstrap,
  kickstart, status, stop, and rollback commands. Installing or kickstarting
  the LaunchDaemon remains operator-approved local machine state.
