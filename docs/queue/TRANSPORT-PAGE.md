state: done
started: 2026-11-22T09:17Z
heartbeat: 2026-11-22T09:20Z
outputs: claude/reviews-2026-11-28 20b7f161 (docs/decisions/transport-stack.md; README.md index line; docs/lines/codecs.md §Open 6); draft PR 405 ("do not merge: decision pages"), no new PR
## Resume
Done. Read only, from pushed results: claude/transport-design dd754894 (stacks.md §1-§6.6), claude/transport-arms 4b2abcb6
(rows), origin/claude/unified (transport/design.md, network-mode.md, transport-conclusions.md), claude/docs-client
(congestion-controller.md, lossless-after-a-failed-ask.md, hidden-page-decode.md), PR 254's body. Nothing run. Docs-only:
check_links 3 unresolved (pre-existing, lab-list.md), comment budget ok, the gate not run. Nothing owed by this row.
## Result
Fixtures: dbts_b1 HTJ2K alone; one 4-core container, Chromium 157 headless; the TUN relay at <= 90 Mbit, profiles assumed
and scaled, no radio; FP not run, ENT unbalanced, AD's re-run unreviewed; no Firefox, Safari or phone.
* Fill: every stack ties where the wire binds (measured); WT and H3 keep their window over a 5 s pause, TCP arms x1.35-1.70.
* Fetch fill shape and WS answer an ask during a fill in 0.47-0.74 of WT-TS (measured); H3-frame 0.630 on CR (stream credit).
* WT's own flags (one queue, per-frame streams) were never run in this rig against those wins (derived gap).
* bbr's loads 6 and 13: a 30 s silence from the phone and a stalled decode; neither the server controller's (derived).
Owner, last (transport-stack.md §2): WebTransport the one wire, no GET path now; queue AD and CR with WT's one-queue and
per-frame flags against the fetch arms; WS stays an off fallback; host networking waits on network-mode.md §6 from a client
off the host; initial window stays 12 000 B (close #37); #40 close, #39/#96 wait on that run, #41 held; bbr not withdrawn.
