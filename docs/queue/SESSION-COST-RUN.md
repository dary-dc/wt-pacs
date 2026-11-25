state: done
started: 2026-11-24T18:27Z
heartbeat: 2026-11-24T21:32Z
by: G2bMnvtP
outputs: claude/session-cost 9eb07fb67 (session-cost.md §9 amendment, §Results; PR 441); rows and rig on claude/session-cost-rig 8dcc345f5 (lab/delivery/rows/session-*.jsonl)
## Resume
Done. Next: SESSION-COST-VERDICT (a session that wrote none of the protocol and ran none of it).
## Result
147 counted sessions (CLEAN 96 + usb_cine 3, CR 48), 0 VOID, 0 flagged; T1 (rig's client/view, client/transport = b059388b6).
Asks held for B, FIT on CLEAN, every dbts_a1 cell, usb_cine; missed for the view under its window: dbts_b1 A 305.5
  (CLEAN) / 215.5 (CR) for 796, dbts_c1 A 119 / 94 for 177; on CR B and FIT on dbts_b1 also low (105, 114).
Bytes follow the asks (within ±0.1 % where asks held). T1's "A dearest on dbts_b1" falls: B is dearest everywhere.
Lowest bytes and CPU: A on dbts_a1 (x14.6 under B) and dbts_c1 (x8.1 / x10.2); FIT on dbts_b1 (x3.4 / x3.5).
CPU: exact frames 5.3-5.8 ms a wire MB, above 4.6-5.1 (miss high); CR, where asks held, exact x1.00-1.07 of CLEAN,
  view x1.75-1.85 on dbts_a1 (corrected 2026-11-25, SESSION-COST-VERDICT-FIX m2; was "CR x0.80-1.07 for exact").
Peak RSS 5.1-12.1 MB (5.0 corrected 2026-11-25, SESSION-COST-VERDICT-FIX-2 r-n2) on every cell against 0-5: bounded (exact 10-12 MB at 70 or 292 MB), not growing with bytes.
Against the frame retrieve (theory): lower server CPU only for dbts_a1's A on CLEAN; on CR not shown (x13.9-15.5
  against x14.6; was "not met (x14.8)", corrected 2026-11-25, SESSION-COST-VERDICT-FIX-2 r-n3: HTTP/2 0.81-0.90 ms a
  wire MB) and no HTTP/2 rate on CR (corrected 2026-11-25, SESSION-COST-VERDICT-FIX B1). Bytes are delivered bytes:
  egress the relay's queue dropped is unseen, at most 15 % on CLEAN's view cells (m1).
Departures, §9 before counted rows: one server pair a session (the rig's, as the 11-23 rows); the relay's guard
  recorded not VOIDing (98/147 tripped; wake-from-idle hypothesis, not checked); ask count corrected to frames off
  the wire (19:20, rows running, no prediction moved). Client -> server bytes not recorded (relay counts packets).
Fixtures and limits: dbts_a1, dbts_b1, dbts_c1 (one dataset), usb_cine (lossy-sourced: function check); one 4-core
  cloud container, no GPU, headless Chromium 158, software decode; TUN userspace relay CLEAN and CR, not a radio;
  one session at a time on an assumed trace (§1); the servers' core at most 46 % busy.
No owner decision.
