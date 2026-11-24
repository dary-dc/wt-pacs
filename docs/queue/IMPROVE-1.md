state: done
started: 2026-11-24T07:22Z
heartbeat: 2026-11-24T07:33Z
by: T6fTai3R
outputs: `claude/work-ledger` (`docs/queue/IMPROVE-1/candidates.md`, `window-model.mjs`, `rows.py`; six rows and their briefs appended to `docs/queue-2026-11-24.md`; `docs/lines/coordination.md`); no PR
## Resume
Done. Nothing to continue. Read at `origin/claude/unified` `b059388b6`, `origin/claude/phone-run` `8d77ba2b4` (raw rows at
`618dd9cd`), the pages at `2413ed211`. Reproduce: `node docs/queue/IMPROVE-1/window-model.mjs <a claude/unified
checkout>/client`; `python3 docs/queue/IMPROVE-1/rows.py <claude/phone-run>/docs/phone-rows/raw/2026-11-22/round/beacon.jsonl`.
Ledger only: the gate not run, `scripts/check_links.py` not run on this branch (the paths named are on other branches,
each beside its branch). No source outside the repository fetched. Next: IMPROVE-1-REVIEW (findings in `candidates.md`
§Review), then WINDOW-WHOLE-GROUPS, DECODE-OVERLAP, DIAL-BEFORE-PAIR and their -MEASURE rows.
## Result
Reading, a model and arithmetic; nothing built, timed or run in a browser. Fixtures: the 2026-11-22 round's rows (one
premium Android phone, one home Wi-Fi link, one evening, `dbts_b1` and `dbts_a1`'s cut, the view at Q 8 G 8, software
decode); no ultrasound, no second phone, no cellular link: other devices and links are the device model's (theory).
* Model, not run in the product: `dbts_b1`'s window is 15 frames and its group 8; the store lets go single frames
  and the downloader fetches whole groups, so one forward scroll over 50 frames delivers 398 (185 MB; the exact
  series is 107 MB) and a step at the window's edge waits 0.5-0.8 s. No gate fixture meets the case.
* Derived from the round's rows: "the view saturates at three decoders" is 7 groups over 4 decoders (16, 16, 10, 8
  frames), not the cores; a decoder's first HTJ2K decode is +42 ms (20-66, n 30); cell 3's exact frame "idle 201,
  busy 120 ms" is the load's first request against its second (confounded).
* Nine candidates ranked on the first picture, the fill and the jump. Queued, each a build and a measuring row:
  WINDOW-WHOLE-GROUPS (a defect; its first step is the failing product test), DECODE-OVERLAP (the next unit decoded
  while the last is read back; -14 to -27 % of a decode-bound fill, on a share no row holds, read first),
  DIAL-BEFORE-PAIR (-1 to -2 round trips on the first picture).
* Not queued: a warm exact decoder (a CPU trade-off; the phone's swapped-order cell first); four cells named for
  PHONE-ROUND-2's plan, not appended to it.
Owner, last: WINDOW-WHOLE-GROUPS holds two whole groups, 273 MiB on `dbts_b1` against the 256 MiB default. Would
reopen, only if taken: candidate 5 (a jump deep in a group served by the exact frame: 0.9-1.5 s to 0.07-0.12 s on the
round's link) shows an exact frame unasked, against "the exact HTJ2K frame on an explicit Lossless request"; sized for
EXACT-UNASKED, nothing built on it.
