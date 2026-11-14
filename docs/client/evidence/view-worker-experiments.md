# Experiments beside the view worker

**Question:** Which changes to the view worker design are worth an experiment, and does spanning small gaps in the
misses pay?

*Moved 2026-11-14 from `docs/adr/frame-path.md` at `e5b20cba` (§Experiments beside the target), word for word but for
queue-row names. A bare §N or §Name is a section of that ADR: [its map](../../adr/frame-path.md) names the file each
now lives in. Choices 1–8 are [the cache's](cache-in-opfs.md#the-choices-and-what-decides-each). The design these
findings shape is [`../design.md`](../design.md).*

## Experiments beside the target (2026-10-29)

*Which changes to the Target are worth an experiment each, ranked by expected gain over cost. Gathered from the
Target's open table, both reviews, [`../ARCHITECTURE.md`](../../ARCHITECTURE.md), the branches cited as in §Review (FM,
ARMS, WC, MAP, VW) and a reading of `client/transport`, `client/decode`, `client/paint` and `VW:client/view/view-worker.js`.
**Nothing here is built or run**; a figure is a measurement cited where it is, or marked a guess. Each experiment
changes one lever against the Target as built on VW, interleaved (`lab/order.mjs`), ≥ 12 rounds, Chromium and
Firefox, every frame checked against the encoder input's `.sha256`, and states its rule before any data.*

**Screened out**, against what is decided or what is already measured:

* *Hashing the decoder's output before the copy into shared memory* (the hasher copies the frame into its own memory
  in 16 KB chunks, `client/decode/xxh3.js:21–25`): the copy would then be painted unchecked. Exactness first.
* *The range folded into the copy*: measured slower, 1.06–1.17× ([`../decode/README.md`](../../decode/README.md) §The
  range pass). *Reading frames whole by default (`readMin`)*, which skips a copy on receive: frame 0 ties
  ([`../cloud-queue.md`](../../cloud-queue.md), RMD4).
* *Merging `done` and the ack, or batching frames per message*: 0.1 ms a message at 1×, 0.4 at 4×
  ([`../ARCHITECTURE.md`](../../ARCHITECTURE.md) §The hand-off), spent in workers nobody waits on.
* *Reusing the paint's textures and its VOI table across frames* (`client/paint/paint-worker.js:104–120`): the whole
  paint is 0.34 ms at 512², and at 12.6 Mpx the upload is 5.70 of 5.74 ms (§Paint). Nothing anyone sees is left to
  remove.
* *Already pre-registered elsewhere, run as written against the view worker*: the values of `D_min`
  ([`client-window-depth.md`](../../adr/client-window-depth.md) T1), the clock (WC), a disk-only store and the slot ring (FM's
  M5), who writes the cache (the cache-I/O arms), the 1-pixel `readPixels` (the Target keeps it behind the lab's flag).

| rank | experiment | metric it moves, and by how much | code | risk to exactness | decided by |
| ---: | --- | --- | --- | --- | --- |
| 1 | span small gaps in the misses (red 5) | a fill from a half-held cache: 1.7 s at 46 ms RTT, 3.4 s at 92 ms of idle round trips removed (the probe's model), against ~1.1 s of transfer for 38 CT frames at 20 Mbit (M1's 29 ms a frame) | `nextRun` takes a gap ≤ g; duplicates dropped before decode: ~20 lines | none: held frames are not decoded again | half-held against empty cache, 46 and 92 ms, 0 and 1 % loss, g ∈ {0, 1, 2, 4, 8} and all-misses-as-asks |
| 2 | the want ascending from `current + 1`, and no ask for a frame the running run delivers within k | forward steps during a fill: about one RTT (46–92 ms) per step that ends the fill today; **a guess** from WIRE §An ask during a fill | the controller's order and one test in the downloader: ~15 lines | none | MAP's sawtooth trace at 25 slices/s, step → screen; k = 1…8 |
| 3 | a transferred `ArrayBuffer` per frame, (a′), not a `SharedArrayBuffer` | peak memory of an 80 × 3328×4096 fill: 600–800 MiB against 2.6–3.2 GiB on Chromium (FM's M5 prediction); no slot table | the decoders' allocation and a transfer list: ~10 lines, against (c)'s ring | a detached buffer reaches no one; a store worker (arm C) needs it transferred back or copied | M5's `transfer` arm, read as the default and (c) as the alternative |
| 4 | the credit count K | the same peak memory against the fill's time; below `decoders × perDecoder` = 6 the decoders starve (**a guess**) | a constant | none | M5 with writes slowed, K ∈ {3, 6, 9, 12} |
| 5 | decoders on a phone, with the view worker's thread added (red 13) | fill time: 3 decoders on 2 cores at 4× were 7 % slower than 2 (5 329 against 4 999 ms, §Resources); one more thread moves the crossover, **a guess** | a setting | none | `resources.mjs` with the view worker, 2 and 4 cores, 1× and 4×, then D5 on a device |
| 6 | one WebGL2 context for every viewport (red 7) | a fifth canvas no longer loses a context; paint time unknown | a scissored canvas or a presentation per canvas: a few hundred lines | a viewport bleeding into its neighbour | contexts lost and paint p95 at 1, 2, 4, 5 viewports, Chromium and WebKit |
| 7 | the decoders write and post only frames near the want (arm D with independent concession 1) | one 17 MB copy a fill frame off the decoder's clock, ~4 ms (the probe's write) of a 47–72 ms decode: ≤ 8 % of a decode-bound fill, **a guess** | the decoder learns the window; the store learns "on disk, not held" | none new: every read is checked (§5) | the cache-I/O arms' W cell with arm D, posting all against posting the window |
| 8 | the AV1 group as the store's unit, previews never posted (red 9, 11) | nothing today: the viewer sets `groupLength` 1 and decodes no scalable payload | the store's eviction by group | a preview stored in a frame's place | deferred until either ships; then decodes per index at G = 8 |

**1 · Span small gaps.** The store sends only misses, and the downloader issues each run after the last one's final
frame lands (`client/transport/downloader.js:290`), so a cache holding every other frame costs a round trip a frame:
the probe counted 38 runs for 76 frames. Asking for g held frames to keep a run whole spends wire bytes, not decodes.
The third arm sends every scattered miss as pipelined asks, which the Target's `D_min` prefix already does for the
want's head. **Rule:** adopt the smallest g whose fill from the half-held cache is ≤ 0.6× of g = 0's in ≥ 9 of 12
rounds at both RTTs, with wire bytes ≤ the empty cache's fill; else keep g = 0. Lossy wireless makes an idle round
trip longer, so the 1 % cells matter most.

**2 · Do not ask across the running fill.** An ask ends the fill the server is reciting, and the fill is re-issued at
the asked frame's head ([`../WIRE.md`](../../WIRE.md) §An ask during a fill): a reader stepping forward into what the
fill delivers next pays a round trip for a frame that was coming anyway. A want that starts at `current + 1` is
ascending, so it rides one run (MAP's G1), and the independent design's rule 3 is its downloader half. **Rule:** k is
the largest step ahead at which waiting is no later than asking in ≥ 9 of 12 rounds; adopt the ordering if the
sawtooth's median step → screen improves by ≥ 16.7 ms with the fill within ×0.98–1.02.

**3 · (a′) by default.** V8 counts a shared buffer as 0 bytes (FM:fp:639–645), so M2's window bounded nothing; a
transferred buffer is charged to its holder and collected. FM recommends the slot ring (c) and names (a′) the
turn-over (FM:fp:730); the ring costs a slot table, a `compareExchange` per frame and its own backpressure. If
`transfer` meets M5's 608 MiB bar the ring is not built, and the page no longer needs cross-origin isolation for its
frames. This ranks above K because it decides what K is protecting.

**4 · K.** The Target dispatches only while fewer than K frames are unacked; ARMS's W cell keeps its feeder 8 ahead
(ARMS:fp:784). Too small starves three decoders of two frames each; too large is M2 again. **Rule:** the smallest K
whose fill is within ×1.02 of K = 12, then check its growth against M5's bar.

**5 · Decoders on a phone.** The count is `min(3, hardwareConcurrency)`, and WebKit reports 4 below 8 cores, so a
phone with two fast cores runs three decoders beside the downloader, the view worker and the page. **Rule:** per core
count, the decoder count with the shortest fill whose cold ask is no later by 16.7 ms; a device setting where the
engine clamps.

**6 · One context.** A four-view mammogram already sits at the 4 contexts a worker gets in Chromium and WebKit. This
is a correctness fix with a cost to measure, not a speed-up. **Rule:** adopt if 5 viewports lose none and the paint
p95 at 4 is within 1 ms of four contexts; the check reads every viewport.

**7 · Decoders write, post the window.** A fill frame nobody looks at then never leaves the decoder but to disk, as in
the independent design, while asked frames ride a transferred buffer (its concession 1). Worth it only where the fill
is decode-bound and frames are large. **Rule:** adopt if the fill improves by ≥ 2 % on the mammogram in ≥ 9 of 12
rounds on both engines and no set is slower.

**8 · Groups and previews.** Both bite only with a payload the viewer does not use today; the experiment waits for
one.

### Experiment 1: span small gaps in the misses (2026-10-29)

*Row 1 of the table above, pre-registered before any data. Built behind a lab setting, default off; **not run**. The
run is a row of its own, after a methodology review.*

**What the want-path build already does, corrected against rank 1.** Rank 1 counts one round trip per one-frame run,
which is the fill fed from the page (`client/transport/downloader.js:290` on `main`, red 5's "today's client"; *corrected
by the review below: this read "VW's … (`downloader.js:290` there)"; at VW's head, `9c90104`, the line is :293*). On
the want-path build a scattered want is not a
chain of runs: a want that does not ascend D_min frames from its head goes out as up to D_min asks in flight, topped up
as each lands (`serveWant`, `client/transport/downloader.js`; *a want arrives in its order*,
`client/transport/downloader.test.mjs`). So on this build the table's g = 0 and *all misses as asks* are one variant,
and the idle time to remove is at most one round trip per D_min misses, not per miss: 38 misses at D_min = 4 are ~10
round trips, 0.4 s at 46 ms and 0.9 s at 92 ms on the probe's model, **a guess**. *Corrected by the review below: asks
topped up as each lands are a sliding window, not waves of four, so an idle round trip recurs only while D_min frames
take less than a round trip to send, t < RTT / (D_min − 1): 15 ms (38 kB at 20 Mbit) at 46 ms, 31 ms (77 kB) at 92.
Neither cell's series is that small, so A's idle time is the first round trip alone. The 38 misses are the probe's
76-frame series, not a cell's (35 for `us_liver`, 14 for `dbt12_ea1141`), and 10 round trips at 46 ms are 0.46 s.*
Against that, a span re-sends every
held frame it crosses: on a store holding every other frame the wire carries the whole series, twice the misses'
bytes. Where four frames in flight already fill a round trip — at 20 Mbit, rank 1's 29 ms a frame is 116 ms per four,
against 46 or 92 — the asks keep the link busy and the span is predicted **slower**, towards 2×. *Corrected by the
review below: 29 ms is M1's 512² frame (7.49 s / 256, the cache-I/O arms), not a cell's; `us_liver` is 257 kB a frame (18.02 MB /
70, [`../../lab/av1/README.md`](../../../lab/av1/README.md) §SIZE) and `dbt12_ea1141` 499 kB
([`disk-access.md`](../../adr/disk-access.md)), 103 and 200 ms at 20 Mbit, 412 and 798 ms per four. The direction holds and
sharpens: S at 1.90–1.96× A in every cell.* That prediction is
the model's; the run decides.

**The change.** `span: g` in the downloader's config, from the viewer's `?opts=`, default 0 (today's behaviour): a run
from the want's head, and a fill's next run, may cross up to g frames the consumer holds — neither in the want nor
with a record in the downloader — and counts only its misses toward D_min. A crossed frame arrives with no record and
is dropped before any decoder (`runEnd`). A frame still wanted later in the order, or here and unacknowledged, ends
the run.

**Claim.** On a store holding every other frame, `span: 1` makes the misses one fill, ≥ 40 % shorter than their asks.

**Variants**, the same build and `opts` but `span`: **A** `span: 0`; **A′** `span: 0` again, the A/A pair; **S**
`span: 1`. Every gap on that store is one frame, so g = 2, 4 and 8 would send S's wire schedule exactly; the table's
sweep over g needs a held pattern with wider gaps and runs only if S passes.

**Cells.** `lab/av1/delivery/total-time/run.mjs`, the viewer under `?view=worker`, HTJ2K; `us_liver` (70 × 760×421
RGB 8-bit) and `dbt12_ea1141` (29 × 614×1359 12-bit); link `r20000` at `--one-way-ms` 23 and 46 (RTT 46 and 92),
impairments `clean` and `l1`; Chromium and Firefox; CPU 1×. Two store states:

* **half-held** — `opts.holdEveryOther` makes the view worker want the even frames first, in descending order so A and
  S ask them alike, then want the rest and time the fill from that want (`fillAround`, `client/view/view-worker.js`);
* **empty** — today's start.

**Metrics.**

* moved: the half-held fill, the controller's `fillMs` from the want of the rest to the last frame held;
* must not regress: the empty fill, which has no gap to cross, so S is A there by construction and the cell checks it;
  the first exact frame on screen; on-demand latency, `?fill=0` with ten steps across the series, step → frame held,
  which S cannot move since a want of one frame is never a run; exactness, every frame's digest against the encoder
  input's `.sha256`, each decoded once, none failed; *corrected by the review below: the rig's on-demand cell,
  `--fill 0 --asks-after 10`, shows frame 0 and steps to frames 1 … 10, not across the series; on demand a step is an
  ask (`askFor`), which never reaches `runEnd`, so this cell is a tie by construction;*
* recorded: frames on the wire (the session's `mediaReads` at the last frame) and the decoders' CPU the rig reads.
  *Corrected by the review below: `mediaReads` counts reads of the media streams, one per chunk, not frames
  (`client/contract/clauses.ts:615`), and at the last frame it includes the held frames' reads; the rig records it and
  `fillReads`, the reads from the last held frame on; the wire is the relay's `s2c` packet count.*

**Interleaving and rounds.** `lab/order.mjs`: the variants in a Williams order inside each cell, the cells in one each
round; 12 rounds. The RTT is a process argument, so even rounds run 23 then 46 and odd rounds 46 then 23. A visit the
relay marks `VOID` is dropped and its cell topped up in rounds 13 on, to n = 12.

**A/A.** Per cell, A′'s median moved metric within ×0.95–1.05 of A's; a cell outside it claims nothing.

**Saturation guard.** The host: the relay on a core of its own (`--rig-core`), the browser on the other three, 1×
only, `VOID` visits dropped. ~~The link: where A's half-held goodput, misses' bytes over its fill, is ≥ 0.9 of 20 Mbit,
the asks already fill the link; the cell is reported saturated and claims nothing for or against S.~~ *Retracted by the
review below: the link is the cell's condition, not the rig's limit. A full link is how S loses, and on the model A's
goodput is 0.97–0.99 of the link in every cell, so this guard would have voided every half-held cell and the run with
it. A cell's link-bound share is recorded, not excluded.* The decoders: where
A's decoder CPU is ≥ 0.9 of three decoders over the fill, the cell is decode-bound, treated alike.

**Rule, stated before any data.** Adopt `span: 1` as the default if, in every unsaturated half-held cell, S's fill is
≤ 0.6× A's in ≥ 9 of 12 rounds, at both RTTs and on both engines, with frames on the wire no more than the empty fill's
(the series once); and S's empty fill is within ×0.98–1.02 of A's, its first frame and its on-demand median no later
by 16.7 ms, every frame exact and decoded once. Otherwise `span` stays 0 and the setting is removed, this subsection
kept as the record. If every half-held cell is saturated, the experiment says so and claims nothing. *Corrected by the
review below: "every unsaturated cell" is true of no cell, so as written the rule adopted S if every cell saturated, and
the last sentence contradicted it; adoption needs at least one cell the host did not saturate, and every such cell to
pass. The wire bound decides nothing on this store: measured at the last frame it fails S by construction, since the
held frames' reads are in it; measured from the last held frame (`fillReads`) it passes S by construction, since S's run is
frames 1 … n − 1. It bites only on a held pattern with wider gaps.*

**What the run row adds to the rig first**, reviewed with this protocol, not built here: a variant field carrying
`span` and `holdEveryOther` into `opts`; the levers' result carrying the controller's `fillMs` and the session's
`mediaReads`; an on-demand cell for a viewer variant, if `--asks-after` does not drive one. *Built by the review below.*

**Built and checked.** *A span crosses held frames* (`client/transport/downloader.test.mjs`): span 0 asks; span 1 is
one run and only the misses reach the consumer, once each; a gap of 2 ends it; a frame wanted later, or here and
unacknowledged, is not crossed. Each mutant fails it: the span ignored, the gap bound one wider, either half of the
guard dropped, the fill's next run unspanned, D_min off by one. The smoke, one round per variant, Chromium on
localhost, a 76-frame series through `client/viewer/check.mjs --view worker --opts '{"holdEveryOther":true,"span":g}'`:
A, A′ and S each held all 76 frames exact and drawn,
and a probe, since removed, saw S send frames 1–75 as one run and A send none. No number is reported from it.

### Experiment 1: independent review (2026-10-29)

*A methodology review before any run, by a session that wrote none of the protocol. Corrections are made in place
above, the old text kept or struck. Nothing here is a result: the smoke and the gate below ran in a shared 4-core
container.*

**Sources.** Experiment 1 and rank 1 cite no file of [`frame-path-sources.txt`](sources.txt), so there is no
pinned source to re-fetch. Every citation they do make is in-repo or `branch:path:line`, and each was read:

| claim | where | verdict |
| --- | --- | --- |
| a run is issued when the last one's final frame lands | `client/transport/downloader.js:290` on `main` | holds; VW's head has it at :293 (corrected) |
| 38 runs for 76 frames; 1.7 and 3.4 s idle | [`../../lab/target-review/README.md`](https://github.com/dary-dc/wt-pacs/tree/7f335cc0c80100017ccb3800c40a871c9fabc3f6/lab/target-review/README.md), `want-order.mjs` (b) | holds: 1702 = 37 × 46 ms, the first run not idle |
| M1's 29 ms a frame | the cache-I/O arms' M1, F 7.49 s for 256 × 512² over 20 Mbit | holds as 7.49 s / 256; a 512² frame, not a cell's (corrected) |
| a scattered want is up to D_min asks, topped up as each lands | `serveWant`, called from `arrived` on each frame's last byte | holds |
| *a want arrives in its order* | `client/transport/downloader.test.mjs:425` | holds |
| a run crosses ≤ g held frames, counts misses alone toward D_min; a frame wanted later or unacknowledged ends it | `runEnd`, `serveWant`, `nextRun` | holds; the PR's six mutants re-run, each fails the test (the span ignored by a throw before its check) |
| g = 2, 4, 8 send S's schedule on this store; the empty fill is A's under S | `runEnd` traced on alternating and contiguous wants | holds |
| on demand S cannot move a step | a step is `askFor`, which never calls `runEnd` | holds, by construction (corrected: the cell is a tie, not a check) |
| `us_liver` 70 × 760×421 RGB 8-bit; `dbt12_ea1141` 29 × 614×1359 12-bit | `lab/av1/fetch_data.sh` against `data.json`'s SHA-256s, re-fetched | holds |
| `mediaReads` is frames on the wire | `client/contract/clauses.ts:615`: reads of the media streams, one per chunk | wrong (corrected) |

**The model, recomputed per cell.** t is a frame's bytes over 20 Mbit; m the misses; r the frames S's run carries,
from frame 1 to the last odd frame; D_min = 4. A, D_min asks topped up on each arrival, is RTT + m · max(t, (RTT + t) /
D_min); S is RTT + r · t. Loss and decode are left out: `us_liver` decodes in 7.9 ms at 1× (SPEED), on three decoders,
against 103 ms on the wire.

| series | t | m | r | A at 46 · 92 ms | S at 46 · 92 ms | S / A | A's goodput |
| --- | ---: | ---: | ---: | --- | --- | ---: | --- |
| `us_liver`, 257 kB | 103 ms | 35 | 69 | 3.65 · 3.70 s | 7.15 · 7.20 s | 1.95–1.96 | 0.975–0.987 |
| `dbt12_ea1141`, 499 kB | 200 ms | 14 | 27 | 2.84 · 2.89 s | 5.44 · 5.48 s | 1.90–1.91 | 0.968–0.984 |

On a link-bound cell S's half-held fill is about the empty fill (r ≈ n), so under S a half-held cache saves nothing
and under A it saves half. The span is ≤ 0.6× A only where 2t ≤ 0.6 (RTT + t) / D_min, t ≤ 0.6 RTT / (2 D_min − 0.6):
3.7 ms at 46 ms and 7.5 ms at 92, frames of 9.3 and 18.6 kB at 20 Mbit. No series in [`../FIXTURES.md`](../../FIXTURES.md)
is that small: `pt15_cptac`, 31 kB a frame, gives S / A 1.68 at 46 ms and 0.95 at 92. A at 1 % loss is not modelled; loss
lengthens both, and puts S's run on one stream against A's four, which is no reason to expect the sign to turn.

**The protocol against the measurement rules.**

* *Interleaving.* `holdEveryOther` is an `opts` setting, so in `run.mjs` a store state is a variant, not a cell: six
  units (A, A′, S × half-held, empty) in a Williams order per cell, a period of six rounds, 12 rounds two periods —
  balanced. The RTT alternates by process each round; it is never a compared lever, so that holds.
* *A/A and VOID.* A′/A within ×0.95–1.05 on the medians, visits the relay's `--self-timing` marks `VOID` dropped and
  topped up: as the PR wrote them.
* *Saturation.* The host and decoder guards hold. The link guard is retracted above: it would have voided every
  half-held cell on the model.
* *A rule fixed before data.* Yes, with two faults corrected above: vacuous adoption when every cell is excluded, and a
  wire bound that, on this store, passes or fails S by construction.
* *Can the rule be met?* Not on the model in any cell: it needs S at ≤ 0.6× where S is predicted at 1.90–1.96×. It
  can fail, so it is a test, but one whose outcome the model gives with a threefold margin.

**Worth running? Not as pre-registered.** 2 series × 2 RTTs × 2 impairments × 2 engines are 16 cells; six variants
over 12 rounds make 1 152 visits, each a 3–7 s fill plus a browser's start, to confirm a prediction with a threefold
margin. Its decision, `span` 0 and the setting removed, is the one the model gives already. The want path's D_min
asks took red 5's gain; what is left of it, the first round trip, is D_min's to win
([`client-window-depth.md`](../../adr/client-window-depth.md) T1), not a span's. The review's recommendation: remove `span` and
`holdEveryOther`, this subsection the record. If the owner wants the model's sign checked first, the cheapest cell is
one: `us_liver`, `r20000`, 46 ms, clean, Chromium, A and S half-held, 3 rounds. S / A in 1.7–2.1 keeps the model; S / A
≤ 1.2 would retract it, and with it this recommendation. The rig below runs that cell.

**The rig, built** (`lab/av1/delivery/total-time/run.mjs`, `lab/viewer/levers.js`, `client/viewer/viewer.js`,
`client/view/controller.js`):

* a variant's `"opts"` in `variants.json` is merged last into connect's, so `{"span": 1, "holdEveryOther": true}`
  reaches the downloader and the view worker; a store state is a variant;
* the levers' result carries the controller's `fillMs`, the session's `mediaReads` at the last frame and `fillReads`
  from the last held frame on, and a row records all three;
* a viewer variant runs on demand with `--fill 0 --asks-after K`: frame 0 shown, then frames 1 … K stepped to one at a
  time, each timed from its step to its frame held (the ledger's arrival), in the row's `afterMs`. Any other
  `--fill` for a viewer is refused.

`lab/viewer/levers.test.mjs` (gated) catches 8 of 8 mutants: `fillMs` dropped, the fill's reads not from the last held
frame, the held frames taken as the odd ones, reads at the first frame, steps from 0, steps timed from the fill's
issue, steps taken in a fill, fill frames reported on demand. The controller's new ledger test catches both of its:
`fillMs` and `mediaReads` left out.

**The smoke, one round, Chromium, `r20000` at 23 ms one way, clean, 1×** — no number from it is a result. The set is a
synthetic 76 frames, the gate's `grey-16` codestream (38 kB) repeated, since no HTJ2K encoder could be built in the
container; its truth is the vendored decoder's SHA-256. The six variants each held 76 of 76 frames exact, the decoder's
check `true` on every one, with `fillMs` in each row. That the span arrived through `opts` shows on the relay: S
half-held put about half a series more packets on the wire than A, the 37 frames it crossed; with the `opts` merge
removed, S half-held sent an empty fill's packets — the mutant caught. On demand, A, A′ and S each took 10 steps, each
timed, 10 of 10 exact, none failed.

**`mediaReads` is not a wire measure.** In the smoke A's half-held fill, 38 asked frames, read about as often as an
empty fill of 76, while the relay counted half the packets: a frame on its own stream is read in more, smaller pieces
than a frame in a run. The wire is the relay's `s2c` count, already in every row; the run reports it, and `fillReads`
only beside it.

**The gate's "1 workers outlived their closed clients", reproduced, and not this experiment's.** The gate's four browser
rigs (`client/contract/run_browser.sh`) were repeated as the gate runs them, two pages at a time, in this container. On
this branch, 1 of 15 runs failed the check unloaded and 3 of 15 with four busy loops on the cores. Each time it was the
`dispatch` page, and the worker left was a downloader whose client had called `close()`, so terminating it had not ended
it. A scratch copy of `drive_page.cjs`, not committed, tagged each worker with the clause that made it. It named
*a decoder that fails its init leaves the pool* on this branch. On the pre-span parent, `ede1cff`, 1 of 20 loaded runs
leaked, from *a cancel releases the group a decoder held*. The first clause run alone leaked 0 of 100, loaded, on both
trees. So the leak predates `span`, which the dispatch rig leaves at 0. It is not one clause's either: it needs the
rig's run before it, or the page beside it. 3 of 15 against 1 of 20 is no measured difference. This is the stranding
race of [`../ARCHITECTURE.md`](../../ARCHITECTURE.md) §Closing a client, with the decoders left alone. Not fixed here.

### Experiment 1: not run (2026-10-30)

*The run's session (`claude/core-exp1`), on the core with the review above merged. No visit was made; there are no rows.*

The run was to go ahead only if the review left a rule that could be met and advised the run. It does neither. On
the model the rule cannot be met in any cell, S at 1.90–1.96× A against the rule's ≤ 0.6×, and its verdict is *not
worth running as pre-registered*. So the 12-round protocol was not started. **Verdict: not run; `span` stays 0.** The
review's recommendation, to remove `span` and `holdEveryOther`, is a removal from the core and the owner's to take. So
is its one-cell check of the model's sign (`us_liver`, `r20000`, 46 ms, clean, Chromium, A and S half-held, 3 rounds).
Neither is done here. Until then both settings stay in the core at their defaults, which are today's behaviour.
