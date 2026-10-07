# Upstream-First Voice

Date: 2026-10-07. Status: recommended maintenance direction, not a completed
migration. Supersedes the assumption that HVC must keep expanding its own
voice-client stack; does not remove the implementation or historical decisions.

## Problem

The operator wants to speak to their existing Hermes agent from a phone, with
its memory, tools, permissions, and familiar voice. Custom browser speech,
mobile lifecycle recovery, provider turn routing, and playback consumed
substantial maintenance effort. New upstream capabilities may now cover more
of that intent, so continuing the same investment without a comparison is
unjustified.

## Current Alternatives

These are dated research observations, not locally accepted deployments.

| Path | Relevant capability | Acceptance gap |
| --- | --- | --- |
| Native Hermes voice | Documented chained STT/agent/TTS and GPT Live modes; existing agent retains responsibility for real work | Native phone access, persistence, approvals, and chosen voice must be tested in the intended installation |
| Hermes desktop | Documented desktop surface and voice integration | Desktop availability is not proof of an iPhone browser replacement |
| ChatGPT Voice with remote connections | Phone voice surface with a paired host/tool connection | A narrow, authenticated, persistent Hermes bridge is not implemented or accepted here |
| Community Hermes voice clients | Reusable browser/desktop transports and UI patterns | Preview status, auth, approval behavior, mobile support, and ownership of agent state vary |
| Jev / Decisions-style routing | Structured routing of bounded voice actions | Routing alone does not provide Hermes memory, arbitrary agent work, or safe approvals |

Primary references:
[Hermes voice mode](https://hermes-agent.nousresearch.com/docs/user-guide/features/voice-mode/),
[Hermes desktop](https://hermes-agent.nousresearch.com/docs/user-guide/desktop/),
[ChatGPT Voice](https://learn.chatgpt.com/docs/features/voice),
[remote connections](https://learn.chatgpt.com/docs/remote-connections), and
[OpenAI Decisions voice](https://developers.openai.com/api/docs/guides/decisions-voice).

Community candidates found during research:
[Synero/hermes-live-voice](https://github.com/Synero/hermes-live-voice),
[bielcarpi/hermes-live-voice](https://github.com/bielcarpi/hermes-live-voice),
[TheSmokeDev/hermes-talk](https://github.com/TheSmokeDev/hermes-talk), and
[jev-voice-browser](https://github.com/moritzkremb/jev-voice-browser).
These links establish candidates, not endorsements or equivalence to HVC.
One reviewed browser candidate explicitly lacked interactive approval handling;
another offered a subscription-backed GPT Live route whose support boundary
must be checked before adoption. Prefer documented, supported authentication.

## Decision And Rationale

Freeze broad feature expansion; preserve source, decisions, evidence, and
fallback operation. Compare the smallest upstream route against real operator
tasks before deciding to maintain, replace, or retire HVC.

Native chained voice is the first candidate when the exact configured Hermes
TTS voice matters. GPT Live is a candidate for fluid duplex conversation, but
its speech voice is not automatically the configured ElevenLabs voice. A
voice frontend must delegate work to the actual agent; changing a model's
display name does not connect it to that agent.

Do not rebuild a Gemini TTS stack to replace the existing Hermes speech
endpoint. Do not migrate to Jev merely because a voice demo routes actions:
closed-set decision routing and persistent, approval-aware agent work solve
different problems. Borrow narrow components only when an identified gap
survives the upstream evaluation.

## Acceptance Before Retirement

- The intended iPhone and laptop can connect privately with understandable
  authentication and no public tunnel.
- Two related turns demonstrably share the correct agent context, including
  across a refresh/reconnect where promised.
- Hold or live speech is accurate, interruptible, and produces audible replies
  in the selected voice. Silence and lost connectivity have visible recovery.
- Slow work stays visible/cancellable; permissions are surfaced without
  auto-approving the agent's requests.
- Deployment recovery, secret handling, and rollback are demonstrated, not
  inferred from a README or a listening process.

The [resumption plan](../specs/active/2026-10-07-hvc-context-closeout/plans/resumption-and-retirement.md)
contains the actionable gates. Until they pass, retain HVC and its private
evidence. Closing a superseded issue is an administrative decision, not a
claim that its original physical QA passed.
