# target-review

Throwaway probes behind the two reviews of [`docs/adr/frame-path.md`](../../docs/adr/frame-path.md) §Target: the view worker.
Their numbers come from a shared container and are indicative only, not claims.

## The red team's probes

Throwaway probes for a red-team review. **Every output below is indicative only, from a shared container, not a claim.**

| probe | run | what it drives |
| --- | --- | --- |
| `want-order.mjs` (+ `harness.mjs`) | `node lab/target-review/want-order.mjs` | today's `downloader.js`, `decode:false`, hand-fed transport: (a) a `fill` in controller order 40,41,39,…; (b) a 76-frame series with even frames already held |
| `want-replaced.mjs` | `node lab/target-review/want-replaced.mjs` | `decode:true`, 2 stand-in decoders × 2: fill 0..9, `cancel`, fill 0..9 again; then `ack` with the old and the new gen |
| `busy-worker.cjs` (+ `busy.html`, `busy-view.js`, `busy-writer.js`, `busy-io.js`) | `node lab/target-review/busy-worker.cjs` | headless Chromium; `show` posted every 16 ms, delay measured in the worker; 17 MB `FileSystemSyncAccessHandle.write`+`flush` every 100 ms in the same worker, in a second worker, or in the same worker plus a 17 MB read-back and a JS `Uint32Array` sum (a stand-in for XXH3, not XXH3); arms interleaved, order reversed on odd rounds, 6 rounds × 3 s |

### Output (this container, 2026-10-28)

```
$ node lab/target-review/want-order.mjs
(a) want order sent: 40,41,39,42,38,43,37,44,36 ...
(a) wire calls: [[0,75]] asks: []
(a) arrival order: 0,1,2,3,4,5 ... frame 40 arrives at position 41 of 76
(b) 38 misses (odd of 76) -> 38 fillFrames calls; first 3: [[1,1],[3,3],[5,5]]
(b) model: each run issued only when the previous run's last frame lands, so each run after the first waits 1 RTT idle (request out, first byte back); server time and transfer ignored.
(b) RTT 46 ms: idle 1702 ms over 38 runs vs 0 ms for one run of the whole series
(b) RTT 92 ms: idle 3404 ms over 38 runs vs 0 ms for one run of the whole series

$ node lab/target-review/want-replaced.mjs
gen 0 decoding: [ [ 0, 2 ], [ 1, 3 ] ]
after cancel + fill 0..9, wire calls: [[0,9],[0,9]]
decode dispatches per index (gens): {"0":[0,1],"1":[0,1],"2":[0,1],"3":[0,1],"4":[1],"5":[1],"6":[1],"7":[1],"8":[1],"9":[1]}
indices dispatched twice: 0,1,2,3
ack(0, gen 0) then fill [0]: wire calls [] (empty = record for 0 still held)
ack(0, gen 1) then fill [0]: wire calls [[0,0]]
cancelled reply: {"kind":"cancelled","gen":1}

$ node lab/target-review/busy-worker.cjs   # two runs; delays in ms; io = writes per round / median ms per write
153.0.8010.12 cores 4
run 1: idle       n=1127 median=0.10 p95=0.30 max=25.20
       same       n=1128 median=3.10 p95=52.70 max=294.40   io ~29w/48-56ms
       split      n=1126 median=0.10 p95=0.20 max=2.30     io ~29w/48-50ms
       same+hash  n=1128 median=51.50 p95=105.70 max=197.60 io ~28w/96-104ms
run 2: idle       n=1128 median=0.10 p95=0.20 max=1.30
       same       n=1128 median=0.30 p95=45.50 max=90.70    io ~29w/46-49ms
       split      n=1128 median=0.10 p95=0.30 max=4.00     io ~29w/47-49ms
       same+hash  n=1127 median=48.50 p95=97.30 max=156.50  io ~29w/96-99ms
```

The `same+hash` arm spends ~97 ms of every 100 ms on I/O and the sum: that worker is saturated, and nothing past it is
claimed. OPFS sync handles worked in headless Chromium here; the write time is this container's disk, not a device's.

## The independent design's probes

Throwaway probes behind the independent design in [`docs/adr/frame-path.md`](../../docs/adr/frame-path.md)
§An independent design (2026-10-28). Each runs in this container's headless engines, so its numbers are
indicative only: a 4-core container with software GL is not a phone. A decisive measurement is one of the
design's protocol items, pre-registered there before any data.

| probe | claim it checks |
| --- | --- |
| `opfs/` | what a file per frame costs through `FileSystemSyncAccessHandle` from a dedicated worker and from a nested one: the two handle calls, a write and a read of one frame, three writers at once, a listing of 1 000 entries, `navigator.storage.estimate()` in a worker |
| `one-worker/` | one dedicated worker holding WebGL2 on a transferred canvas, OPFS sync handles, `requestAnimationFrame` and `WebTransport`; a step from disk (open, read, upload, draw) against a step from memory; frames painted while the page's thread is blocked |

Each folder's `README.md` says what ran, on which engine and version, and how to run it again.
