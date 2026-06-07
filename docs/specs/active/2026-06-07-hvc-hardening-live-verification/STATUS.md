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
