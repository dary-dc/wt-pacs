state: done
started: 2026-11-23T01:52Z
heartbeat: 2026-11-23T01:56Z
outputs: claude/phone-run be4d6555 (docs/phone-rows/next-round-results.md §Cell 3, the owner decisions' item 3 and the round's cell-3 line corrected in place; docs/lines/devices.md)
## Resume
Done. Next: a review of §Cell 3 by another session (every number recomputed from raw/2026-11-22-cell3d/ at f96e38a9).
## Result
Docs only; check_links 0 unresolved on claude/phone-run; gate not run (no code changed).
* Code check: 48 of 48 loads have one drain record, path post (only f5252051 writes it); none set apart. All ok, 50 of
  50 frames, the largest gap 1.47 s, thermal 0 throughout. 24 ABBA pairs, threshold 18.
* Cine busy: **worker faster**, 24 of 24 (p about 1.2e-7), median ratio 0. The worker dropped 0 of 100 in every load,
  the page a median of 7 (1-16); the median paired difference is -7 [-11, -5] frames, a 97.7 % distribution-free interval.
* Frame-change busy: no difference shown (10 of 24, ratio 1.038, page 11.4 ms, worker 13.3 ms). The protocol's
  prediction (worker faster) missed. Idle frame-change and cine, the exact frame idle and busy, and the fill: no
  difference shown (held).
* Guard (a), an assumption: not binding. First picture from page start: 17 of 24 above (18 needed), +8.6 ms
  [-4.2, +27.1]. The protocol's prediction (page faster) missed. The rows have no first-picture field: the read uses
  the first label minus the page's first record, with the dial-based reading beside it. DEVICE-THEORY §2 adds
  nothing to cell 3.
* Deviations carried: a fresh Chrome per load (48), RUN_CODE f5252051 for cell 3 only, the restart at K=16 with the
  budget from zero (pairs not split: pair 7 ends at load 15), and the blank tab from step 16 (stopAt - quietAt about
  1.6 s, against 2 ms before). TEST-curl and aborted starts were not read.
Fixtures: one phone (Android 16, 8 cores), one home 5 GHz Wi-Fi (-31/-28 dBm), one laptop, one evening, dbts_b1-q8-g8
only, a synthetic busy page; the host's saturation was not measured.
