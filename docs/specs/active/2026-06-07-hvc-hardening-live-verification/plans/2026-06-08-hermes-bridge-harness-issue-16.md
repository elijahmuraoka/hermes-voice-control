# Plan: Hermes Bridge Harness Issue 16

**Status:** done
**Objective:** Build a safe, intentional real-Hermes bridge harness while
keeping the v1 local adapter read-only.
**Success criteria:** Backend tests cover the bridge contract in CI, developers
can run an opt-in real Hermes harness locally, `/readyz` explains local adapter
blockers, docs describe the command and evidence path, and verification gates
pass.

## Current State

- The backend already supports `ask_agent`, `ask_bob` compatibility, tool-call
  cancellation, confirmation records, and read-only v1 approval semantics.
- The local adapter launches `hermes chat -q <prompt> --toolsets safe` through a
  direct argv.
- The active spec bundle tracks HVC hardening and live verification.

## Proposed Changes

1. Add local Hermes diagnostics and timeout configuration.
2. Add tests for safe prompt/toolset, `ask_bob`, cancellation, timeout,
   malformed output, readiness failures, and no-action behavior.
3. Add an opt-in harness that writes redacted evidence only when
   `HVC_REAL_HERMES_HARNESS=1` is set.
4. Update integration docs, acceptance evidence, and status.

## Risk Assessment

- The main risk is accidentally invoking a real local agent in routine
  verification. The harness requires an explicit environment opt-in and is not
  part of `pnpm verify`.
- The bridge must stay read-only. The adapter prompt, safe toolset, and tests
  preserve that boundary.

## Implementation Order

1. Patch adapter/readiness behavior.
2. Patch CI-safe tests.
3. Add harness and docs.
4. Run verification and record the live-harness result or blocker.

## Confidence

HIGH for CI-safe adapter coverage and docs. MEDIUM for live local Hermes
execution because it depends on this machine's current Hermes credentials and
runtime health.

## Progress

- [x] Adapter/readiness behavior patched.
- [x] CI-safe tests added.
- [x] Harness and docs added.
- [x] Verification completed.
