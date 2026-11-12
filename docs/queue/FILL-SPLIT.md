state: done
started: 2026-11-12T09:32Z
heartbeat: 2026-11-12T09:37Z
outputs: claude/fill-split 28810f62 (from claude/link-calibration 1f7a2f2c; no PR: the row names no base)
## Resume
Done. b4d44121 lab/phone/fill.py + fill_test.py (gate line; 9 mutants killed: decoder count, a missing decode as
nonzero, wire time without the session's first row, row period, rest as the fill, share 0 for none, failed loads in
the medians, mean for median, step offset); link.sessions returns the load. 28810f62 docs/phone-rows/README.md
*What bounds a fill*, wire time's "open" closed in place, load 6's bullet; docs/lines/optimal-quality.md.
Gate: not run in full (docs + Python tools); ran fill_test.py, link_test.py, comment_budget.sh, bash -n scripts/gate.sh.
## Result
Fixtures: the phone run's beacon and server rows (one phone, Chrome 157, one home AP, one evening, dbts_b1-q8-g8,
50 frames, 11-12 counted loads per link x controller; run commit 962226e8, not the demo commit).
The fill is bound by the phone's decode: the frames' decode time over the three decoders is 0.76-0.94 of every fill
(median ~0.90), 133-135 ms a frame on every link and controller; the server's wire time is 0.5-1.0 s and done within
the first second. The rest (fill - floor, 0.22-0.35 s) holds the dial, the first frame, idle decoders, the last paint.
Loads 6 (9.7 s) and 10 (16.5 s) were slow decodes (524 / 872 ms a frame), not slow wire; README corrected in place.
Not pre-registered: the rest is larger under bbr on both links (0.32 vs 0.25 s, 0.35 vs 0.22 s); decides nothing.
Saturation not shown: prefer-software is a hint, the decoder Chrome took is not recorded, the decoder count was not
varied; at three decoders the phone decodes ~21 frames/s, so a faster link cannot shorten this fill by more than the rest.
Owner decision: none needed; whether the next round varies the decoder count (or records the decoder and per-frame
arrival times in the beacon) is the protocol amendment's.
