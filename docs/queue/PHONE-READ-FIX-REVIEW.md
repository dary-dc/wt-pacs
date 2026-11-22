state: done
started: 2026-11-22T21:27Z
heartbeat: 2026-11-22T21:29Z
outputs: claude/phone-run 1e9f1714 (docs/phone-rows/next-round-results.md §Re-review; docs/lines/devices.md)
## Resume
Done. Claimed at 21:27, 17 min after the fix's last push (21:10); nothing moved after it. Next in the client queue:
MOBILE-DECODE-REJUDGE (its needs now met).
## Result
Both blockers closed against the raw rows (raw/2026-11-22/ at 618dd9cd); no blocker open.
B1: the codecs.xml sections from lines 1325 and 1838 (the ones listing c2.qti.av1.decoder) declare HEVC 8192x8192
(36-138240 blocks) and VP9 4096x4096 (36-36864); the update="true" sections carry no size; dbts_b1's 33 280 blocks
fit (derived; declared, not decoded). Correct here and in claude/mobile-decode other-codecs.md.
B2: gap 0.36-0.59 s (dbts_a1), 1.20-1.65 s (dbts_b1); end to end C2 / (A+B) 14 of 15 above 1, median 1.236,
p = 0.0010; summed median 1.031, p = 0.607: both readings as the fix states; the cause in round-page.js confirmed.
The fix's m1 correction and m2's paints match the probe row; m3 not recomputed; nothing else changed.
One nit: the summed row counts below 1 without saying so.
Fixtures: one phone, one home Wi-Fi, one evening, two DBT volumes of one dataset; no ultrasound.
