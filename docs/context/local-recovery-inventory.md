# Local Work Recovery Classification

Audit: 2026-10-14. This classifies technical preservation, not deletion
approval. The [execution receipt](../specs/active/2026-10-07-hvc-context-closeout/reviews/2026-10-14-retirement-execution.md)
records later approved cleanup. Exact local paths and runtime configuration are
excluded from public docs. [Retirement decision](../decisions/2026-10-14-remote-only-retirement.md).

## Source Histories

| Local work | Result | Recovery surface |
| --- | --- | --- |
| Implemented main | Public at `c7c501f51c2649883cab291390b297a673af17c0` | `retirement/2026-10-14/implemented-source` tag |
| QA draft #25 | Public unmerged head `cead0b82a775126a9c837fa06d691554a582be1e` | Closed PR, retained branch and `retirement/2026-10-14/mobile-qa` tag |
| Dependency proposal #87 | Public unmerged head `ae9248311b79804283f345f9c7897f35235328d4` | Closed PR, retained branch and `retirement/2026-10-14/dependency-proposal` tag |
| Buttery-voice local tip `4f180126` | Already reachable through public main despite same-name branch being older | No missing source to republish |
| Private-history tip `2e76ada` | Final source/support tree matches public `4ff7f75e426c17b84bca80c268c236f859d2c505` | Public implementation already retained; private ancestry is intentionally not uploaded |
| Precheck tip `7d94dff` | Other examined source versions already public; one CSS padding variant remained | [Precheck patch](recovery-snapshots/precheck-safe-area.patch) against recorded public base |
| Recovery tip `0a5b1d9` | 28 useful source variants absent from public history | [Source-only patch](recovery-snapshots/canonical-recovery-source.patch), without private history or evidence |
| Stateful/STT and integration tips | Already public remote code | Existing branch/history; no blind remerge needed |
| Closeout docs branch | Delivered on main | PR #88 merged at `3d65681684cb892ea2d9c0ef1f3bfa804b4b4e41`; reviewed branch retained remotely |

The recovery audit compared public commit/blob ancestry and source versions.
That establishes recoverability, not that every older variant improves main.
Intermediate private revisions and every raw historical trace are not claimed
to be mirrored remotely; the scope is useful engineering context and retained
implementation. Do not publish the private branch graph to fill that gap.

## Non-Source Material

The main checkout's sole tracked modification at inventory was a generated July 2 read-only
Hermes harness result: reported `ok:true`, three successful probes, no blocker.
It is historical evidence, not unique implementation or fresh acceptance.
Raw agent answer strings/machine diagnostics were not uploaded; the harness
source, existing historical evidence and this sanitized outcome remain usable.

Ignored databases, WAL files, provider env files, old PINs, logs and raw
transcripts are not required for a fresh mock build or technical orientation.
The operator chose useful sanitized repository context, not a personal-history
or credential archive. After this audit, approved checkout removal deleted
these project-local copies. Global histories were not part of that removal.

## Runtime And Cleanup Boundary

Read-only host checks found a loaded dedicated HVC LaunchAgent and loopback
backend/proxy listeners. HVC's private HTTPS route points to the proxy, while
two other Serve routes belong outside this cleanup. A HVC-named tmux session
contains a live Claude process whose ownership is not established by its name.

The operator subsequently approved the exact preview. HVC's LaunchAgent,
single owned route and five checkouts are removed; wt lists no linked HVC
trees. Two unrelated Serve routes and the live Claude session were retained.
The separate Hermes Serve service remains running but had stdout/stderr logs
inside the removed directory. Repairing those paths and reloading that service
requires separate approval. Do not reset all Serve configuration, stop
shared Hermes, rotate shared provider credentials, or kill that live session
merely to make the inventory empty. Use wt for any future linked-tree lifecycle.
