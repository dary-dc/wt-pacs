state: done
started: 2026-11-11 01:43
heartbeat: 2026-11-11 01:51
outputs: claude/proposals 3c7baf5e (from main 017a3ca6), draft PR #358 into main
## Resume
Done. docs/lines/proposals.md §Optimize (theory against the demo tip claude/demo-fixes-0 618e13c8) and a row in
docs/lines/README.md. check_links.py clean; gate not run (docs only). MEASURE-1 runs P1–P5's protocols as written.
## Result
* Five proposals, most promising first, each with sources, an assumed band, cost and a pre-registered protocol + rule:
* P1 BBR on both pair servers (flag): fill 0.1–0.5x, l 0.2–0.6x at 1 % iid; 0.45–0.8x in bursts; owner's open call.
* P2 tiles in the OQ encode (2x2, 2x1): one tile today leaves Chromium's dav1d tile threads idle; decode 0.4–0.9x, bytes +0.5–3 %.
* P3 a pointerdown wake: end_stream on the exact session (no fill there, a no-op), takes min(P, L) off a promoted radio.
* P4 --initial-window-bytes 38400 on the exact server only: l −5 to −25 % clean.
* P5 dial the exact session after the first picture: 0 to −100 ms first picture on a phone.
* Set aside: exact prefetch (remove work), browser hardware decode (hardware.md §1), 0-RTT, pooling, one session.
* On loopback the fill is decode-bound near the demo link's 20 Mbit; nothing claimed past that.
* Fixtures: dbts_a1, dbts_b1, dbts_c1 of one dataset; no ultrasound cine; 4-core cloud host, no GPU; nothing measured.
* Owner decisions: P1 (BBR, the §9.2 call, for the demo pair); P3's keep-alive variant (energy); P2 needs new demo series.
