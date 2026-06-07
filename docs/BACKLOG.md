# Backlog

Open work not yet scoped into its own spec.

## Verification

- [x] Start the Vite app and run `pnpm smoke:browser` against
  `http://127.0.0.1:5173`.
- [ ] Run `scripts/e2e-real-gemini-live.mjs` with real Gemini credentials and
  record the redacted result in the active spec.
- [ ] Do a fresh independent final review after the live Gemini/browser smoke,
  because the existing review reports predate some productionization fixes.

## Release Hygiene

- [x] Choose the Git remote owner and visibility, add `origin`, then push
  `main`.
- [ ] Decide whether the untracked review screenshots should be committed with
  the review evidence or regenerated on demand.
- [x] Add CI once the remote exists: `pnpm test`, `pnpm build`,
  `pnpm smoke:browser`, and a repo-contained docs verification gate.
- [x] Add dependency update policy and remove frontend `latest` dependency
  specs.

## GitHub Production Issues

- [#1](https://github.com/elijahmuraoka/hermes-voice-control/issues/1):
  CI for tests, build, docs audit, and smoke prerequisites.
- [#2](https://github.com/elijahmuraoka/hermes-voice-control/issues/2):
  Playwright responsive smoke from a fresh checkout.
- [#3](https://github.com/elijahmuraoka/hermes-voice-control/issues/3):
  real Gemini Live setup and credentialed smoke verification.
- [#4](https://github.com/elijahmuraoka/hermes-voice-control/issues/4):
  auth, cookies, and log access hardening.
- [#5](https://github.com/elijahmuraoka/hermes-voice-control/issues/5):
  generic internal agent/tool identifiers.
- [#6](https://github.com/elijahmuraoka/hermes-voice-control/issues/6):
  dependency version pinning and update policy.
- [#7](https://github.com/elijahmuraoka/hermes-voice-control/issues/7):
  one-command local/dev production runbooks and env validation.
- [#8](https://github.com/elijahmuraoka/hermes-voice-control/issues/8):
  production health, observability, and log-retention controls.
- [#9](https://github.com/elijahmuraoka/hermes-voice-control/issues/9):
  UX, accessibility, and performance QA.
- [#10](https://github.com/elijahmuraoka/hermes-voice-control/issues/10):
  confirmation-gated action semantics.

## Product Decisions

- [ ] Choose the default Gemini voice/personality once real audio is stable.
- [ ] Decide whether `LocalHermesAdapter` remains read-only forever or later
  supports confirmation-gated local actions.
- [ ] Revisit LiveKit/Pipecat only if HVC needs multi-device rooms, telephony,
  or provider-neutral media pipelines.
