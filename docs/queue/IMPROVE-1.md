state: started
started: 2026-11-24T07:21Z
heartbeat: 2026-11-24T07:29Z
by: T6fTai3R
outputs: `claude/work-ledger` `docs/queue/IMPROVE-1/candidates.md` (not yet written); build rows to be appended to `docs/queue-2026-11-24.md` §Rows
## Resume
Read so far (nothing pushed but this file): `device-model.md`, `next-round-results.md`, the round's raw rows
(`claude/phone-run:docs/phone-rows/raw/2026-11-22/round/beacon.jsonl`, per-frame and per-decoder), `client/view/`,
`client/decode/`, `client/transport/downloader.js` at `origin/claude/unified` `b059388b6`, the 21 pages' §2 at `2413ed211`,
`docs/levers.md`, `route-policy.md`. Findings to write up: (1) a model over the real `FrameStore` and `wantFrom` with
`downloader.js`'s whole-group rule delivers 398 frames for a 50-step forward scroll at W = 15, G = 8 (`dbts_b1`'s case);
(2) the view's "saturation at three decoders" is 7 groups over 4 decoders (16, 16, 10, 8 frames), not the cores;
(3) a decoder's first decode is +42 ms (HTJ2K) and +26 ms (view) over its median, 30 starts each.
Next: write `docs/queue/IMPROVE-1/candidates.md`, push; append the top three build rows to `docs/queue-2026-11-24.md`; the
line doc; done.
## Result
(none yet)
