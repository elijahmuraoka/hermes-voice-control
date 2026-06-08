# Plan: End-to-End Production Launch

**Status:** in-progress
**Objective:** Take Hermes Voice Control from hardened prototype to a verified private production voice surface for any configurable Hermes agent.
**Success criteria:** All critical GitHub issues have owners, linked verification, passing CI, independent review evidence, and one clean end-to-end run using real realtime voice credentials plus a real/safe Hermes bridge.

## Current State

- PR #11 is open, mergeable, and CI `verify` is passing.
- Issues #1, #2, and #4-#10 are closed.
- Issue #3 now has credentialed real Gemini Live smoke evidence recorded in the
  active spec; the GitHub issue can close once the evidence-bearing PR merges.
- The repo has doc-maintenance structure, public README/screenshots, CI,
  browser smoke, env validation, `/readyz`, log retention, secure-cookie
  controls, generic agent labels, read-only Hermes v1 action semantics, real
  Gemini smoke evidence, and real safe-Hermes harness evidence.
- Remaining live gaps are integrated post-merge review, private Tailscale Serve
  rehearsal, and physical/mobile audio QA.

## Provider Assessment

Default recommendation: keep Gemini Live as the v1 default after the
credentialed smoke passed, while still benchmarking alternatives for v1.1.

Why:

- The current architecture already matches Gemini Live's intended browser pattern: backend-authenticated ephemeral tokens, direct client-to-provider realtime stream, and backend-owned tool policy.
- Google documents Live API client-to-server WebSocket use with ephemeral tokens and supports tool/function calling in Live sessions.
- The repo has already hardened around this model, so switching now would reset risk without proof.

Close alternatives:

- OpenAI Realtime is the strongest provider-neutral alternative. It has GA realtime sessions, browser WebRTC guidance, ephemeral client secrets, function tools, MCP/tool approval primitives, and safety identifiers.
- xAI Grok Voice Agent is no longer ignorable. It now has a realtime WebSocket Voice Agent API, ephemeral-token guidance, tool/MCP support, OpenAI Realtime compatibility notes, and simple per-minute pricing.
- ElevenLabs is the best packaged voice-agent/voice-quality platform when telephony, voice catalog, workflows, monitoring, and hosted agent operations matter. It is less obviously the best default when Hermes tool policy and local/private control are the core product.

Decision rule:

- Ship v1 on Gemini if latency, barge-in/cancel, and tool-call behavior remain
  good during integrated post-merge verification.
- Add provider abstraction only after the benchmark harness proves at least one alternate provider materially improves latency, reliability, price, or deployment simplicity.
- Do not add telephony or hosted agent workflows unless the product explicitly expands beyond private browser-to-Hermes use.

## GitHub Issue Plan

Existing:

- #3 Complete real Gemini Live setup and credentialed smoke verification.

Create:

- #12 Provider bakeoff and default provider decision.
- #13 Provider-neutral realtime adapter design.
- #14 Private deployment rehearsal with Tailscale Serve.
- #15 Security threat model and hardening gate.
- #16 Real Hermes bridge integration harness.
- #17 Latency, performance, and reliability instrumentation.
- #20 Mobile/browser audio QA matrix.
- #19 Open-source release safety and repository history audit.
- #18 Independent review gauntlet and launch checklist.

## Execution Model

- Use separate worktrees for implementation lanes.
- Base immediate work from PR #11 only if stacking is intentional; otherwise merge PR #11 first and branch from updated `main`.
- Keep provider research and security review in docs/spec reviews before code changes.
- For code lanes, each branch must pass `pnpm verify`, relevant targeted tests, `pnpm smoke:browser`, `pnpm env:check`, docs verification, and a fresh independent review.
- The final launch gate requires one integrated pass after all lanes merge, not only per-branch checks.

## Risk Assessment

- Provider docs and pricing are moving quickly. Mitigation: benchmark against live credentials instead of choosing by vendor marketing.
- Real voice tests need secrets and may not run in public CI. Mitigation: separate manual/staging smoke from ordinary CI, redact logs, and record evidence in the active spec.
- Stacked branches can hide integration failures. Mitigation: prefer PR #11 merge first; otherwise mark stacked dependencies explicitly in issue bodies and PRs.
- Security regressions can come from convenience features like logs, broad CORS, or remote exposure. Mitigation: fail-closed env checks and explicit threat-model issue before deployment.

## Implementation Order

1. Merge or keep PR #11 as the explicit baseline.
2. Finish #3 credentialed Gemini Live verification. Done; redacted evidence is
   in the active spec.
3. Run provider bakeoff with the same prompts, audio path, tool-call scenarios, and latency metrics.
4. Decide whether provider abstraction is warranted for v1 or deferred to v1.1.
5. Rehearse private deployment and rollback.
6. Complete security threat model/hardening gate.
7. Build real Hermes integration harness and evidence capture.
8. Run performance/mobile QA.
9. Run open-source safety audit and final independent review gauntlet.

## Confidence

- High: current repo baseline, issue inventory, and security defaults.
- Medium-high: Gemini as v1 default after credentialed smoke passed; final
  confidence still depends on integrated latency and mobile/audio checks.
- Medium: xAI/OpenAI alternate value until live benchmark data exists.
- Low: exact production latency/cost winner before live tests with the user's real audio/network conditions.

## Progress

- [x] Confirm PR #11 and current issue state.
- [x] Research current official provider capabilities.
- [x] Draft second-wave production plan.
- [x] Create/update GitHub issues from the plan.
- [x] Spawn isolated worktree/session lanes after issue creation.
- [ ] Run integrated verification and independent review after implementation.
