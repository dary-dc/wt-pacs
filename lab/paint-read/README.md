# Does a settle wait for the busy page

The probe for [`../../docs/adr/frame-path.md`](../../docs/adr/frame-path.md) §7, *The pixel read under a busy page*:
a worker draws on an OffscreenCanvas's WebGL2 context every 20 ms and settles each draw by a pixel read, a fence, a
finish or nothing, on a quiet page or under §7's busy load (`../frame-clock/busy.js`). The protocol, its rule and every
number live in the ADR.

```bash
node lab/paint-read/measure.test.mjs                                        # the scoring
node lab/paint-read/run.mjs                                                 # Chromium, 12 rounds × 10 visits of 10 s
FIREFOX_PATH=… xvfb-run -a node lab/paint-read/run.mjs --browser firefox    # Firefox headed, over Marionette
node lab/paint-read/run.mjs --summary lab/paint-read/rows/firefox.jsonl     # the verdict from rows
```

| file | does |
| --- | --- |
| `probe.js` | the worker: the context, the draw, the five settles, each call timed |
| `page.js` | one visit: the busy load if asked, the probe for `seconds`, the tasks' spans |
| `measure.js` | a visit's in-task calls, a cell's guards and verdict |
| `run.mjs` | the visits in `lab/order.mjs`'s order; a row a visit to `rows/<engine>.jsonl`, each call `[start, ms]` from the visit's t₀ |
