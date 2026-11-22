state: done
started: 2026-11-22T21:47Z
heartbeat: 2026-11-22T21:54Z
outputs: claude/mobile-decode e4edceb0 (each option file's phone column), 30f9757b (README.md §1, §2, §6, §6.1, §8), 9cdf8f474 (docs/lines/client.md); PR 397, no new PR
## Resume
Done. Read at claude/phone-run 1e9f1714 (re-reviewed, no blocker open). Docs only: scripts/check_links.py shows the
same 9 unresolved paths before and after (none in this change); the gate was not run. Next: MOBILE-DECODE-REJUDGE
has no review row in the client queue; PHONE-ROUTE-PAGE and DELIVERY-RUN of the program list it among their needs.
## Result
§6 judged again with the round (one phone, M), carried to other classes by device-model.md §4 and route-policy.md §3 (D on A):
* AV1 in software stays the route of record: 42.1 ms effective at three decoders, saturated at three; 176 ms on one.
* HTJ2K in WASM is the faster decoder (18.9 ms effective, x2.23); the link decides, above G* 251-408 Mbit/s
  (dbts_b1) and 590 (dbts_a1) on that phone, 53-191 entry, 80-419 middle, 220-521 premium.
* Lossy HTJ2K from hold to the first ask (M17): by the cloud's 1.12-1.21, 21.2-22.9 ms effective, half the view's,
  at a median 1.05x its bytes, full depth; faster than the view above 57-93 Mbit/s (D on A).
* WebGPU narrows to links above the exact series' decode-bound point (666-910 Mbit/s there; 207-521 entry): M20 on
  an entry or middle phone. Hardware: 10 bits do not come back on that phone (cell 4, 256 x 256); 8-bit inverted
  after M17 (M5, M6-M7). Other codecs: nothing on that phone (AV1 declared at the size).
* §6.1: the six held AV1 rows (G shard 2, noise-ratio run, tiles' step, other codecs' and strips' byte cells, the
  decode audit's checks), each with its options and the measurement that decides it.
Fixtures and limits: one phone (Android 16, Chrome 157), one home Wi-Fi (>= 568-595 Mbit/s), one evening, dbts_b1 and
dbts_a1's cut, the view at Q8 G8, software decode; cell 4 at 256 x 256 only; no US, no iPhone, no second engine.
PHONE-READ-CODE-CHECK was not done: a load it sets apart changes these numbers.
Owner decisions: release, re-aim or drop each held AV1 row (§6.1); nothing else decided here.
