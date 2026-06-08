# Status

## 2026-06-07

- Doc-maintenance initialized `VISION.md`, `BACKLOG.md`, and the active spec
  bundle.
- Existing flat docs were migrated into canonical `docs/context/**` locations.
- Open-source voice-system research was added under `docs/context/research/`.
- `tomoji docs index --verify --json` passed.
- `tomoji docs audit --json` passed with zero findings.
- `pnpm test` and `pnpm build` passed in the current working tree.
- Real Gemini Live smoke remains pending until credentials are available.
- Public repo target selected:
  `https://github.com/elijahmuraoka/hermes-voice-control`.
- Public README and visible app copy were generalized from a named local
  persona to a configurable Hermes agent via `VITE_HVC_AGENT_NAME`.
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
- Issue #13 provider-neutral frontend boundary added under
  `apps/web/src/realtime/`. Gemini remains the only registered v1 provider, and
  future providers must use backend-minted ephemeral credentials or signed
  sessions rather than browser API keys.
