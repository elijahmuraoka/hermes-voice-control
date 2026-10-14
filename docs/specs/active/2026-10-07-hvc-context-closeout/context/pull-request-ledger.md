# Pull Request Ledger

Snapshot: 2026-10-07, before the preservation PR. All 54 API-visible PRs are
listed: 46 merged, six closed without merging, two open (one draft).
Closed is not synonymous with merged or successfully verified.

Dates are UTC calendar dates from GitHub. Discussion counts refer to the
76-comment capture; formal review records and inline review comments were zero.
See [evidence and coverage](../audits/evidence-and-coverage.md) and the
[metadata snapshot](../evidence/github-metadata.json) for reproducibility.

## Merged

| PR | Title | Created | Outcome date | Merge commit / state | Discussion comments |
| --- | --- | --- | --- | --- | --- |
| [#11](https://github.com/elijahmuraoka/hermes-voice-control/pull/11) | fix(hvc): close production readiness review gaps | 2026-06-07 | 2026-06-08 | `14e2928` | 0 |
| [#21](https://github.com/elijahmuraoka/hermes-voice-control/pull/21) | docs(providers): add realtime provider bakeoff decision | 2026-06-08 | 2026-06-08 | `b4a54a4` | 0 |
| [#22](https://github.com/elijahmuraoka/hermes-voice-control/pull/22) | docs(release): add private deployment and release gates | 2026-06-08 | 2026-06-08 | `b0f4a58` | 0 |
| [#23](https://github.com/elijahmuraoka/hermes-voice-control/pull/23) | security(hvc): add threat model gate | 2026-06-08 | 2026-06-08 | `3e1d7cb` | 0 |
| [#24](https://github.com/elijahmuraoka/hermes-voice-control/pull/24) | perf(web): add realtime voice diagnostics | 2026-06-08 | 2026-06-08 | `e3943be` | 0 |
| [#26](https://github.com/elijahmuraoka/hermes-voice-control/pull/26) | test(voice): verify real Hermes and Gemini bridges | 2026-06-08 | 2026-06-08 | `de04d49` | 0 |
| [#27](https://github.com/elijahmuraoka/hermes-voice-control/pull/27) | feat(web): add realtime provider boundary | 2026-06-08 | 2026-06-08 | `2241335` | 0 |
| [#28](https://github.com/elijahmuraoka/hermes-voice-control/pull/28) | chore(release): integrate production readiness lanes | 2026-06-08 | 2026-06-08 | `ee2a1d3` | 0 |
| [#29](https://github.com/elijahmuraoka/hermes-voice-control/pull/29) | docs(hvc): remove local path from security review | 2026-06-08 | 2026-06-08 | `73fc538` | 0 |
| [#31](https://github.com/elijahmuraoka/hermes-voice-control/pull/31) | fix(hvc): redact prefixed diagnostics API keys | 2026-06-08 | 2026-06-08 | `13f5145` | 0 |
| [#32](https://github.com/elijahmuraoka/hermes-voice-control/pull/32) | feat(hvc): add private Tailscale deployment runner | 2026-06-09 | 2026-06-09 | `31089d0` | 0 |
| [#34](https://github.com/elijahmuraoka/hermes-voice-control/pull/34) | docs(hvc): record final private deployment status | 2026-06-09 | 2026-06-09 | `a427b79` | 0 |
| [#35](https://github.com/elijahmuraoka/hermes-voice-control/pull/35) | ci: update actions for node24 runtime | 2026-06-09 | 2026-06-10 | `993d26b` | 0 |
| [#37](https://github.com/elijahmuraoka/hermes-voice-control/pull/37) | feat(private-runner): add durable launchd service | 2026-06-09 | 2026-06-10 | `6369417` | 0 |
| [#39](https://github.com/elijahmuraoka/hermes-voice-control/pull/39) | fix(web): use same-origin API for private deployments | 2026-06-11 | 2026-06-11 | `d991812` | 0 |
| [#41](https://github.com/elijahmuraoka/hermes-voice-control/pull/41) | fix(hvc): close voice edge regressions | 2026-06-18 | 2026-06-18 | `4f18012` | 0 |
| [#42](https://github.com/elijahmuraoka/hermes-voice-control/pull/42) | chore(deps): bump the frontend group across 1 directory with 3 updates | 2026-06-21 | 2026-06-26 | `cf8416a` | 0 |
| [#43](https://github.com/elijahmuraoka/hermes-voice-control/pull/43) | fix(private): tolerate existing HVC serve route | 2026-06-26 | 2026-06-26 | `18b0d2c` | 0 |
| [#44](https://github.com/elijahmuraoka/hermes-voice-control/pull/44) | fix(web): stop stuck text fallback requests | 2026-06-26 | 2026-06-26 | `6630095` | 0 |
| [#50](https://github.com/elijahmuraoka/hermes-voice-control/pull/50) | fix(server): make Hermes text fallback measurable | 2026-06-26 | 2026-06-26 | `cf3ac6c` | 0 |
| [#51](https://github.com/elijahmuraoka/hermes-voice-control/pull/51) | feat(server): add chat job lifecycle | 2026-06-26 | 2026-06-26 | `a228ec0` | 0 |
| [#52](https://github.com/elijahmuraoka/hermes-voice-control/pull/52) | fix(web): keep slow typed chat recoverable | 2026-06-26 | 2026-06-26 | `2c0ce84` | 0 |
| [#53](https://github.com/elijahmuraoka/hermes-voice-control/pull/53) | feat(web): notify background completions safely | 2026-06-27 | 2026-06-27 | `40a33df` | 0 |
| [#54](https://github.com/elijahmuraoka/hermes-voice-control/pull/54) | fix(web): decode binary Gemini Live frames | 2026-07-02 | 2026-07-02 | `8abd25c` | 0 |
| [#55](https://github.com/elijahmuraoka/hermes-voice-control/pull/55) | test(hvc): align live text harness with chat jobs | 2026-07-02 | 2026-07-02 | `68c88d6` | 0 |
| [#57](https://github.com/elijahmuraoka/hermes-voice-control/pull/57) | fix(harness): keep real Hermes evidence private | 2026-07-02 | 2026-07-02 | `b07ed55` | 0 |
| [#58](https://github.com/elijahmuraoka/hermes-voice-control/pull/58) | fix(web): add explicit basic hold voice mode | 2026-07-03 | 2026-07-03 | `3a89aea` | 0 |
| [#59](https://github.com/elijahmuraoka/hermes-voice-control/pull/59) | fix(deploy): keep private runner alive | 2026-07-03 | 2026-07-03 | `3b8b1b3` | 0 |
| [#60](https://github.com/elijahmuraoka/hermes-voice-control/pull/60) | fix(web): recover Basic Hold speech recognition exits | 2026-07-03 | 2026-07-03 | `13f54ae` | 0 |
| [#61](https://github.com/elijahmuraoka/hermes-voice-control/pull/61) | fix(gemini): configure live voice constraints | 2026-07-03 | 2026-07-03 | `cc3e665` | 0 |
| [#63](https://github.com/elijahmuraoka/hermes-voice-control/pull/63) | fix(web): route Live voice through Hermes agent | 2026-07-03 | 2026-07-03 | `0d7d05e` | 0 |
| [#67](https://github.com/elijahmuraoka/hermes-voice-control/pull/67) | docs(specs): add hvc-production-path overnight execution spec | 2026-07-04 | 2026-07-06 | `ffdcc3b` | 0 |
| [#68](https://github.com/elijahmuraoka/hermes-voice-control/pull/68) | security(server): minimize unauthenticated /readyz detail | 2026-07-04 | 2026-07-06 | `f011a93` | 0 |
| [#69](https://github.com/elijahmuraoka/hermes-voice-control/pull/69) | feat(hvc): add stateful Hermes serve adapter | 2026-07-04 | 2026-07-06 | `f8bdcca` | 2 |
| [#70](https://github.com/elijahmuraoka/hermes-voice-control/pull/70) | feat(auth): remembered-device unlock — PIN once per device | 2026-07-04 | 2026-07-06 | `d7a2b32` | 1 |
| [#71](https://github.com/elijahmuraoka/hermes-voice-control/pull/71) | feat(web): make Hold mode the default voice surface | 2026-07-04 | 2026-07-06 | `3a539f5` | 0 |
| [#72](https://github.com/elijahmuraoka/hermes-voice-control/pull/72) | fix(web): stabilize iOS hold-to-talk capture | 2026-07-05 | 2026-07-06 | `0a7c377` | 2 |
| [#74](https://github.com/elijahmuraoka/hermes-voice-control/pull/74) | feat(web): installable PWA shell — manifest, orb icons, iOS standalone meta | 2026-07-06 | 2026-07-06 | `73fab95` | 1 |
| [#75](https://github.com/elijahmuraoka/hermes-voice-control/pull/75) | feat(server): warm the Hermes session at unlock | 2026-07-06 | 2026-07-06 | `f862983` | 2 |
| [#76](https://github.com/elijahmuraoka/hermes-voice-control/pull/76) | feat(hvc): add Gemini STT for hold-to-talk | 2026-07-06 | 2026-07-06 | `6d38991` | 2 |
| [#77](https://github.com/elijahmuraoka/hermes-voice-control/pull/77) | feat(web): make live voice sessions self-healing | 2026-07-06 | 2026-07-06 | `fb3f449` | 3 |
| [#78](https://github.com/elijahmuraoka/hermes-voice-control/pull/78) | feat(web): add alive orb design pass | 2026-07-06 | 2026-07-06 | `b48ebaa` | 1 |
| [#79](https://github.com/elijahmuraoka/hermes-voice-control/pull/79) | fix: audit remediation — backend security, infra, docs | 2026-07-06 | 2026-07-06 | `9bddcb5` | 1 |
| [#80](https://github.com/elijahmuraoka/hermes-voice-control/pull/80) | fix(web): remediate client ux audit findings | 2026-07-06 | 2026-07-06 | `faaf8f4` | 0 |
| [#81](https://github.com/elijahmuraoka/hermes-voice-control/pull/81) | feat(hold): speak replies with Bob voice | 2026-07-07 | 2026-07-07 | `a01f870` | 1 |
| [#82](https://github.com/elijahmuraoka/hermes-voice-control/pull/82) | fix(web): play Bob's reply through the iOS silent switch | 2026-07-07 | 2026-07-07 | `c7c501f` | 0 |

## Closed Without Merging

| PR | Title | Created | Outcome date | Merge commit / state | Discussion comments |
| --- | --- | --- | --- | --- | --- |
| [#40](https://github.com/elijahmuraoka/hermes-voice-control/pull/40) | chore(deps): bump lucide-react from 1.17.0 to 1.18.0 in the frontend group | 2026-06-14 | 2026-06-21 | closed-unmerged | 1 |
| [#73](https://github.com/elijahmuraoka/hermes-voice-control/pull/73) | chore(deps): bump the frontend group with 4 updates | 2026-07-05 | 2026-07-12 | closed-unmerged | 1 |
| [#83](https://github.com/elijahmuraoka/hermes-voice-control/pull/83) | chore(deps): bump the frontend group across 1 directory with 6 updates | 2026-07-12 | 2026-07-26 | closed-unmerged | 1 |
| [#84](https://github.com/elijahmuraoka/hermes-voice-control/pull/84) | chore(deps): bump the frontend group across 1 directory with 9 updates | 2026-07-26 | 2026-08-02 | closed-unmerged | 1 |
| [#85](https://github.com/elijahmuraoka/hermes-voice-control/pull/85) | chore(deps): bump the frontend group across 1 directory with 10 updates | 2026-08-02 | 2026-08-09 | closed-unmerged | 1 |
| [#86](https://github.com/elijahmuraoka/hermes-voice-control/pull/86) | chore(deps): bump the frontend group across 1 directory with 13 updates | 2026-08-09 | 2026-09-06 | closed-unmerged | 1 |

## Open

| PR | Title | Created | Outcome date | Merge commit / state | Discussion comments |
| --- | --- | --- | --- | --- | --- |
| [#25](https://github.com/elijahmuraoka/hermes-voice-control/pull/25) | test(hvc): cover mobile browser audio QA | 2026-06-08 | - | open-draft | 0 |
| [#87](https://github.com/elijahmuraoka/hermes-voice-control/pull/87) | chore(deps): bump the frontend group across 1 directory with 14 updates | 2026-09-06 | - | open | 0 |

Dependency PRs #40, #73, #83, #84, #85, and #86 closed unmerged.
Do not count them as shipped dependencies. Open #87 requires its own review.
Draft #25 is a physical-QA record, not a missing implementation merge.
