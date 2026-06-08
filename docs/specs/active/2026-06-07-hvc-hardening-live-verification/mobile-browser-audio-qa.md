# Mobile Browser And Audio QA

Issue: [#20](https://github.com/elijahmuraoka/hermes-voice-control/issues/20)

## Automated Smoke Coverage

Run:

```bash
pnpm smoke:browser
```

The browser smoke matrix covers these high-risk states:

| Area | Automated check |
|---|---|
| Small viewport | 320x740, 360x640, 390x844, 768x1024, and 1280x900 render without horizontal overflow. |
| Focus flow | Orb, mute, end, text input, and transcript toggle keep deterministic keyboard order. |
| Reduced motion | `prefers-reduced-motion: reduce` disables orb animation timing. |
| Mic denial/retry | A mocked mobile session rejects the first microphone request, shows an error state, then connects on retry. |
| Muted start | Mobile can enter mute before connecting, start a session, and unmute without getting stuck. |
| Slow network | A delayed ephemeral-token response keeps controls visible and avoids mobile overflow. |
| Barge-in | While mocked Gemini audio is speaking, holding the orb keeps the barge-in gesture reachable without adding a visible interrupt button. |
| Console/page errors | Smoke paths fail on console errors or page exceptions. |

## Manual QA Checklist

Use a real backend with `HVC_GEMINI_MODE=real` for the audio rows. Keep notes
redacted: no transcript content, tokens, PINs, hostnames, or personal data.

| Scenario | Chrome desktop | Chrome mobile viewport | Safari/WebKit | Real phone browser | Redacted notes |
|---|---|---|---|---|---|
| First-load layout has no overlap, clipped labels, or hidden controls. | [ ] | [ ] | [ ] | [ ] |  |
| Keyboard focus reaches orb, mute/unmute, end, text input, send when enabled, and transcript toggle. | [ ] | [ ] | [ ] | [ ] |  |
| Deny microphone permission, then retry after granting permission; the UI must not stay in a dead-end state. | [ ] | [ ] | [ ] | [ ] |  |
| Start muted, connect, then unmute; the session should not require a page refresh. | [ ] | [ ] | [ ] | [ ] |  |
| Browser or OS audio output muted/volume zero; transcript and visible state still make the session understandable. | [ ] | [ ] | [ ] | [ ] |  |
| Agent speaking can be interrupted by holding the orb; late output should stop or be visibly superseded. | [ ] | [ ] | [ ] | [ ] |  |
| `prefers-reduced-motion` enabled; status remains legible without relying on looping animation. | [ ] | [ ] | [ ] | [ ] |  |
| Slow 3G or equivalent throttling during token fetch and connect; controls stay visible and recover. | [ ] | [ ] | [ ] | [ ] |  |
| Background/foreground or incoming-call interruption; capture stops safely and can reconnect. | [ ] | [ ] | [ ] | [ ] |  |
| Text fallback while voice is unavailable; typed draft either sends or fails without being lost silently. | [ ] | [ ] | [ ] | [ ] |  |

## Current Run Notes

- 2026-06-08: Automated smoke passed for mocked mobile mic denial/retry,
  muted-start, slow-token, barge-in, focus, reduced-motion, and constrained
  viewport states.
- 2026-06-08: Real-device Safari/Chrome and real Gemini audio output checks
  remain manual because this local smoke run cannot exercise OS-level speaker
  mute, iOS permission UI, incoming calls, or physical network changes.
