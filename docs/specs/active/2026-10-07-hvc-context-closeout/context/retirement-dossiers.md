# Retirement Dossiers

Decision date: 2026-10-14. The operator approved closing abandoned work because
HVC is being retired as an active local project. This does not depend on an
accepted replacement. [Decision](../../../../decisions/2026-10-14-remote-only-retirement.md).

This is the detailed supplement to the frozen October 7 ledgers; it does not
rewrite their capture states. Closure execution/URLs are recorded below once
read back from GitHub. The preservation PR #88 is not abandoned and must not be
closed unmerged as a shortcut to an empty queue.

## #20 And Draft PR #25: Mobile/Audio QA

[Issue #20](https://github.com/elijahmuraoka/hermes-voice-control/issues/20)
requested realistic desktop/mobile layouts and audio behavior: permission
denial/retry, muted output, barge-in, reduced motion, keyboard focus, slow
networks, and a manual checklist for non-automatable cases.

[Draft #25](https://github.com/elijahmuraoka/hermes-voice-control/pull/25)
proposed nine file changes: mocked token/WebSocket/audio smoke, a constrained
360x640 viewport, focus traversal, pre-muted-start recovery, mic-capture
failure recovery, short-phone CSS and a manual mobile checklist. The draft
does not constitute physical Safari/PWA/audio acceptance. Later PRs substantially
changed the same source; compare before reusing this old patch.

Preserved remote branch: `test/test-mobile-browser-audio-qa-issue-20`, head
`cead0b82a775126a9c837fa06d691554a582be1e` (verified before closure).
Close #20 as not planned and #25 unmerged because active HVC investment ends,
not because the phone matrix passed. On revival, rerun the actual-device
matrix in the resumption plan; reopen #20 or create a new scoped QA issue and
PR from current main. The original draft's manual checklist remains in its
remote tree even though it is not in main.

## #33: Durable Private Runner

[Issue #33](https://github.com/elijahmuraoka/hermes-voice-control/issues/33)
asked for launchd supervision instead of manual tmux, localhost-only binds,
private HTTPS, ignored logs, documented start/stop/rollback, and proof through
reboot/logout/headless operation. Runner/supervisor tooling exists and
historical child-crash recovery was reported. That is not complete reboot
acceptance or proof of the currently loaded supervisor.

Close as not planned because the custom deployment is being retired. A future
revival must inspect `scripts/manage-private-launchd.mjs` and related tests,
freshly inventory its host, and obtain installation/restart/reboot approval.
Do not infer that the old service or exact host paths still exist.

## #36: Private HTTPS / Tailnet Access

[Issue #36](https://github.com/elijahmuraoka/hermes-voice-control/issues/36)
tracked a peer-ping/HTTPS mismatch and a proposed least-privilege TCP 443 grant.
Later diagnosis also found client DNS acceptance disabled: MagicDNS existing
tailnet-wide did not mean the device was using it. Historical operator reports
said access worked after client DNS remediation; the complete device/policy
acceptance matrix was not independently finished here.

Close as not planned because no active HVC endpoint is required after
retirement. No policy grant is applied/revoked by closure. On revival, verify
VPN/account/tailnet, DNS, TCP authorization, TLS, app auth and real phone access
separately. TSMP ping alone proves none of the latter layers; never use Funnel
as a workaround. Public prose here does not repeat historical device identity.

## #65: Local Subprocess Context Defect

[Issue #65](https://github.com/elijahmuraoka/hermes-voice-control/issues/65)
identified that `transcript_window` reaches `LocalHermesAdapter.ask_agent` but
is omitted by its prompt builder. The earlier CLI path also had a roughly
34-second reported latency baseline. The desired fix was bounded role-labeled
context preserving the read-only suffix and metadata-only auditing.

[PR #69](https://github.com/elijahmuraoka/hermes-voice-control/pull/69)
implemented a separate stateful API path, with streamed events, session
resume/interrupt, and explicit approval handling; its historical warm latency
gate reported 1.4-2.0 seconds. It did not repair the local fallback's prompt.
Close #65 as not planned, not fixed. If the fallback is retained on revival,
either implement/test its bounded transcript support or remove it explicitly
in a reviewed PR after fresh Hermes interface research.

## PR #87: Dependency Refresh

[PR #87](https://github.com/elijahmuraoka/hermes-voice-control/pull/87)
proposed a 14-package frontend/tooling group update, changing web/root manifests
and `pnpm-lock.yaml`. It includes major TypeScript, Vite, jsdom and test-library
updates, not just a harmless patch batch. Compatibility was not accepted by
merging it; the snapshot must not imply those dependency versions shipped.

Original proposal branch: `dependabot/npm_and_yarn/frontend-65bb55f2ca`, head
`ae9248311b79804283f345f9c7897f35235328d4` (verified before closure).
At final readback, this branch was absent from GitHub; the dependency-proposal
retirement tag still resolves to that exact head. The disappearance's cause is
unverified. Use the tag for recovery; branch recreation is unnecessary.
Close unmerged because maintaining the frozen client is unscheduled. On
revival, research current supported versions and upgrade in a fresh tested
PR rather than blindly merging this aged group. Existing Dependabot config
is unchanged by closure and may propose new updates in the future.

## Execution Receipt

GitHub readback on 2026-10-14 verified all six closures. The four issues have
`state_reason: not_planned`; both PRs are closed with `mergedAt: null`. Neither
remote PR branch was requested for deletion. Exact rationale comments:

| Record | Disposition | Closure rationale / resumption context |
| --- | --- | --- |
| #20 | Closed, not planned | [Phone QA remains incomplete](https://github.com/elijahmuraoka/hermes-voice-control/issues/20#issuecomment-6161151513) |
| #33 | Closed, not planned | [Durability is unscheduled, not accepted](https://github.com/elijahmuraoka/hermes-voice-control/issues/33#issuecomment-6161152282) |
| #36 | Closed, not planned | [Access is no longer required; no policy mutation](https://github.com/elijahmuraoka/hermes-voice-control/issues/36#issuecomment-6161152961) |
| #65 | Closed, not planned | [Local fallback defect remains](https://github.com/elijahmuraoka/hermes-voice-control/issues/65#issuecomment-6161153596) |
| #25 | Closed unmerged | [Draft code and manual checklist retained remotely](https://github.com/elijahmuraoka/hermes-voice-control/pull/25#issuecomment-6161154289) |
| #87 | Closed unmerged | [Proposed dependencies did not ship](https://github.com/elijahmuraoka/hermes-voice-control/pull/87#issuecomment-6161154912) |

PR #88 subsequently merged at `3d65681684cb892ea2d9c0ef1f3bfa804b4b4e41`.
The [later execution receipt](../reviews/2026-10-14-retirement-execution.md)
records actual HVC teardown and the pending separate Hermes Serve log repair.

## Remote Recovery Anchors

These GitHub tags were created from already-public commits and read back on
2026-10-14. They preserve useful trees independently of future branch cleanup:

| Tag | Exact commit | Purpose |
| --- | --- | --- |
| `retirement/2026-10-14/implemented-source` | `c7c501f51c2649883cab291390b297a673af17c0` | Last implemented source before the docs closeout |
| `retirement/2026-10-14/mobile-qa` | `cead0b82a775126a9c837fa06d691554a582be1e` | Unmerged draft #25 and its manual checklist |
| `retirement/2026-10-14/dependency-proposal` | `ae9248311b79804283f345f9c7897f35235328d4` | Unmerged proposed #87 dependency tree |

Use a fresh worktree for any revival and compare against current main. Tags
preserve historical code, not current compatibility, green tests, or a promise
that applying the old changes is appropriate.
