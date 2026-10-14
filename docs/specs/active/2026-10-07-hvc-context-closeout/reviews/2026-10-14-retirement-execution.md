# Retirement Execution Receipt

Date: 2026-10-14. Status: HVC targets removed; awaiting approval for a separate
Hermes Serve logging repair. This is retirement, not production acceptance.

## Main Delivery And Recovery

[PR #88](https://github.com/elijahmuraoka/hermes-voice-control/pull/88) merged at
`3d65681684cb892ea2d9c0ef1f3bfa804b4b4e41`. Its tree
`c391bdb3f314ce369b50409bb3291f4187ccd039` exactly matches the reviewed head
`5724ba3c68a23ca6465a98a7ca4c58af9a3d82be`.

- [Exact PR-head CI](https://github.com/elijahmuraoka/hermes-voice-control/actions/runs/38516843168)
  and [post-merge CI](https://github.com/elijahmuraoka/hermes-voice-control/actions/runs/38592535685)
  completed successfully. The full matrix includes 236 web tests, 139 backend
  tests, scripts/build/performance/docs checks and 12 browser smoke passes.
  One opt-in real-provider browser test was skipped, not passed.
- Portable `pnpm docs:verify`, Tomoji docs audit (zero findings), docs index
  verification and `git diff --check` passed on the merged-equivalent tree.
- Reconcile preview could not authenticate through its internal standard gh
  route. No lifecycle mutation was applied. The closeout bundle is deliberately
  `reconcile: manual` because living docs link to it; GitHub state was separately
  verified through ghx. Reconcile authentication is unavailable, not a passed
  reconcile gate.
- All three [retirement tags](../context/retirement-dossiers.md) resolved to
  their recorded source/QA/dependency heads. Both source-only recovery patches
  were read back from main with their recorded Git blob IDs and sizes before
  local deletion. The patches remain untested historical alternatives.
- Independent fresh-reader acceptance passed for technical resumption at
  `6c54451`, as recorded in the [handoff review](2026-10-14-retirement-handoff.md).
  It did not establish runtime or physical-phone acceptance.

## Approved Cleanup Results

The operator accepted the exact preview before execution. The following
results were checked again after removal:

| Target | Observed result |
| --- | --- |
| Dedicated HVC user LaunchAgent | Booted out through repo tooling; service lookup reported not found; its plist removed |
| HVC backend/proxy | No listeners on loopback 8765 or 8787 |
| HVC private HTTPS handler | Only HTTPS 443 root-to-8787 removed with port-scoped Serve off |
| Other Serve routes | 3000-to-3001 and 8443-to-8790 unchanged; Tailscale remained Running/Online; no Funnel enabled |
| Four approved linked worktrees | Removed using wt; scoped registry list returned an empty array |
| Canonical HVC checkout | Exact path absent, including project-local ignored env/database/log/diagnostic/transcript copies and generated dependencies |
| Remote recovery | Repo remains public/editable; reviewed branch, abandoned proposal branches, tags, closed discussions and main preserved |
| Unrelated resources | Main Hermes messaging gateway, global agent histories/credentials and unrelated trees not targeted; ambiguous live Claude session still present |

No raw personal transcript, PIN, token, deployment environment or private Git
ancestry was uploaded. This is not an exhaustive clean-history certification.
Earlier docs contain inherited operational identifiers; their disposition is
recorded in the [coverage map](../audits/evidence-and-coverage.md).

## Cleanup Sequencing Mistake And Pending Repair

The final open-file check found two entries under the canonical project path,
but deletion was not gated on that failure. Follow-up identified the separate
Hermes Serve API process's stdout/stderr logs. Those files were unlinked when
the approved project directory was removed. This was a cleanup sequencing
mistake, not a clean quiescence result.

The separate user LaunchAgent still runs the API on loopback 9912. Its working
directory and credentials are independent of HVC; its two log paths reference
the former HVC directory. The process was not stopped or reloaded. A listening
port proves continuity of the process, not a fresh authenticated API or logging
health check.

Requested approval: move only that service's log paths to a dedicated user-log
directory and reload that service. This briefly interrupts 9912 and is outside
the original HVC-only service boundary. Do not restart the main messaging
gateway or rotate credentials as part of that repair. Until approved and
verified, the overall execution remains awaiting approval.

## Closed Queue And Skipped Gates

Issues #20/#33/#36/#65 are closed as not planned; PRs #25/#87 are closed
unmerged with [rationale and revival paths](../context/retirement-dossiers.md).
No open issue or PR remained at the post-#88 queue readback; this receipt's PR
is a subsequent documentation-only follow-up. Dependabot configuration is
unchanged, so future dependency PRs remain possible.

Physical phone/audio/reboot and new real Gemini/Hermes response checks are
descoped: active product acceptance was withdrawn, not passed. Replacement
selection/install is descoped, not assumed complete. Repo-local checks after
checkout deletion are unnecessary; exact-head remote CI verifies this final
docs follow-up. Separate Hermes Serve logging repair is approval-gated.
Global registry drift, unrelated caches and ambiguous live sessions are
unnecessary cleanup targets and were left alone.

## Resume From GitHub

Start at the [handoff](../../../../context/project-handoff.md), source feature
map and dated ledgers. Clone fresh, refresh upstream research/API compatibility,
run mocks first and obtain new live/deployment approvals. Historical patches
and approvals are context, never instructions to restart the retired host.
