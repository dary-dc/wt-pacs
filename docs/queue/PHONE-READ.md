state: done
started: 2026-11-22T20:27Z
heartbeat: 2026-11-22T20:35Z
outputs: claude/phone-run 2d17979b (docs/phone-rows/next-round-results.md, docs/lines/devices.md); claude/mobile-decode 7b2e0013 (one measured line per option file, docs/lines/client.md; PR 397)
## Resume
Done. Next: PHONE-READ-REVIEW (recompute every number from raw/2026-11-22/ at 618dd9cd and raw/2026-11-22-cell3/ at 85326fd3).
## Result
Docs only; check_links 0 unresolved on claude/phone-run, the same 9 as before on claude/mobile-decode; gate not run.
* Cell 1: HTJ2K 18.9 ms effective at 3 decoders (40.4 a frame on one), no saturation within 4; the view 42.1 ms at 3,
  saturating at 3 (its 4th is +10 % slower). DEVICE-THEORY's HTJ2K bands held at every count; its view bands missed at
  1 and 4; the protocol's HTJ2K carry (26-36 ms) missed. No thermal drift.
* Cell 2: B faster than A, 15 of 15 (round 0 VOID: loads 28, 29), median 0.705 (dbts_b1 0.513, dbts_a1 0.771): the
  protocol held, DEVICE-THEORY's tie missed (dbts_a1's A at 1.20 s, ratio 0.33 not 0.247). C2 vs A + B no difference
  shown (both held). C1 exact frame 216 ms dbts_b1 (predicted 80-130), 127 ms dbts_a1. G >= 568-595 Mbit/s (bound).
* Cell 3: not decided (no end batch, the round's and PHONE-ROUND-3C's); waits BEACON-LOSS, PHONE-ROUND-2.
* Cell 4: hardware AV1 allocated; 16x16 refused, 4:0:0 fails at flush, full range back as RGBA (8-bit exact, 10-bit
  off by one); ramp10 1024 distinct in WebGL2 RGBA16F. M1-M22 not run as asked; M4, M12, M20 partly read.
Fixtures: one phone, one home Wi-Fi, one evening, dbts_b1 and dbts_a1's cut (one dataset), software decode.
Owner (on the pages, nothing decided here): B as the route on fast Wi-Fi (delivery-per-link); the model's view
speed recalibrated (ROUTE-POLICY); cell 3 open.
