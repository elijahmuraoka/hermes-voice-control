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
  generic internal agent/tool identifiers. Implemented by `ask_agent`,
  `agent-*` states, and `agent` transcript role; `ask_bob` remains a backend
  compatibility alias.
- [#6](https://github.com/elijahmuraoka/hermes-voice-control/issues/6):
  dependency version pinning and update policy.
- [#7](https://github.com/elijahmuraoka/hermes-voice-control/issues/7):
  one-command local/dev production runbooks and env validation. Implemented
  with `pnpm dev`, `pnpm env:check`, and the private-network runbook.
- [#8](https://github.com/elijahmuraoka/hermes-voice-control/issues/8):
  production health, observability, and log-retention controls. Implemented
  with `/readyz`, DB writeability checks, log pruning, and tests.
- [#9](https://github.com/elijahmuraoka/hermes-voice-control/issues/9):
  UX, accessibility, and performance QA. Implemented with responsive,
  keyboard/focus, reduced-motion, screenshot, and bundle-budget checks.
- [#10](https://github.com/elijahmuraoka/hermes-voice-control/issues/10):
  confirmation-gated action semantics. Decided as read-only v1; approvals
  record intent only and do not execute external actions.

## Product Decisions

- [ ] Choose the default Gemini voice/personality once real audio is stable.
- [x] Decide v1 action semantics: `LocalHermesAdapter` stays read-only and
  confirmation approval records intent only. A future executor would need its
  own design and issue.
- [ ] Revisit LiveKit/Pipecat only if HVC needs multi-device rooms, telephony,
  or provider-neutral media pipelines.

## Launch Plan Issues

- [#12](https://github.com/elijahmuraoka/hermes-voice-control/issues/12):
  realtime voice provider bakeoff and v1 default decision.
- [#13](https://github.com/elijahmuraoka/hermes-voice-control/issues/13):
  provider-neutral realtime adapter boundary.
- [#14](https://github.com/elijahmuraoka/hermes-voice-control/issues/14):
  private Tailscale deployment and rollback rehearsal.
- [#15](https://github.com/elijahmuraoka/hermes-voice-control/issues/15):
  production security threat model and hardening gate.
- [#16](https://github.com/elijahmuraoka/hermes-voice-control/issues/16):
  safe real Hermes bridge integration harness.
- [#17](https://github.com/elijahmuraoka/hermes-voice-control/issues/17):
  realtime latency and reliability instrumentation.
- [#18](https://github.com/elijahmuraoka/hermes-voice-control/issues/18):
  final independent review gauntlet before launch.
- [#19](https://github.com/elijahmuraoka/hermes-voice-control/issues/19):
  open-source release safety and fresh-checkout gate.
- [#20](https://github.com/elijahmuraoka/hermes-voice-control/issues/20):
  mobile browser and audio QA matrix.
