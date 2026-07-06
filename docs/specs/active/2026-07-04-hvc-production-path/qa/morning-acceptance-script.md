# Morning acceptance script (operator-run, ~10 minutes)

This is the only gate that can close the spec. Run on iPhone first, then
MacBook. The orchestrating agent should watch runner logs live while you run
it and record pass/fail per step in STATE.

Prereq: you are on the tailnet. URL: https://bobs-mac-mini.tail764d71.ts.net/

1. Cold open — open the URL fresh. Page loads < 3s, no errors. [ ]
2. Unlock — enter PIN once; close the tab; reopen: no PIN asked again
   (remembered device). [ ]
3. Connection truth — UI shows connected-to-agent indicator green. [ ]
4. Hold-to-talk (default mode) — hold, ask "what time is it and what machine
   are you running on?", release. Your words appeared as you spoke; "working"
   indicator with elapsed time; first response token audible/visible < ~3s;
   answer is clearly from your Hermes agent. [ ]
5. Context — follow-up "and what did I just ask you?" without re-explaining.
   Agent answers correctly (session memory). [ ]
6. Live mode — switch to Live, have a short hands-free exchange; male voice;
   transcript renders in realtime. [ ]
7. Barge-in — interrupt the agent mid-answer; it stops and listens. [ ]
8. Text fallback — type a message; reply streams in. [ ]
9. Durability — leave for 30+ min (or after Mac mini reboot if approved),
   reopen: still up, still unlocked, still connected. [ ]
10. MacBook — repeat steps 1, 4, 6 on the MacBook. [ ]

All boxes checked → approve merge queue (explicit go, per-merge) → merge →
`tomoji docs reconcile --yes` → spec ships. Any box failed → file issue(s)
with the log evidence the agent captured, loop continues on those.
