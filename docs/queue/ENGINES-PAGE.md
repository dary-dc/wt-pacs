state: done
started: 2026-11-22T16:27Z
heartbeat: 2026-11-22T16:30Z
outputs: `claude/reviews-2026-11-28` at `4193fabd2` (`docs/decisions/engines.md`; the README's index line; `docs/lines/client.md`); draft PR of DECISIONS-OPEN
## Resume
Done. Nothing left for this row. The page's items 3 and 4 (trace Firefox's G = 8 failure; M5's amended bar on Firefox
160) and item 5 (the Safari probe order) are rows for the next queue, PROGRAM-CLOSE's list.
## Result
* Page written from pushed results only (`claude/engines` `222817b1`, PR 410's reviews; `frame-memory-ownership.md`
  on `claude/unified` `4a2b4277`); nothing run.
* What holds: Chromium and Firefox desktop measured on every matrix row, Firefox's AV1 view by dav1d (WebCodecs refuses
  the grey form at configure); Safari macOS and iOS: no row measured, three turn on device or OS (AV1 hardware,
  OS 26/27 Network.framework, the embedder's `SharedArrayBuffer`).
* Precondition carried: Firefox's `VideoDecoder` fails frames 1–7 of 8-bit G = 8 groups (159.0.1, 160.0.1), so no 4:2:0
  view form goes to it until traced; a colour ultrasound clip would be such a form (derived, not measured).
* Contradiction 6: ring − floor 286 MiB on 159.0, 262 on 155.0 (derived), both under the 320 bar; the amended fill bar
  never read on 159+; one Firefox 160 run closes it.
* The Chromium D1 report cell cited as one clean run of two (Re-review n3).
* Docs only: `check_links.py` 5 unresolved, all pre-existing in other pages, none in this one (two of its own fixed by naming `claude/engines`); comment budget ok; gate not run.
* Fixtures and limits: one 4-vCPU container, no GPU, software decode, one round per cell, `dbts_a1` only (1 of 19 DBT
  volumes, one dataset), no ultrasound cine, no Safari, no phone; the ring's rows 80 frames of one series, 7 rounds.
* Owner: six yes-or-no items in the page's §2 (recommended yes on all six).
