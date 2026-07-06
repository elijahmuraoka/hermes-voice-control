# Phase briefs — overnight execution prompts

Each brief is a self-contained /do-style objective. The loop executes them in
order; a phase's gate must be evidence-green (or its blockers recorded) before
the next phase starts. All work in `wt` worktrees, GitHub via `ghx`, review via
codex-review, docs via doc-maintenance. Never merge to main. Never print
secrets. Never `hermes gateway stop`.

## Phase 0 — durable runtime (#33)

Objective: the HVC backend (127.0.0.1:8765) and proxy (127.0.0.1:8787) run as
launchd-managed services that survive crash and reboot, with logs in a known
location.

Tasks:
- Diagnose why 8787 was down on 2026-07-04; record root cause in STATE.
- Write launchd plists + install/uninstall scripts (`scripts/`), KeepAlive,
  RunAtLoad, log paths under `.private/logs/`.
- Install and start via launchctl (allowed: HVC's own services only).
- Gate: kill each process → auto-restarts; `launchctl kickstart -k` cycle →
  `/readyz` 200 from localhost within 30s. Record evidence. A full reboot test
  is desirable; if rebooting the Mac mini is judged too risky unattended,
  classify as approval-gated for morning.

## Phase 1 — stateful Hermes bridge (#66, obsoletes #65)

Objective: new `ApiHermesAdapter` speaking to `hermes serve`'s JSON-RPC/
WebSocket surface. `HVC_HERMES_ADAPTER=api` selects it; `local` subprocess
adapter remains as fallback.

Tasks:
- Map the exact `hermes serve` API first (session create/resume/interrupt/
  prompt-submit, approval events); record the surface contract in
  `docs/specs/active/2026-07-04-hvc-production-path/context/hermes-serve-api.md`.
- Decide + document lifecycle: one persistent voice session per unlocked HVC
  session, resume on reconnect, interrupt on barge-in, bounded transcript
  window carried.
- Stream tokens through the existing chat-job lifecycle so partial responses
  render (and can be spoken) as they arrive.
- Handle approval events safely: voice sessions must never auto-approve; a
  pending approval surfaces in UI as "needs your approval on desktop".
- Tests: unit (mocked ws), integration against real local `hermes serve` if it
  can be run without touching the production gateway; latency probe records
  first-token time.
- Gate: real round-trip evidence, first streamed token < 3s, interrupt
  verified, context carried across two consecutive turns. If the running
  gateway must be reconfigured to enable serve, classify approval-gated and
  document exactly what morning approval is needed.

## Phase 2 — UI truth (#62 + voice + state)

Objective: the UI proves what is happening.

Tasks:
- Realtime transcript rendering in both modes (#62) — words appear as spoken.
- Hold-to-talk is the default mode; Live is an explicit option (per operator
  direction 2026-07-03).
- Voice: male voice default (operator request), selectable in settings.
- Indicators: connected-to-agent status, "agent is working" with elapsed time,
  streamed text as it arrives.
- Gate: `pnpm smoke:browser` extended to assert transcript updates and
  indicator states; screenshots saved as evidence.

## Phase 3 — hardening (#64 + unlock UX)

Objective: quiet surface, humane auth.

Tasks:
- `/readyz` unauthenticated → status + version only; full diagnostics behind
  auth or localhost (#64).
- Remembered-device unlock: PIN entered once per device, long-lived httpOnly
  token after; PIN rotation script PREPARED (not run) with morning
  instructions.
- Gate: unauthenticated readyz snapshot diff recorded; unlock flow covered in
  browser smoke.

## Integration + morning handoff (every night-end)

- Stack reviewed branches onto `integration/hvc-production-path`; run the full
  verification matrix there.
- Deploy the integration build to the private runner (reversible; note the
  rollback command in STATE).
- Write the morning report in STATE: gates passed w/ evidence paths, PR merge
  queue in safe order, blockers by class, rollback instructions, and point to
  `qa/morning-acceptance-script.md`.
