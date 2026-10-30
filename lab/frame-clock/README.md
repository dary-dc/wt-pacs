# Which clock cine runs on in the view worker

The harness for the pre-registered protocol in
[`../../docs/adr/frame-path.md`](../../docs/adr/frame-path.md) §A frame clock in the view worker: seven cine clocks,
each in the real view worker (`client/view/view-worker.js`) with its frames already held, on a quiet or a busy page.
The protocol, its rule and every claim live in the ADR; this file says how to run it and how it scores.
**Built and smoke-run, not run as a protocol: no number from here is a result.**

```bash
node lab/frame-clock/check.mjs                             # each arm wired end to end, a second each, nothing timed
node lab/frame-clock/run.mjs                               # Chromium: 16 cells × 14 rounds × 7 arms, ~10 h
xvfb-run -a node lab/frame-clock/run.mjs --browser firefox # Firefox runs headed: headless has no WebGL2 in a worker
node lab/frame-clock/run.mjs --rounds 1 --cells s512/30/busy/1,s512/60/busy/4   # a smoke round
node lab/frame-clock/run.mjs --summary lab/frame-clock/runs/<file>.jsonl          # verdicts from a run's rows
```

A 4× cell slows every thread of the browser with `lab/scripts/cpu_throttle.mjs`, which needs a writable
`/sys/fs/cgroup/cpu` (v1) or a delegated v2 scope; the run prints the lever's `--check` first. Each run's row goes to
`runs/` (gitignored), without the draw log.

## The arms

| arm | ticks from | in |
| --- | --- | --- |
| `page-raf`, `page-raf′` | the page's `requestAnimationFrame`, each posted to the worker; the A/A pair | `arms.js` |
| `page-interval` | a page `setInterval` at the frame period, as the product's cine | `arms.js` |
| `worker-raf` | the view worker's own `requestAnimationFrame` | `client/view/clock.js` |
| `worker-timeout` | a worker `setTimeout` set for the next frame's due time | `client/view/clock.js` |
| `worker-channel` | a worker `MessageChannel` posting to itself, ticking once a frame is due | `client/view/clock.js` |
| `worker-wait` | `Atomics.wait` in slices of at most one period, yielding to the worker's event loop between them | `client/view/clock.js` |

Every arm shows, on each tick, **the frame due at the tick's time**, `floor((tick − t0) / T)`, once; a tick late by a
long task skips the frames it missed rather than showing them late one by one. The page starts the arm by sending the
view worker `play` (`client/view/view.js`); the page's arms then post `tick`s. The worker paints through the
controller, so each frame is uploaded on its tick, as the paint worker does today. `client/view/check.js`'s `hold`
makes the series' frames in the view worker before the clock starts: no network, no decode.

## Phase

A second worker (`phase.js`) runs a `requestAnimationFrame` that paints nothing and logs its times: the display's
vsync phase, in Chromium and Gecko, for every arm alike. Frame 0 is due **half a display interval before a vsync**,
projected from that log, so every due time sits mid-interval: a random phase would decide by itself whether a
vsync-locked clock is late (in the first smoke round the A/A pair differed by tens of points for that alone), and a display a
hair off 60 Hz drifts a vsync across a due time that sits on one. In WebKit the worker's rAF is a 15 ms timer, not a
vsync (ADR, row (a)), so the log there is no phase and must be dropped.

## Scoring

`measure.js`, from the draw log (`{ i, tick, vsync, start, end }` a paint) and the vsync log:

* frame *i* is due at t₀ + *i*·T; it is **on its tick** if a paint of it **ends** in [due, due + T) and no later
  paint ends before the first vsync after it (that vsync would have shown the later one). With no vsync log, a paint
  followed within one display interval is counted superseded: an upper bound on late frames.
* **late**: frames due in the run minus frames on their tick, as a percentage of frames due.
* **gap p99**: between the vsyncs that would show successive frames on their tick.
* **draw p99**: of each paint's end − start; the paint waits for the draw to execute
  (`client/paint/paint-worker.js`).

Per cell: a busy run whose shortest long task was under 200 ms is dropped as void; the cell is **VOID** when the
median over rounds of |`page-raf` − `page-raf′`| exceeds 2 points of late frames or reaches 16.7 ms in gap p99;
**saturated** when the median over rounds of `page-raf`'s draw p99 exceeds T/2. In a busy cell a worker arm passes with
≥ 20 points fewer late frames than `page-raf` in ≥ 11 of 14 rounds and a median gap p99 ≤ 2T; in a quiet cell, with a
median per-round difference from `page-raf` no worse than the A/A pair's, in late frames and in gap p99.

## The rule

`rule()` takes the 512² cells neither VOID nor saturated and returns `worker-raf` if it passes in all of them, else the
first fallback that does, by fewest late frames in the busy cells, else `page` (the owner decides). A 2560×3328 cell
neither VOID nor saturated in which the chosen clock fails is reported as reversing it.

## What a container can and cannot show

A container has no display and no GPU: Chromium paints on SwiftShader with a headless, synthetic BeginFrame source, and
Firefox on llvmpipe under Xvfb's vsync. The ADR's protocol section names the cells this leaves unclaimable.
