state: done
started: 2026-11-21T14:46Z
heartbeat: 2026-11-21T14:50Z
outputs: findings in PR 410's body §Re-review; claude/engines 222817b1 (docs/lines/client.md)
## Resume
Done. Nothing left for this row. Next: ENGINES-PAGE (B1 closed, no blocker open).
## Result
Read at e83b3457 against 709396ad. B1 closed: rows 1, 6, 7, 11, 12 and the So each match engines-smoke/'s raw rows
(dispatch 764/781 twice on 160.0.1, 763/781 on 159.0.1, 789/789 Chromium; only webcodecs: G = 8 lines fail, frames
1-7 of each group, no dav1d: FAIL; draft-02 alone offered by Chromium 153/158/159/160; getStats proto undefined on
153/158/159, present on 160.0.8173.0 without byte counts; Firefox D1 one balanced round). m1, m3, m4's sources
re-fetched at the pins: verbatim. Nothing else changed: every hunk maps to B1 or m1-m4.
Nits: n1 row 11's "four arms deliver" counts off, which delivers its safety record only; n2 row 6's "M 157.0.1"
left bare; n3 (outside the fix) Chromium's c6 jsonl holds two interleaved D1 runs, in one session:Y and keepalive:Y
fail "Opening handshake failed".
Docs only: check_links 0 unresolved; gate not run. Fixtures: ENGINE-SMOKE's (one 4-vCPU container, no GPU,
dbts_a1 only, one round per cell, no Safari, no phone); nothing re-run.
Owner: nothing asked; ENGINES-PAGE should cite Chromium's D1 cell as one clean run of two (n3).
