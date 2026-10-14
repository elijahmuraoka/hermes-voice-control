# Remote-Only Closeout Plan

Objective: keep useful engineering memory and recoverable code on GitHub, then
remove the HVC-only local project/runtime after verified preservation and
exact-target cleanup approval. This is retirement, not a production upgrade.

## Execution Stages

| Stage | State | Evidence / condition |
| --- | --- | --- |
| Refresh repo/PR/issue and local ownership | Verified | Main `c7c501f`; PR #88 pending; exact runtime/worktree inventory is an audit, not teardown |
| Record scope, feature map and abandoned-work dossiers | Implemented, review pending | Living handoff, 2026-10-14 ADR, feature map and dossier supplement |
| Close abandoned records with reasoning | Verified | Issues #20/#33/#36/#65 not planned; PRs #25/#87 unmerged, linked rationale receipts |
| Preserve known public draft/source heads remotely | Verified | Three retirement tags and original remote branches; no branch deletion |
| Classify local-only histories/dirty evidence | Verified for scoped branch tips | Recovery's 28-file source patch and one-line precheck CSS retained; public-equivalent tips not republished; private ancestry excluded |
| Cold-start reader and docs/exact-head CI | In progress | Reader restricted to tracked repo, no conversation/private notes; fix concrete gaps before cleanup |
| Deliver handoff on main | Approval-gated | PR #88 must merge; an open PR is not main delivery |
| Stop/remove exact HVC-only local resources | Approval-gated | Preview service/routes/checkouts after preservation; shared services and ambiguous live sessions remain untouched |

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

**Open questions:** local-only histories need source/ancestry classification;
active agent sessions may not be owned exclusively by HVC. Exact main merge,
runtime shutdown, route removal and deletion approvals are separate from
approved record closure and docs publication.

## Verification

Use the existing repo docs verifier and Tomoji audit/index, public changed-file
privacy checks, whitespace, independent fresh-reader assessment, exact remote
refs and GitHub closure readback. CI must be green at the final PR head.
Mock tests do not establish real provider/device/reboot acceptance, and no paid
or privileged runtime trial is needed for this retirement documentation.
