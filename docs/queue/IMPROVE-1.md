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
premium phone, one home Wi-Fi link, one evening, `dbts_b1` and `dbts_a1`'s cut, Q 8 G 8, software decode); no
ultrasound, second phone or cellular link: other devices and links are the device model's (theory).
* Model, not run in the product: `dbts_b1`'s window is 15 frames, its group 8; the store lets go single frames, the
  downloader fetches whole groups: a forward scroll over 50 frames delivers 398 (185 MB; the exact series is 107 MB),
  a step at the window's edge waits 0.5-0.8 s. No gate fixture meets the case.
* Derived from the rows: "the view saturates at three decoders" is 7 groups over 4 decoders (16, 16, 10, 8 frames);
  a decoder's first HTJ2K decode is +42 ms (20-66, n 30); cell 3's exact frame "idle 201, busy 120 ms" is the first
  request against the second.
* Nine candidates ranked. Queued, a build and a measuring row each: WINDOW-WHOLE-GROUPS (a defect; the failing
  product test first), DECODE-OVERLAP (-14 to -27 % of a decode-bound fill, on a share read first), DIAL-BEFORE-PAIR
  (-1 to -2 round trips on the first picture). Not queued: a warm exact decoder; four cells named for PHONE-ROUND-2.
Owner, last: WINDOW-WHOLE-GROUPS holds two whole groups, 273 MiB on `dbts_b1` against 256. Would reopen, only if
taken: candidate 5 (a jump deep in a group served by the exact frame, unasked), sized for EXACT-UNASKED, not built.
