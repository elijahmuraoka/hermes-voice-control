# Local Source Recovery Snapshots

These are historical source variants, not code applied to executable main.
They preserve useful unpublished work before any local deletion without
publishing original private branch ancestry, environments, logs or transcripts.
Read [the retirement decision](../../decisions/2026-10-14-remote-only-retirement.md)
and [feature map](../feature-map.md) first.

## Recovery Variant

`canonical-recovery-source.patch` is a source-only Git diff from public base
`9a24ae64007393e2a49df31588e5084aa3679fbc` to local snapshot
`0a5b1d903ab8c769037515e93a4d7714c4533954`. It covers 28 files under server
implementation/tests, web source, and scripts. No environment, operational
evidence, private docs or raw conversation files are included.

The variant includes earlier turn claiming/deduplication and tests, audio
lifecycle/watchdogs, diagnostics/voice evidence and transcript controls.
Some ideas overlap later public work; other source variants were not present
in public history. It is retained for comparison, not endorsed as an improvement.
No tests of this older variant were run in the retirement pass.

## Precheck CSS Variant

`precheck-safe-area.patch` preserves the remaining CSS difference between
public base `fb3f44966bfb9a09fef295a0cf7f17a5350a16cb` and local precheck
`7d94dff957ff101aaeffde11f2fd426db44e5084`: removing the top safe-area inset
from mobile app-shell padding. All other examined source-file versions in
that precheck history were already in public history. This change is untested
and may be inappropriate for a current iPhone layout.

## Use On A Future Revival

Inspect the patch first, fetch its recorded public base, and use a new worktree
at that base for a mechanical applicability check. Do not apply old patches
directly to current main. Compare source contracts and run fresh tests before
adopting an idea into a new PR. The recorded local snapshot SHA is provenance;
its original private commit graph is intentionally not published.

The owning [closeout review](../../specs/active/2026-10-07-hvc-context-closeout/reviews/2026-10-14-retirement-handoff.md)
records export checksums, privacy-review limits and publication state. Patches
are independently useful from a clone; original machine/private files are not
needed to read them.
