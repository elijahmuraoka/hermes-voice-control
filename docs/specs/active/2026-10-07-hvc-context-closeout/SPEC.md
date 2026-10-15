---
name: 2026-10-07-hvc-context-closeout
status: active
reconcile: manual
pr: 88
started: '2026-10-07'
description: >-
  Preserve HVC engineering history and a remote-only retirement/revival handoff
owner:
  - Maintainers
tags:
  - closeout
  - docs
---
# HVC Context Preservation

## What

Create a portable, evidence-bounded handoff for Hermes Voice Control. Preserve
all available GitHub PR/issue references, the implementation sequence,
decisions and rationale, review provenance, source behavior, unresolved gates,
and safe resumption/retirement paths. Repair the repo-local doc-maintenance
contract and generated index.

## Why

The operator is reconsidering custom voice-client investment now that upstream
Hermes has additional voice surfaces. Closing the workstream must not erase
why it was built, what actually shipped, where production claims exceeded
evidence, or what is required to safely pick it up again.

## Scope

In scope: living docs, a dated upstream-first decision, complete paginated
GitHub metadata ledgers, private raw-source preservation with checksums, source
coverage, and an independently reviewed documentation PR.

On 2026-10-14, scope expanded to the operator-approved remote-only handoff:
feature/source map, detailed abandoned-work dispositions and closure receipts,
recoverable remote code refs, and a fresh-agent cold-start assessment.

The operator then approved the exact preview: merge #88, unload/uninstall only
the dedicated HVC agent, remove its one HTTPS route, remove four linked trees
through wt and delete the canonical checkout including project-local ignored
material. The [execution receipt](reviews/2026-10-14-retirement-execution.md)
records results and the later approved retirement of the extra HVC API. The
main messaging gateway and shared Hermes data/configuration were left alone.

Out of scope: implementation changes, accepting/installing a replacement,
shared-service or tailnet-policy changes, rotating secrets, deleting unrelated
sessions, exporting private chat/audio publicly, or claiming a fresh production
audit. Prior approvals in archived records are history, not current authority.

The initial October 7 pass did not authorize issue closure. The later direct
operator request did. The later exact cleanup preview was approved and
executed; it does not authorize future cleanup. See the
[retirement decision](../../../decisions/2026-10-14-remote-only-retirement.md).

## Evidence Boundary

Baseline is main at `c7c501f51c2649883cab291390b297a673af17c0`.
The GitHub snapshot predates this preservation PR: 54 PRs, 33 non-PR issues,
76 discussion comments, zero inline comments, and zero formal review records
across all 54 PRs. Reported independent reviews are discussion comments.
Complete API pagination is not equivalent to complete historical agent-session
coverage; see [evidence and coverage](audits/evidence-and-coverage.md).

## Success criteria

1. The project handoff links the current architecture, history, decisions,
   complete ledgers, coverage limits, and a safe resumption plan.
2. Every captured PR is classified as merged, closed-unmerged, or open; each
   non-PR issue has its exact captured state and closure reason when supplied.
3. Public docs contain no private deployment identity, credentials, raw
   personal transcripts, or private payload dumps. Ignored evidence has a local
   inventory; its absence from fresh clones is explicit.
4. Archived specs stay byte-for-byte unchanged. Incorrect archive/acceptance
   implications are corrected in dated new records, not rewritten as history.
5. `pnpm docs:verify`, docs audit/index verification, structured ledger checks,
   and `git diff --check` pass; an independent bounded review is recorded.
6. A documentation PR carries the verified branch and evidence. Source-lifecycle
   reconciliation after its merge is a separate step, not a claim that HVC's
   physical/reboot production gates passed.

## Closeout Lifecycle

This bundle uses `reconcile: manual`: living docs link to its active location,
so an automatic move would break their references. An approved archival
transaction must update every inbound living-doc link to the archived
location, regenerate the index, and pass `pnpm docs:verify` before publication.
Do not subsequently rewrite the archived snapshot.
