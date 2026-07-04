---
name: 2026-07-04-hvc-production-path
status: active
started: '2026-07-04'
---
# 2026-07-04-hvc-production-path

## What

Take Hermes Voice Control (HVC) from "polished UI on a broken substrate" to
production-ready, executed as an unattended overnight loop with a
human-acceptance gate in the morning.

Four build phases run overnight; Phase 4 (human phone QA) is the morning gate
and the only thing that may close this spec.

## Why

The 2026-07-03/04 audits established the core diagnosis:

1. The voice path dead-ends in a stateless `hermes chat -Q -q` subprocess with
   ~34s latency and no session memory (evidence:
   `/private/tmp/hvc-text-latency-audit-20260703.json`). No UI work fixes this.
2. Upgraded Hermes now ships `hermes serve` — a JSON-RPC/WebSocket gateway with
   session create/resume/interrupt/prompt-submit and approval events. This is
   the correct voice substrate (issue #66).
3. The private runner decays between sessions (proxy 127.0.0.1:8787 observed
   down on 2026-07-04); durability (#33) is unshipped.
4. The UI does not prove what is happening: no realtime transcript (#62), no
   connected-to-agent indicator, wrong voice, no working/elapsed state.
5. Security tidy-up: unauthenticated `/readyz` over-shares (#64); the private
   PIN was exposed in chat and the PIN UX repeatedly failed the operator.

## Scope

In scope (overnight, autonomous):
- Phase 0 — durable runtime: launchd-managed HVC runner (#33), cold-boot safe.
- Phase 1 — stateful bridge: `HVC_HERMES_ADAPTER=api` against `hermes serve`
  WebSocket (#66): persistent session, streaming tokens, interrupt/cancel,
  bounded transcript context (obsoletes #65). Subprocess adapter kept as
  explicit fallback. Target: first streamed token from the agent < 3s.
- Phase 2 — UI truth: realtime transcript rendering (#62), male/selectable
  voice, connected-to-agent indicator, working/elapsed state, hold-to-talk as
  default mode with Live as option.
- Phase 3 — hardening: minimal unauthenticated `/readyz` (#64), remembered-
  device unlock replacing per-visit PIN entry, PIN rotation PREPARED but not
  applied.
- Integration branch `integration/hvc-production-path` stacking reviewed PR
  branches; integration build deployed to the private runner so the operator
  can test in the morning (reversible, tailnet-private).

Out of scope (approval-gated or human-gated — record, do not do):
- Merging anything to `main` (fresh explicit approval required, every time).
- Tailscale ACL/Serve/Funnel changes (#36) or any public exposure.
- Applying PIN/secret rotation.
- `hermes gateway stop` (never; restart/start only), Hermes core upgrades,
  or any change to the Hermes install itself.
- Physical phone/audio QA (#20) — morning gate, operator-run.

## Execution contract (overnight loop)

- Runtime state lives at
  `/Users/bob/repos/hermes-voice-control/.private/overnight-2026-07-04/STATE.md`
  (gitignored). Each loop iteration: read STATE → take the next unchecked task
  → execute in a scoped `wt` worktree → verify → independent review
  (codex-review) → push branch + open/update PR via ghx → update STATE with an
  iteration log entry (what ran, evidence paths, result) → continue.
- Main checkout stays on `main`, untouched. All work in worktrees.
- A task failing 3 attempts is recorded as a blocker in STATE with evidence
  and skipped; the loop moves on. Never claim a gate passed without evidence.
- Verification matrix per phase: `pnpm verify`, `pnpm smoke:browser`,
  `pnpm env:check`, adapter latency probe, `tomoji docs audit --json`,
  `tomoji docs index --verify`, plus phase-specific checks in phase-briefs.
- Every skipped check is classified: approval-gated | human-gated |
  unavailable | failed.

## Success criteria

Overnight (automated) portion is done when:
1. Cold-boot test: HVC runner + proxy come back without intervention and
   `/readyz` passes locally.
2. API adapter: real `hermes serve` session round-trip with streamed first
   token < 3s, interrupt works, context window carried; evidence recorded.
3. UI: realtime transcript verified in browser smoke; hold-to-talk default;
   voice + connection/working indicators present.
4. `/readyz` unauthenticated response is minimal; detailed diagnostics behind
   auth.
5. All work stacked on `integration/hvc-production-path`, integration
   verification green, integration build serving on the private runner.
6. Morning report written: PR merge queue, evidence per gate, blockers, and
   the phone QA script at `qa/morning-acceptance-script.md`.

The SPEC ships (archives) only after the operator passes the morning QA script
on iPhone + MacBook and explicitly approves the merge queue.
