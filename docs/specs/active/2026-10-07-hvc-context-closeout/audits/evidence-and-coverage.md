# Evidence And Coverage

Snapshot date: 2026-10-07. Baseline main:
[`c7c501f51c2649883cab291390b297a673af17c0`](https://github.com/elijahmuraoka/hermes-voice-control/commit/c7c501f51c2649883cab291390b297a673af17c0).
This is a preservation audit, not a live production-readiness rerun.

## Source Coverage

| Source | Coverage | Where preserved / limitation |
| --- | --- | --- |
| GitHub pull requests, all states | Complete available pagination: one 54-record page; 46 merged, six closed-unmerged, two open | Public [PR ledger](../context/pull-request-ledger.md) and metadata; full bodies in ignored local capture |
| GitHub issues, all states | Complete available pagination: one 87-record page including PRs; 33 actual issues, 29 closed/four open | Public [issue ledger](../context/issue-ledger.md), exact API states/reasons; raw bodies private |
| GitHub issue/PR discussion comments | Complete available pagination: one 76-record page | All URLs/dates mapped to their records in [metadata](../evidence/github-metadata.json); selected relevant bodies read for synthesis, not all individually audited |
| Inline PR review comments | Complete available pagination: one empty page | Zero records; not evidence of zero review effort |
| Formal reviews | All 54 PR review endpoints paginated; zero records | Independent agent verdicts were posted as discussion comments instead |
| Repository docs/specs/source | Existing tracked history retained, living docs and targeted adapter/auth/STT/TTS/UI paths checked | Not a new full code/security audit; archived snapshots unchanged |
| July execution notes | Known state, design/audit, and gate artifacts retained locally; selected sanitized notes read | `.private/overnight-2026-07-04/` and `.private/do-2026-07-06/`; no blanket claim that all private files were read |
| Original local Codex thread | Private raw snapshot: 59,234 valid JSONL records, 309,539,140 bytes, timestamps June 7 through July 7, 2026 | Messages, execution, and results retained without public export; not every entry semantically reread, and this does not include every other session |
| Later/operator conversation | Product direction, incidents, approval history, and review/fix briefs reconstructed from available conversation context | October handoff is synthesized here; not a byte-for-byte export of all desktop/tmux/cloud sessions |
| Historical Claude sessions | Two supplied cloud-session references retained in the private source inventory | Contents not reread/exported for this closeout; unavailable as independent evidence |
| Upstream voice research | Dated primary-source/candidate references and conclusions preserved | Capabilities can change; not local installation, migration, or acceptance evidence |
| X bookmarks research | Prior research reported 198 unique bookmarks over two complete API pages | Raw bookmark payloads not captured anew here; discovery input, not proof of a voice implementation |
| Live/runtime, phone audio, reboot | Not repeated in this preservation pass | Historical reports and open gates only; no current uptime/production claim |

Pagination means every record returned by the available API at capture time.
It cannot recover deleted/inaccessible comments, unexported agent sessions,
or remote evidence that was never attached. The snapshot predates this docs
PR; it is not an automatically updating GitHub mirror.

## Reproducibility

The public [metadata snapshot](../evidence/github-metadata.json) contains only
record identifiers, titles, states, UTC timestamps, merge commits, branch
names, comment URLs/counts, and page lengths. Its captured SHA-256 is:

```text
12f8368c80012b7ef732cb999b6792cdef6907333c49dd92fc16bbc7155f2f82
```

The local `.private/closeout-2026-10-07/capture-manifest.json` records byte
counts, record/page counts, and SHA-256 checksums for 58 raw capture files.
Its `transcript-manifest.json` separately records the copied Codex JSONL's
coverage, checksum, and validation (zero invalid lines). This raw transcript
may contain credentials/private content and is owner-readable only; never
upload it to GitHub or a public attachment.
The generated ledgers validate unique PR/issue IDs and comment-to-record
mapping. Raw discussion bodies are deliberately not duplicated into Git.
Git itself preserves prior source/docs and the exact merged trees.

## Historical Evidence, Not Fresh Gates

| Evidence | What it supports | What it does not support |
| --- | --- | --- |
| [#69 dedicated real-serve gate](https://github.com/elijahmuraoka/hermes-voice-control/pull/69#issuecomment-4881355218) | Reported warm 1.4-2.0 s first token, context carry, roughly 2 ms interrupt; cold 6.6 s | Current runtime latency, all models, or reboot recovery |
| [#72 fix acceptance](https://github.com/elijahmuraoka/hermes-voice-control/pull/72#issuecomment-4890354386) | Assembly across recognizer restarts and release watchdog review | Complete physical Safari/PWA acceptance |
| [#76 adversarial review](https://github.com/elijahmuraoka/hermes-voice-control/pull/76#issuecomment-4895282058) | STT capture/fallback/security fix rounds accepted | A contractual transcription-accuracy or latency guarantee |
| [#77 review complete](https://github.com/elijahmuraoka/hermes-voice-control/pull/77#issuecomment-4894628009) | Ghost-session, healthy-return, capture teardown, wake-lock regressions fixed/tested | Guaranteed OS-background continuity |
| [#78 final delivery](https://github.com/elijahmuraoka/hermes-voice-control/pull/78#issuecomment-4896550614) | Historical 214 web/117 backend tests, 12 smoke passes, budget 272275/280000; one opt-in live flow skipped | Physical iOS microphone/audio acceptance |
| [#79 independent review](https://github.com/elijahmuraoka/hermes-voice-control/pull/79#issuecomment-4898255898) | Logout, rate-limit and security hardening reviewed | Complete current threat assessment of newer Hermes versions |
| [#81 independent review](https://github.com/elijahmuraoka/hermes-voice-control/pull/81#issuecomment-4902365336) | Hermes TTS proxy, unlocked Web Audio, barge-in/fallback architecture accepted | Delayed iOS AudioContext resume; reviewer explicitly left that for devices |
| Private July runner recovery notes | Reported child crash/restart and healthy private checks at that time | Full reboot/logout/headless acceptance or current service status |

## Corrections To Preserve

- The archived July production-path spec says phone acceptance is required,
  yet it was auto-archived after PR #67's merge. That is lifecycle state, not
  evidence that acceptance happened. The archive is left immutable.
- An observed July localhost failure was later attributed to sandbox networking,
  not a dead host service. Do not repeat service churn from that observation.
- Older notes tie Hermes context to session-cookie rotation. Current source
  prefers a remembered-device principal, so ordinary session refresh is not
  necessarily a new agent session.
- A green per-lane backend/browser suite missed deployed proxy routing and
  merged-tree conflict markers. Preserve both integration failures and fixes.
- Historical "all done" statements were qualified by unresolved phone/reboot
  gates. This record does not promote them to unqualified production claims.
- Six dependency PRs are closed-unmerged, not delivered. Four issues and two
  PRs were still open at capture; none was administratively closed here.

## Fresh Preservation Gates

The [documentation review](../reviews/2026-10-07-context-preservation.md) records exact results for
docs links/specs, index, audit, metadata integrity, whitespace, privacy scan,
and main-worktree preservation. Code suites, real-provider traffic, Tailscale
changes, phone interaction, and reboot tests are **unnecessary for this
docs-only update**, not passed production gates. Physical acceptance is still
external if HVC is retained; installation/network/retirement mutations remain
approval-gated. A fresh clone cannot contain the ignored private evidence;
separate secure backup remains an operator responsibility.
