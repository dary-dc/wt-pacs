# A transferred buffer per frame

**Question:** Does a transferred `ArrayBuffer` per frame free memory that a `SharedArrayBuffer` does not?

*Moved 2026-11-14 from `docs/adr/frame-path.md` at `e5b20cba` (§Experiment 3: a transferred `ArrayBuffer` per frame),
word for word but for queue-row names. A bare §N or §Name is a section of that ADR: [its map](../../adr/frame-path.md)
names the file each now lives in. Choices 1–8 are [the cache's](cache-in-opfs.md#the-choices-and-what-decides-each).
The design these findings shape is [`../design.md`](../design.md).*

## Experiment 3: a transferred `ArrayBuffer` per frame (2026-10-29)

*Rank 3 of the ranked table of experiments beside the target (`claude/vw-experiments`, frame-path.md §Experiments
beside the target): FM's (a′), against the `SharedArrayBuffer` the decoders write today. On this branch the target is
§3's* Built *above, so the experiment sits here. **Pre-registered, built, not run**; the run is a row of its own,
after a methodology review. The smoke below proves the arms run, and gives no number.*

**The claim.** V8 counts a `SharedArrayBuffer` as 0 bytes towards collection, so a frame the store lets go during a
fill is not freed until something else collects (FM's M2 diagnostic: after a 2.03 GiB fill under a 256 MiB window,
2.4 GiB stayed resident until `gc()` ran in the decoder workers); a transferred `ArrayBuffer` is counted at its
length in the view worker, which then collects it. With a window, (a′)
bounds a fill's growth by the window plus the collector's slack: **predicted** 600–800 MiB on Chromium and 650–1 100
on Firefox, against 2.6–3.2 GiB shared on Chromium (FM's M5). Its costs are predicted nil: the copy count is the same
(the decoder's one), and the transfer replaces the handle.

**What this build can test.** The want's store keeps every frame: the view worker passes no budget, and a budget
under a want is not built (§3, *Not built*; a step would want again what it evicted, and `ledger()` would hash only
what is held). With every frame held, both arms hold the whole series, so the claim's cell **W** needs two things
first: the store's window under a want (its own row) and M5's rig
(`claude/opfs-cache-fixes:lab/opfs-cache/run.mjs`, cell `m2`) carried to this build. Cell **T**, the costs, runs now.

**The arms.** One build, one setting, `pixels`, a connect option the lab sets per variant (`client/README.md`): absent,
`shared` (the default); `"transfer"`, each decoder writes the frame into an `ArrayBuffer` and transfers it to the
consumer. Both under `?view=worker`, both cross-origin isolated (dropping isolation is another change), the same
decoders, store and transport. **`shared′`** is `shared` under a second name: the A/A pair.

| cell | rig | sets, links, CPU | measured | arms |
| --- | --- | --- | --- | --- |
| **T** (costs) | `lab/av1/delivery/total-time/run.mjs`, viewer variants `"view": "worker"`, `"pixels"` per arm | `ct_nlst` (512²) and `dbt12_ea1141` (614×1359, the largest frames this rig has); `r50000` clean; 1× and 4×; Chromium and Firefox | fill (issue → every frame on screen), first (issue → first exact frame on screen: the opening frame, asked cold), exactness by the decoder's XXH3 and the rig's SHA-256, each worker's CPU ms | `shared`, `shared′`, `transfer` |
| **W** (the claim) | M5's rig as M5 states it: 80 × 3328×4096 (2.03 GiB) on loopback, a 256 MiB window, the browser tree's PSS each second, growth = peak less the value before the dial | Chromium and Firefox, 1× | growth, fill, exactness | the same three, and each again with every frame held (no window): the control |

**Order and rounds.** Cells, and the arms inside each, in `lab/order.mjs`'s Williams order per round, as the rig does;
a fresh browser profile and server per visit. 12 rounds; a cell VOID at 12 gets two more, then stays VOID.

**VOID**, per cell: in T, the median per-round `shared′`/`shared` fill ratio outside 0.98–1.02 or the median
|`shared′` − `shared`| first over 16.7 ms; in W, the median |`shared′` − `shared`| growth over 64 MiB (M5's bar). A visit
the relay marks VOID is dropped, as the rig does. A VOID cell is reported and rules nothing.

**Saturation guard.** The browser has cores 0–2 and the relay core 3. A T visit whose workers' CPU ms over its fill
exceed 0.9 × 3 cores × the fill's wall time is saturated; a cell with any saturated `shared` visit is reported as
saturated and rules nothing (4× with three decoders is where this is expected). In W a visit stops at 10 GiB of growth
and counts as failed: the container stops near 12 GiB (M2).

**The rule, stated before any data.**

* **T holds** if, in every cell neither VOID nor saturated, the median per-round `transfer`/`shared` fill ratio is ≤ 1.02,
  the median `transfer` − `shared` first is < 16.7 ms, and every frame of every visit of both arms is exact by both
  checks. An inexact frame under `transfer` alone is a defect, not a cost: the experiment stops.
* **W holds** if, on each engine, in every round not VOID, `transfer` completes, every frame is exact, and its growth is
  ≤ 608 MiB (M5's bar: the floor's 537, the A/A's 64, rounded up); and in the control, the median |`transfer` −
  `shared`| growth is ≤ 64 MiB (nothing kept by a clone where a transfer was meant).
* **Adopt** `transfer` as the default only if T and W both hold; FM's (c), the slot ring, is then not built. **Reject**
  it if T fails, whatever W says, naming the regression. If T holds and W has not run, nothing changes and the setting
  stays off. If W fails, (c) stays FM's recommendation, with the numbers. WebKit is not run (no build in the
  container): an adoption says so.

**Built.** `client/decode/frame-buffer.js` allocates a frame (`htj2k.js`, `av1-frame.js`) and names its transfer list;
`decoder.js` sets it from `init` and lists the buffer on the frame's and the preview's messages; the downloader passes
`pixels` to every decoder; the consumer wraps either buffer in its `bytes`. The total-time rig takes `"pixels"` per
variant; `client/viewer/check.mjs` takes `--opts`. Each check was mutated and its mutant failed:

| claim | check | mutant |
| --- | --- | --- |
| by default a frame is a `SharedArrayBuffer` on no transfer list; under `transfer` an `ArrayBuffer` that is its message's whole transfer list, samples and range intact; a later start without the setting is shared again | `client/decode/decoder.test.mjs`: `decoder.js` and `htj2k.js` as built over a stand-in OpenJPH glue | never listed; always shared; the setting never read; the frame's post without the list; the setting never reset |
| `pixels` reaches every decoder the downloader starts | `downloader.test.mjs` *pixelsReachTheDecoders* | `pixels` left out of `init` |
| a frame's `bytes` is a `Uint8Array` over its buffer, shared or transferred | `consumer.test.mjs` *bytesOverEitherBuffer* | the old wrap, shared buffers only |
| the setting reaches a browser's decoders | the viewer check with `--opts '{"pixels":"transfer"}'` | an allocation that throws under `transfer`: 11 failing |

The module's own default (`false`) is an equivalent mutant under `decoder.js`, which sets it at every start; it is
what a codec module used alone (`av1.test.mjs`) gets.

**Smoke, 2026-10-29, one round per arm, no number reported.** The total-time rig on a three-frame set of the
contract's 16-bit grey codestream (`r50000`, 1×, Chromium), variants `shared` and `transfer`: both complete, every
frame exact by both checks. The viewer check under `--view worker --opts '{"pixels":"transfer"}'`, filled with a cine
and on demand: complete, exact and drawn, no pixel reaching the page. Not smoked: Firefox, the 4× throttle, the sets
of cell T (they need `lab/av1/fetch_data.sh` and the AV1 tools), and W, which has no rig on this build.
