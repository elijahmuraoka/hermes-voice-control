# Backlog

Open work not yet scoped into its own spec.

## Verification

- [ ] Start the FastAPI backend and Vite app together, then rerun
  `scripts/browser-responsive.spec.ts` against `http://127.0.0.1:5173`.
- [ ] Run `scripts/e2e-real-gemini-live.mjs` with real Gemini credentials and
  record the redacted result in the active spec.
- [ ] Do a fresh independent final review after the live Gemini/browser smoke,
  because the existing review reports predate some hardening fixes.

## Release Hygiene

- [ ] Choose the Git remote owner and visibility, add `origin`, then push
  `main`. This repo currently has no remote configured.
- [ ] Decide whether the untracked review screenshots should be committed with
  the review evidence or regenerated on demand.
- [ ] Add CI once the remote exists: `pnpm test`, `pnpm build`,
  `tomoji docs audit`, and `tomoji docs index --verify`.

## Product Decisions

- [ ] Choose the default Gemini voice/personality once real audio is stable.
- [ ] Decide whether `LocalHermesAdapter` remains read-only forever or later
  supports confirmation-gated local actions.
- [ ] Revisit LiveKit/Pipecat only if HVC needs multi-device rooms, telephony,
  or provider-neutral media pipelines.
