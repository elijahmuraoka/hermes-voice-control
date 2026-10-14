# Publication Review

Date: 2026-10-07. Baseline: `c7c501f`. Scope: the documentation-preservation
branch, not current runtime production acceptance. The user approved scoped
docs fixes, branch publication, a PR, and end-to-end review; no merge or service
mutation is included.

## Plan

1. Refresh main/branch/GitHub identity and retain pre-existing dirty evidence.
2. Run two bounded read-only review lanes: context/source accuracy and
   skill/privacy/lifecycle safety. Verify each confirmed finding.
3. Fix scoped docs, then check links, metadata, checksums, index, audit,
   reconciliation retention, privacy scope, and whitespace.
4. Publish one exact-head docs PR, record its number in spec metadata, and
   verify persisted PR fields and final-head CI.
5. Retain review/private artifacts; report remaining boundaries explicitly.

## Findings And Disposition

| Review | Finding | Disposition |
| --- | --- | --- |
| Context/source | P3: unlock warming promised a pre-warmed first answer | Corrected to asynchronous resume-only warming; new/stale sessions remain cold. Reviewer verified the correction against the traced source/tests. |
| Skill/privacy | P2: privacy-scan claim could imply the entire public tree was clean | Narrowed to changed files and documented inherited identifier locations without repeating values. No tree/history/screenshot certification or redaction claimed. |
| Skill/lifecycle | P2: automatic archive would break 12 living-doc links | Added supported `reconcile: manual`; archival and inbound-link repair must be one approved, link-verified transaction. |
| Skill/lifecycle | P2: recommended blocking disagreed with the portable verifier | Removed unsupported block guidance and documented the active-status-only limitation. Underlying verifier is unchanged; blockers belong in active spec content until separately fixed/tested. |
| Skill format | P3: content auditor required frontmatter trigger wording and separate input/output headings | Added the expected `Use when` description and explicit headings; content is unchanged. |

The skill/privacy reviewer accepted the scoped safety mitigations with
concerns limited to the known inherited identifiers/verifier limitation and
the subsequently corrected auditor format. This is not a claim that those
underlying repository limitations disappeared.

The context lane inspected the complete preservation bundle, living handoff
docs, archive acceptance contract, commit ledgers, and targeted auth/principal,
chat-budget, API approval, STT/TTS and playback contracts. It verified ledger
counts, all 93 commit rows, and ancestry of all 46 merged PR SHAs.

The skill/privacy lane inspected instructions, YAML, relative links, CI/docs
gate, public metadata fields, and lifecycle behavior. It tested archive and
blocked-status failure scenarios in memory, without editing archived files.
Both lanes were separate read-only review contexts, not independent runtime
or provider/device tests. No cross-model writing-quality verdict is claimed.

## Local Evidence

- `pnpm docs:verify`: passed after the scoped fixes; link and spec metadata
  verification includes the working tree.
- Repo-local skill content auditor: exit 0, `ok:true`, all ten checks pass,
  `missingRequired:[]`; independently rerun once after the format correction.
- Tomoji compiled `docs-core.verifyIndex`: `inSync:true`.
- Tomoji compiled `audit.runAudit`: `passed:true`, zero findings.
- Tomoji compiled `reconcileBundles`: this bundle has manual retention and
  `shouldShip:false`; no filesystem mutation or remote PR guess is involved.
- Frozen metadata SHA-256 matches the coverage map; all 54 PRs, 33 issues,
  and 76 comment references are mapped. Main ledger covers all 93 commits.
- All 65 selected private captures/transcript/note copies match recorded byte
  counts and SHA-256. Raw contents stay ignored and are not publicly exported.
- Public changed-file scope and whitespace checks cover this docs PR only;
  archived specs, code, lockfile, and workflows are unchanged.
- Main retains its pre-existing modified harness artifact; this pass did not
  edit it. Worktree/reviewer/private evidence cleanup is retention-only.

The [initial review](2026-10-07-context-preservation.md) records the earlier
bounded `codex review` and successful CLI gates. On this later pass, installed
Tomoji CLI startup fails because the unrelated Toolkit installation lacks
`dotenv`. The actual compiled docs modules load and pass directly. This is
a docs-core fallback, not a claim that CLI startup works or was repaired.

## Publication And Limits

[PR #88](https://github.com/elijahmuraoka/hermes-voice-control/pull/88)
is the published documentation review; the spec records it explicitly. Its exact final
head, remote readback, mergeability, and terminal CI are recorded on that PR;
do not infer them from this local report. The frozen GitHub metadata predates
this preservation PR intentionally. Existing issues/PRs are not closed here.

Local full code/build/browser reruns and paid provider traffic are unnecessary
for the docs-only diff; remote CI still runs the automated regression matrix.
Physical audio QA is external/unavailable, not passed. Runtime/network/secret
changes, merge, retirement and archival are approval-gated/out of scope.
Installed CLI startup is unavailable on the final local pass. Secure private
backup is a separate unperformed gate; a fresh clone contains only public
context. Inherited public identifiers and blocked-status verifier support
remain known, explicitly bounded limitations rather than completed fixes.
