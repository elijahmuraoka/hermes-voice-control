# Remote-Only Closeout Plan

Objective: keep useful engineering memory and recoverable code on GitHub, then
remove the HVC-only local project/runtime after verified preservation and
exact-target cleanup approval. This is retirement, not a production upgrade.

## Execution Stages

| Stage | State | Evidence / condition |
| --- | --- | --- |
| Refresh repo/PR/issue and local ownership | Verified | Fresh exact-head/CI and runtime checks before #88 merge; only the classified old harness result and integration symlink remained locally |
| Record scope, feature map and abandoned-work dossiers | Verified | Living handoff, 2026-10-14 ADR, feature map and dossier supplement; fresh reader recovered context |
| Close abandoned records with reasoning | Verified | Issues #20/#33/#36/#65 not planned; PRs #25/#87 unmerged, linked rationale receipts |
| Preserve known public draft/source heads remotely | Verified | Three retirement tags; QA and closeout branches survive. Original dependency branch is absent, but its exact tree remains tagged; no deletion was requested by this cleanup |
| Classify local-only histories/dirty evidence | Verified for scoped branch tips | Recovery's 28-file source patch and one-line precheck CSS retained; public-equivalent tips not republished; private ancestry excluded |
| Cold-start reader and docs/exact-head CI | Verified | Fresh reader PASS at `6c54451`; final head `5724ba3` and main merge `3d65681` CI success; portable docs/audit/index passed |
| Deliver handoff on main | Verified | PR #88 merged at `3d65681684cb892ea2d9c0ef1f3bfa804b4b4e41`; merged tree equals reviewed head tree |
| Stop/remove exact HVC-only local resources | Verified for previewed targets | Dedicated agent/plist and 443 route gone; four wt entries and canonical checkout absent; two unrelated routes unchanged |
| Repair separate Hermes Serve logging dependency | Awaiting approval | API still running; stdout/stderr referenced removed HVC log files. No shared-service reload attempted |
| Publish final execution receipt | This docs follow-up | Actual results, sequencing mistake and remaining approval are recorded without a production claim |

## Implementation Notes

**Decision:** source, sanitized rationale, linked discussions and remote code
refs are the recovery surface. No custom backup service or transcript-export
system is being built. A private raw archive is not a required deliverable.

**Deviation from October 7:** retirement does not require an accepted upstream
replacement. The four unsolved issues close by scope withdrawal, not success.
The original metadata capture remains immutable; dispositions are a dated
supplement with authoritative GitHub comment URLs.

**Tradeoff:** private operational values/personal conversations are excluded
from the public handoff. Useful technical content must be summarized first;
a future operator configures new credentials instead of recovering old secrets.

**Open question:** approve rehoming the separate Hermes Serve logs and
reloading only that service. The live Claude session remains outside cleanup.
Local source classification is complete within documented coverage limits;
the exact merge and HVC cleanup preview were approved and executed.

**Execution deviation:** the final canonical open-file check returned two
entries, but deletion was not gated on that failure. They were the separate
Hermes Serve stdout/stderr logs. The API process remains live; its logging
needs repair. See the [execution receipt](../reviews/2026-10-14-retirement-execution.md).

## Verification

Use the existing repo docs verifier and Tomoji audit/index, public changed-file
privacy checks, whitespace, independent fresh-reader assessment, exact remote
refs and GitHub closure readback. CI must be green at the final PR head.
Mock tests do not establish real provider/device/reboot acceptance, and no paid
or privileged runtime trial is needed for this retirement documentation.
