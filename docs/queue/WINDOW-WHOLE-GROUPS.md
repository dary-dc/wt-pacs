state: done
started: 2026-11-24T12:27Z
heartbeat: 2026-11-24T12:57Z
by: VuNcjzKy
outputs: claude/window-whole-groups e8a52cfe4 (test 5353ae8de, change a9524505b), draft PR 446 into claude/unified
## Resume
Done. Nothing left for this row; WINDOW-WHOLE-GROUPS-MEASURE (another session) measures PR 446.
## Result
* §2 of candidates.md holds in the product: on the tip b059388b6, the real downloader behind a stand-in transport
  (client/view/window.test.mjs; 50 frames, G = 8, W = 15) put 268 frames on the wire for one forward pass and 280 for one
  back (the model said 398 and 234); a sawtooth 24|23 refetched groups 2 and 3 on every turn.
* Built: a series in groups is held, wanted and let go a whole group at a time, at least two (its own and the nearer
  neighbour, the later at a tie), nearest first; the store lets go a frame outside the want first. After it: 34 and
  40, each frame once; the sawtooth fetches nothing. G = 1 and a cache are unchanged.
* Memory added only when W < 2G, by 2G - W frames: dbts_b1 16 frames, 260 MiB against 256 (candidates.md's "273 MiB" is MB).
* Six mutants each fail a test. Gate: full gate green to the decoders' Docker rebuild, which failed on docker.io 429
  (rate limit); then --quick OK in 324 s plus the three absence checks green, every skip named in PR 446.
* Fixtures and limits: synthetic 1x1 frames, stand-in transport and decoders; frames counted, no time, no link, no
  browser beyond the gate; no DBT volume or ultrasound clip opened; dbts_b1's bit depth from candidates.md, not re-read.
* No owner decision: a non-regressor goes to a sync row after WINDOW-WHOLE-GROUPS-MEASURE.
