# DECODE-OVERLAP-MEASURE: findings (2026-11-25)

PR 447 (`claude/decode-overlap` `59605e6e0`) against `origin/claude/unified` `b059388b6`, by a session that built none
of it. Rig, predictions and series in `README.md` (pushed before the counted rows, `ff518e316`); rows `rows.jsonl`
(432, rounds 0–5, one Williams period of the three arms); table `summary.md` (`node summary.mjs`).

## Standing review

* `client/decode/av1.test.mjs`'s overlap tests fail with `av1-webcodecs.js` reverted to the tip (the watchdog: "a unit
  never settled"); its `out()` test fails with `av1.js` reverted ("undefined undefined"); `decoder.test.mjs`'s new test
  fails with `decoder.js` reverted ("frame 1 starts while frame 0 is undelivered (0; ready)").
* `cccac3363` reverted: no unit test fails; the dispatch rig does (`client/contract/run_browser.sh dispatch`, 788/789,
  "group: out of order, after a failure or from another request is refused"). `cfb7c6a04` reverted: no unit test nor
  rig fails; `client/decode/depth-cut.browser.mjs` does (2 failed, "Cannot read properties of null (reading 'index')").
* Nothing else touched: the diff is `client/decode/{av1-webcodecs,av1,decoder}.js`, their tests, `lab/decode-bench/read-share/`
  and docs. HTJ2K's `decodeFrame` takes no `out()`, so `decoder.js` starts its next frame at the end, as on the tip.
* Blockers: none.

## Measured (decode bench, three decoders, coded bytes in memory; medians of 6, branch ÷ tip)

| cell | 1× | 4× | prediction (*theory*) |
| --- | --- | --- | --- |
| fill | −15 % `a1`, −12 % `b1`, −19 % `c1`; per round 0.76–0.93 | −16 %, −10 %, −10 %; per round 0.74–1.05 | −14 to −27 %: inside on `a1` and `c1` at 1×, under it elsewhere |
| request at offset 7 | +4 %, −1 %, −3 % | −24 %, −26 %, −21 % | −18 to −32 %: inside at 4×, a miss at 1× |
| request at offset 3 | +2 %, +3 %, −4 % | −7 %, −29 %, −11 % | the same: inside on `b1` at 4× only |
| request at offset 0 | +1 %, −4 %, −2 % | +13 %, −8 %, +16 % | no change (one unit: nothing to overlap) |

* **A/A** (tip-aa ÷ tip): medians 0.94–1.09; per round 0.79–1.23, widest on the short requests (30–135 ms).
* **Exactness:** every frame of every visit decoded on `av1-webcodecs`, none failed, each frame's samples (XXH3) the
  same in all three arms.
* **Where the host saturates** (`busy.py`, `/proc/stat` over two fills an arm, `busy-rows.jsonl`): at 1× the tip keeps
  2.4–2.8 of 4 cores busy, the branch 2.9–3.6 (`b1` 3.4–3.5, `c1` 3.6): near the host's four, so the 1× fill gain is
  bounded by this host and claims nothing past it. At 4× (each thread capped at a quarter of a core) 1.3–1.5 and 1.6–1.8.
* At 1× a request (one decoder, three cores idle) gains nothing at any offset; the build's own bench found the decode
  and the read slowing each other when overlapped (`docs/decode/README.md` §The read-back's share). What binds is not
  known (*theory*: memory bandwidth, or the copy and the decode on one browser thread).
* **Offset 0 at 4×:** +13 % (`a1`, 82 → 93 ms) and +16 % (`c1`, 104 → 120 ms), −8 % on `b1`; the branch's per-round
  ratios 0.83–1.35 and 0.97–1.25 against A/A spans of 0.79–1.20 and 0.80–1.16. Not decided by 6 rounds. A candidate
  cause, *theory*, not checked: a unit inside a group (the request's keyframe at index 16 is one) waits a task
  (`setTimeout(0)`) before its read, which a throttled thread pays late.

## Verdict

A non-regressor on the fill (faster in all six cells, every median outside the A/A medians) and on requests at offsets
3 and 7 (faster at 4×, unchanged at 1×); offset 0 at 4× not decided, named above. Left for a sync row (amendment 28
rule 1). How it serves the value statement: "a fast full fill" and "low latency on every jump" where the CPU, not the
link, binds; on a link that binds (any profile below the fill's decode rate, `link-profiles.md`) it changes nothing
here, and no wire was in these cells (not measured).

## Fixtures and limits

Three DBT volumes of one dataset (`dbts_a1` cut 56 frames, `dbts_b1` 50, `dbts_c1` cut 69; Q 8, G 8), coded in this
container; one 4-core cloud host, no GPU, headless Chromium, software WebCodecs; 4× is `lab/scripts/cpu_throttle.mjs`
(a quarter core a thread), not a phone; the decode bench, not the product's view (no transport, paint or page-thread
work, so the fill is decode-bound by construction); no wire, relay or link profile; no Firefox, no ultrasound, no phone.
Each limitation found by this row's rig choice, except the 1× saturation (`busy.py`) and the offset-0 spread (the A/A).
