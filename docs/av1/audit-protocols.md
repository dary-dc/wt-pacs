# Three protocols for the audits' findings on optimal quality, pre-registered

*Row AV1-CORRECT, written 2026-11-11 before anything in it ran. Theory and protocol only: nothing was encoded,
decoded or timed for it. Every number in it is quoted from a committed row or an audit (named at each use), or is
labelled *derived* (arithmetic here on quoted numbers) or *assumption*. A different session runs it (queue row
MEASURE-1), changes nothing above its "measured" sections, and reports every cell, including those that miss. An
amendment is written and pushed before the run it changes.*

The audits each name three findings that matter most for optimal quality (OQ):
`claude/av1-audit-quality:docs/av1/audit-quality.md` §The three (QA F4; F1; F2 with F3) and
`claude/av1-audit-decode:docs/av1/audit-decode.md` §The three (DA 1; 2 with 13; the HTJ2K unit). Three protocols
cover all six:

| protocol | findings | asks | encodes | browser |
| --- | --- | --- | --- | --- |
| **A · Noise kept** | QA F4 | how much of the source's fine-band noise the OQ view keeps at the rule's Q | shares B's cells | no |
| **B · One bar** | QA F1, F2, F6, F9 | how finely e_N ÷ σ resolves a rung, and the noise anchor and G at integer Q within that resolution | 19 volumes, integer Q | no |
| **C · Decode on one unit** | DA 1, 2, 13, the HTJ2K unit | what the OQ view and the exact frame cost to decode, on the product's own HTJ2K path, on a core-capped host | none | yes |

QA F3 (alt-ref at equal quality on the noise measure) is already pre-registered and half run:
`claude/av1-groups-settings:docs/av1/groups.md` §Settings amendment, whose shard S1 (`dbts_b1`) found no lookahead arm
cheaper than O G 1 at the noise anchor, and whose shard S2 (`dbts_a1`, `dbts_c1`, cut form) is owed. Nothing here
repeats it. Protocol B's G 16 arms cover the other 16 DBT volumes at lag 0 only.

**Fixtures, for all three.** 19 DBT volumes, all from the one EA1141 dataset (systems A, B, C, five each, and content
2's `dbt12_c`, `dbt12_ea1141`, `dbt10_d`, `dbt10_ea1141`), fetched by `lab/av1/fetch_data.sh` and checked against
`lab/av1/data.json`; three of them (`dbts_a1`, `dbts_b1`, `dbts_c1`) timed. There is no second dataset or vendor, no
lossless breast ultrasound cine and no ABUS. Hosts are 4-core cloud hosts without a GPU. Nothing here speaks for
another scanner, for ultrasound, or for a phone.

**Terms.** As `claude/av1-quality-metrics:lab/av1/metrics/README.md` §Terms and `claude/av1-groups:docs/av1/groups.md`
§Terms.
* **σ**: a frame's noise by Immerkær's estimator, `quality.sigma`: √(π/2) · mean |Laplacian| ÷ 6 over in-window
  samples without the steepest 10 % by Sobel gradient, less 1/12.
* **e_N**: the coding error's RMS in the same Laplacian band, `quality.noise_band`, over every in-window sample.
* **x**: the AC step over σ_min (noise point §Terms).
* **ν**: σ of the decoded frame by the same estimator, over the source frame's in-window samples, divided by σ, with
  its median over frames (groups §S6's `sigma_out`).
* **The rule's Q**: the noise rule's candidate (noise point §4, x\* 4.9293 at G 1 and 4.6359 at G > 1).
* **Bar**: the worst-frame e_N ÷ σ an anchor must stay under, 1.00 or 1.03.
* **δ**: protocol B's resolution of the worst frame's e_N ÷ σ.

## Shared cells (protocols A and B)

**Arm.** O of `lab/av1/groups/arms.py` at the state of `claude/av1-groups-settings` (`0e0e58c8`):
`--lag-in-frames=0 --auto-alt-ref=0`, q pinned (`--min-q=Q --max-q=Q --cq-level=Q`), `--deltaq-mode=0
--aq-mode=0`, `--cpu-used=6`, one thread, libaom 3.15.1 as `ingest/tools.sh` pins it. Stored form, at each volume's
own depth. Decoded by native dav1d 1.5.4.

**Cells.**
* 12-bit volumes (A, C, `dbt12_c`, `dbt12_ea1141`; 12 volumes): Q 4–12, every integer.
* 10-bit volumes (B, `dbt10_d`, `dbt10_ea1141`; 7 volumes): Q 6–16, every integer.
* Both at G 1, and at G 16 except on the three timed volumes, which groups §S4 covers. That is
  12 × 9 + 7 × 11 = 185 cells at G 1 and 185 − 9 − 9 − 11 = 156 at G 16. These ladders bracket every anchor of QA F1's
  table at both bars. If a volume's worst frame is not bracketed, one rung outward is added and listed; that is the
  only extension allowed.
* Every series is read whole, as the quality study read it.

**Per cell:** the groups `measure()` unchanged (e_N per frame, PSNR in-window, the displayed-level moves), `sigma_out`
(ν), bytes as the sum of IVF payloads. JOD is off (`vdp=False`): it does not decide anything here, and it was the
quality study's largest cost.

**Code.** One function `audit_cells(name)` in `claude/av1-groups-settings:lab/av1/groups/plan.py` beside `settings_cells`, and a flag `--audit`
in `cell.py` beside `--settings`. `MPX` and `FRAME_MPX` gain the 16 new volumes from `lab/av1/data.json`.

**Check, before the run.** O G 1 at Q 4, 8, 12 (and 16 on 10-bit) must reproduce the quality study's bytes per
cell exactly (`claude/av1-quality-metrics:lab/av1/metrics/rows/shard-{1,2,3,4}.jsonl`), as groups shard 1 did. A
mismatch stops the run. **Mutation:** the check fed `--cpu-used=5` must fail.

**Order and cost.** Volumes are interleaved by system (A, B, C, content 2, repeat), with G 1 before G 16 and the three
timed volumes first. Cost estimate (*derived*): the noise point's held-out run took 5 117 encode CPU s for 53 cells
over five series of 867 Mpx in all (noise point §Method card, §8), about 0.56 CPU s a megapixel-frame coded at lag 0.
The 341 cells at about 200 Mpx a series on average (*assumption*) come to about 38 000 encode CPU s, so 3–4 h on 4 cores
with the measures. Memory is left to `cell.py`'s scheduler (`--memory-gb`). If time runs out, cut G 16 first, then
the content-2 volumes. Name each cut.

## A · Noise kept (QA F4)

**Asked.** e_N ≤ σ is passed by a coding that deletes the fine-band noise outright (QA F4). How much of the noise
does the OQ view keep at the rule's Q, on every DBT volume? And at what Q and bytes would it keep at least half?

**Theory.**
1. Model a decoded frame in the band as y = s + (1 − k) n + q. Here s is the signal (about 0 in the finest band away
   from edges), n is the source's noise with power σ², k is the share of n the coding removed, and q is the
   quantizer's added error, uncorrelated with n, with power r²σ². Then (e_N ÷ σ)² = k² + r² and ν² = (1 − k)² + r².
   Solving gives k = (1 + (e_N ÷ σ)² − ν²) ÷ 2 (*derived*; it assumes Gaussian n, uncorrelated q, and σ and e_N on
   the same samples, which they are not: σ drops the steepest 10 %).
2. Read on the one volume where both are measured (groups §Settings shard 1, `dbts_b1` slices 9–40, O G 1):
   * at the noise anchor, e_N ÷ σ = 1.00 and ν₁ 0.218 give k ≈ 0.98 and r ≈ 0.22;
   * at Q 8, worst frame 0.81–0.82 and ν 0.594–0.631 give k ≈ 0.6–0.65 (*derived*, mixing a worst frame with a
     median, so a rough figure).
   So at the anchor the "error" is almost entirely the deleted noise, as QA F4 argued.
3. The noise point's derivation (§2) says e_N ÷ σ depends only on x for white noise in the band. The same argument
   applies to ν: a deadzone quantizer zeroes transform coefficients below about one step, and white noise's
   coefficients have σ in every basis. So ν should fall on one curve of x across systems. Since the rule puts every
   series just under x\* ≈ 4.8, ν at the rule's Q should be about the same everywhere (*derived*).

**Predictions** (bands are *assumptions*, set from theory point 2):
* **A1.** ν falls monotonically with Q on every volume at G 1. *Refuted* by any volume with ν rising by more than
  0.02 between adjacent integer rungs.
* **A2.** At the rule's Q at G 1, ν is in 0.15–0.45 on every DBT volume: the OQ view keeps under half the fine-band
  noise's amplitude, and so under a quarter of its power. *Refuted* by any volume outside the band. If it is above,
  the view keeps more noise than the criterion's critique assumed.
* **A3.** ν against x collapses onto one curve: at equal x (binned 0.25 wide), ν's spread across systems is ≤ 0.08.
  *Refuted* by a wider spread in any bin with ≥ 3 systems.
* **A4.** At the highest integer Q with median-frame ν ≥ 0.5 (call it Q_ν), bytes are 1.3–3× the rule's Q bytes
  (*assumption*: one to two integer rungs below, near the cliff).

**Decision rule.** This decides wording and an owner's option, not a Q:
* If A2 holds, the line's description of the OQ view changes. "Keeps part of the noise" (`claude/av1-quality-metrics:lab/av1/metrics/README.md`
  §Quality metrics, measured) becomes "keeps ν of the fine-band noise", with the measured range, in
  `docs/lines/codecs.md` and `docs/lines/optimal-quality.md`. "Also for diagnosis" is then marked as resting on a
  view that removes most of the finest noise, until a reader test (quality study §6) runs.
* Q_ν and its bytes per volume are reported as the option "keep at least half", for the owner's decision 1 or 9 in
  `claude/docs-lines-3:docs/lines/codecs.md` §Open 0.
* If A2 is refuted, the bar's critique (QA F4) is corrected in place with the measured ν.

**What it cannot settle.** Whether removing that noise is visible, or costs a diagnosis. That takes the flicker test
or the noise-ratio branch's model observer (`claude/av1-noise-ratio:docs/av1/noise-ratio.md` §5). It does not settle
the cut form either: the cut's rounding adds RMS 1.15 against σ ≥ 10 on A and C (groups §S4, *derived*), about 1 %
of the power. Groups §S2 reads ν in the cut form on `dbts_a1` and `dbts_c1`.

## B · One bar, at the estimator's resolution (QA F1, F2, F6, F9)

**Asked.** The noise anchor's rung, and with it 2–3× in bytes, turns on worst-frame differences of 0.001 against an
estimator error quoted as 3 % (QA F1). The line uses two bars, 1.00 and 1.03. How finely does the worst frame's
e_N ÷ σ actually resolve? Within that resolution, where are each volume's anchor and its G 16 bytes?

**Theory.**
1. **Random error.** σ is √(π/2) times a mean of |Laplacian| over N in-window samples. For Gaussian noise,
   Var|z| ÷ (E|z|)² = π/2 − 1 ≈ 0.571, so σ's relative standard error is about √(0.571 ÷ N_eff). The 3 × 3
   Laplacian correlates neighbours, so N_eff ≈ N ÷ 9 (*assumption*). On `dbts_a1`, with about 10⁶ in-window samples a
   frame, that is about 0.2 % (*derived*), and e_N's is similar. So the random part of "3 %" is a few tenths of a per
   cent.
2. **Bias.** The "3 %" of the quality study §4.4 was measured on integer frames of known σ with synthetic scenes.
   On real DBT frames, the noise rises with the signal (r 0.58–0.90 by tile, noise point §P4). σ also drops the
   steepest 10 % by gradient, and e_N does not. So e_N ÷ σ carries a bias that depends on content. A frame with its
   noise deleted reads e_N ÷ σ 1.02–1.09 on the plateau (QA F4), which bounds that bias at a few per cent from above.
   Injecting a known noise measures it.
3. **Resolution.** δ = max(2 · s_split, |b|), where s_split is the worst frame's split-half standard error (B1) and b
   is the injected-noise bias (B2). A rung whose worst frame lies in [1 − δ, 1 + δ] is *unresolved*.

**Stages.**
* **B0, zero encodes** (committed rows: the quality study's `shard-{1,2,3,4}.jsonl`, the noise point's held-out rows).
  1. Reproduce QA F1's table: anchors at 1.00 and 1.03, G 1 and G 16, 19 volumes.
  2. Recompute x\* once over the G 1 and G 16 frames together, and separately per stream depth (10-bit, 12-bit), with
     the held-out frames in (QA F6, F9).
  3. Recompute every (series, G) cell's rule Q under each x\*.
* **B1, split-half.** On every frame of the shared cells, split the in-window samples by a checkerboard of 64 × 64
  tiles. Compute σ and e_N on each half and record both halves' e_N ÷ σ. s_split is the standard deviation of the
  half-difference ÷ 2 at each cell's worst frame, pooled per volume.
* **B2, injected noise.** On the middle 8 frames of each volume, add seeded Gaussian noise of σ_add = 0.5 σ and 1.0 σ
  (that frame's σ), round and clip at the stored depth, then re-estimate σ. Then b = σ̂(x + n)² − σ̂(x)² compared with
  σ_add² + 1/12, as a ratio minus 1. This is the noise point's P5 method on the real frames.
* **B3, integer Q.** The shared cells at G 1 and G 16. Per volume, Q_lo is the highest integer Q with worst frame
  ≤ 1 − δ, and Q_hi the highest with worst frame ≤ 1 + δ. Report the bytes at each, both bars' integer points, and,
  at G 16, bytes at worst-frame e_N ÷ σ = 1.00, interpolated in ln bytes with PCHIP (groups §S6's B₁, the same code).

**Predictions** (*assumptions* where marked):
* **B-1.** s_split ≤ 0.5 % on every volume. *Refuted* by any volume above 1 %.
* **B-2.** |b| ≤ 3 % on every volume, and b < 0 (σ underestimated once the edges are dropped) on A and C, whose
  noise rises most with signal (r 0.78–0.90). *Refuted* by |b| > 5 % anywhere, or b > 0 on two A or C volumes.
* **B-3.** δ is 1–3 %, so 1.00 and 1.03 fall in or at the edge of one resolution band. The anchor is unresolved on
  the ten volumes QA F1 lists within 3 % of 1 (`dbts_a1`, `a2`, `a5`, `b1`, `b2`, `b3`, `b4`, `b5`, `dbt10_d`,
  `dbt10_ea1141`), and resolved on system C, `dbts_a3`, `dbts_a4` and the 12-bit content-2 volumes (first failing rung
  1.031–1.090). *Refuted* by two or more volumes on the other side.
* **B-4.** Q_hi − Q_lo ≤ 2 integer rungs on 12-bit volumes and ≤ 4 on 10-bit ones, whose plateau starts at
  1.02 (*assumption*).
* **B-5.** At equal worst frame 1.00, G 16 ÷ G 1 bytes is 0.97–1.01 on 12-bit volumes and 0.88–0.96 on 10-bit
  ones. That is QA F2's 0–1 % and 6–10 % near the anchor, and N's arms read 0.99–1.00 on A and 0.90–0.94 on 10-bit
  (noise point §Held-out arms). *Refuted* by any volume outside its band by more than ε, where ε is computed as
  groups §S6 does.
* **B-6.** The per-depth x\* for 12-bit streams is ≥ 4.8, and the pooled x\* is 4.636 (*derived*: the minimum over the
  union is the G > 1 minimum).

**Decision rule.**
* If B-3 holds, the line stops quoting one bar's Q as the anchor. It quotes the anchor per (series, G) as
  [Q_lo, Q_hi], with bytes at both ends. The choice inside the band goes to the owner with A's ν beside it (decision 1
  in `claude/docs-lines-3:docs/lines/codecs.md` §Open 0).
* If B-3 is refuted (δ < 0.5 %), 1.00 is resolvable, and the line uses 1.00 with integer Q.
* B0's x\* replaces the noise point's two x\* values if the G 1 and G > 1 values differ by less than δ. Otherwise both
  stay, with δ beside them.
* B-5's G 16 ratios are the "G at equal quality" figures for 16 DBT volumes at lag 0. Groups §S2 gives the three
  timed volumes, cut form, with lookahead arms. No G is decided here: groups §S7 decides G, on its decode bound.

**What it cannot settle.** Visibility (A's limit), other datasets, ultrasound, and anything lookahead changes
(groups §S2).

## C · Decode on one HTJ2K unit, on a core-capped host (DA 1, 2, 13, the unit)

**Asked.** Four "HTJ2K frame" units have been used (DA §The HTJ2K frame is not one unit), and the product's own
path is timed in none. The only evidence that WebCodecs decodes in under one frame on a slow device comes from a
throttle that caps threads, not cores (DA 1). The lossy clock carries a discarded JavaScript pass (DA 2). So: on one
Chromium and one host, what do the OQ view and the exact frame cost to decode, against the product's own HTJ2K path,
at 1× and on a host capped to 1 and 2 slowed cores?

**Arms, each one decoder in its own worker, one frame in flight:**

| arm | what its clock spans, from the frame handed in to … | source |
| --- | --- | --- |
| **Hp** | … the product's `decodeFrame` returning, plus `xxh3` on the result and the digest compared: what a Lossless request runs | `client/decode/htj2k.js`, `client/decode/xxh3.js` of the demo tip, built by `client/decode/wasm/build/build.sh` |
| **Hb** | … the bare product build's decode and one `slice()` copy (profiles' unit) | `claude/av1-quality-profiles:lab/av1/profiles/decoders.js:95-104` |
| **Hk** | … the package's `decodeFrame` with its range pass (carriers', SNR's and SVC's unit) | `@cornerstonejs/codec-openjph` 2.4.11, as `claude/av1-profile-carriers:lab/av1/delivery/carriers/ask.js:10` loads it |
| **W** | … the WebCodecs output's luma copied out: the product's `av1-webcodecs.js` read, no `back()` | `client/decode/av1-webcodecs.js` of the demo tip, `prefer-software`, one decoder kept and flushed at a group's end as the product does |
| **Wb** | … as W, then profiles' `back()` on the clock | `claude/av1-quality-profiles:lab/av1/profiles/shared.js:13-17` |
| **D** | … dav1d-WASM's frame out, one thread | `client/decode/av1-dav1d.js` of the demo tip |

**Streams.** The demo's OQ form, as `claude/demo-fixes-0:scripts/demo-series.sh` codes it on the demo tip (`claude/demo-fixes-0` or newer,
per the queue's demo-tip rule): `dbts_b1` at its own 10 bits; `dbts_a1` and `dbts_c1` cut to 10 bits; Q 8 and the
noise rule's Q for that form (noise point §3's table: stored form for `dbts_b1`, top-10 form for the other two; B0's
recomputed Q if B0 has run first), G 1; the middle 16 frames. Each volume's exact series
(`.sbnd`) gives the same 16 frames to Hp, Hb and Hk.

**Throttles.** 1×; 4× per thread with no core cap (the studies' setting, kept to reproduce them); 4× with
`{ cores: 1 }` and with `{ cores: 2 }` (`lab/scripts/cpu_throttle.mjs`, `throttleTree`).

**Interleaving.** A round is every (volume, stream, throttle, arm) once. Within a round, throttles in a Williams order
rotated each round, and arms in a Williams order within each throttle. A fresh worker and decoder for each arm and
stream, opened and primed off the clock. At least 15 rounds, and up to 30 if time allows.

**Checks.**
* Every W, Wb and D frame is hashed against native dav1d. Every Hp, Hb and Hk frame is hashed against the exact
  series' XXH3. A miss voids that round.
* An A/A arm Hp′ (a second Hp), and an A/A interval wholly beyond ±5 % voids that throttle's cells.
* **Known-cost mutation** (DA 14): a dummy JavaScript pass over every sample added to Hb must move Hb ÷ Hp by its
  own separately timed cost, within the A/A half-width; otherwise the clocks are not what this protocol says.
* `throttleTree --check` (as residual apart's §Host ran it) once per host, with and without `cores`.

**Predictions** (bands are *assumptions* from the audit's *derived* figures):
* **C1.** (Wb − W) ÷ Hb at 1× is 0.20–0.32 on every volume, matching DA 2's 0.23–0.29. *Refuted* outside 0.15–0.40.
* **C2.** Hk ÷ Hb at 1× is 1.25–1.50 (the range pass's 21–31 % plus the copy into shared memory). Hp ÷ Hb is
  1.00–1.10: the pack's range adds nothing on the clock, and XXH3 on 2–9 MB is a few per cent (*assumption*). *Refuted*
  by Hp ÷ Hb > 1.15.
* **C3.** W ÷ Hp at Q 8, 1× is 1.4–1.9 on `dbts_a1` and `dbts_c1` (DA 2's ~1.55–1.81) and 1.2–1.8 on `dbts_b1`.
  *Refuted* by any volume ≤ 1.0.
* **C4.** At 4× with no core cap, W ÷ Hp is ≥ 0.15 below its 1× value, reproducing the studies' fall. At 4× with
  `cores: 1`, W ÷ Hp is within ±0.15 of its 1× value or above it: one slowed core takes away WebCodecs' threads. At
  `cores: 2` it lies between the two. *Refuted* if W ÷ Hp at `cores: 1` is ≤ 1.0 on two volumes.
* **C5.** W ÷ Hp rises as Q falls (more bytes to entropy-decode): at a stream's rule Q below 8 it is higher than at
  Q 8, and at a rule Q above 8 lower. *Refuted* by the opposite order on two volumes whose rule Q differs from 8.

**Decision rule.**
* The line quotes the OQ view's decode only as W ÷ Hp, with its throttle, stream form, Q and host. That replaces
  every "× an HTJ2K frame" for the view in `docs/lines/codecs.md`. Hp, the product's path, is the unit.
* "WebCodecs decodes under one HTJ2K frame on a slow device" is claimed only if W ÷ Hp has a 95 % upper bound < 1 at
  both `cores: 1` and `cores: 2` on all three volumes. Otherwise the line says that a core-capped host does not show
  it, and that a phone is owed.
* Hp ÷ Hb and Hk ÷ Hb are recorded as conversion factors, so every earlier study's ratio can be restated in Hp, each
  marked *derived*.
* No route changes: WebCodecs first is a decided approach. This decides only what may be said about its speed.

**Host and saturation.** One 4-core host, headless Chromium as `claude/av1-quality-profiles:lab/av1/profiles/README.md` pins it (the version is recorded
per round, DA 12). At 1×, Hp, Hb, Hk and D use one core; W uses Chromium's decoder threads, up to four (*assumption*).
The host saturates for W at 1×, so C3's W figures hold for a 4-core host only. At `cores: 1` and `cores: 2` the cap
itself is the limit. A capped cloud core is not a phone core (its cache, memory bandwidth and SIMD differ), so
nothing here is a phone claim.

**Cost.** 3 volumes × 2 streams × 4 throttles × 6 arms (+ A/A) × 16 frames a round. At 4× a frame costs 4–8× its 1×
time (about 25–150 ms at 1×, DA's tables), so a round is about 8–12 min and 15 rounds about 2–3 h (*derived*).

**What it cannot settle.** A phone, a GPU or hardware decoder (DA 11), concurrent decodes, or the fill's network
time.

## Measured (row MEASURE-1)

### B0 · amendment 1, written 2026-11-11 16:40 UTC before any B0 arithmetic ran

The protocol names its inputs but not every reading of them. Fixed here, before the run:

* **Rows.** `claude/av1-quality-metrics` at `2f04f648`: `lab/av1/metrics/rows/shard-{1,2,3,4}.jsonl`. Its shard 3
  carries the ladder cells (Q 1–56, G 1, 8, 16) of the five volumes the noise point held out, coded after that
  branch was cut. The noise point's held-out arms: `claude/av1-noise-point` at `991c298b`,
  `lab/av1/metrics/rows/noise-point/arms.jsonl` (stored form, integer Q, G 1 and 16). Where an arm and a ladder cell
  share (volume, Q, G), their bytes must be equal; any difference is listed and the ladder cell is used.
* **Volumes.** The 19 DBT volumes of the protocol's fixtures, by the rows' `set` names.
* **Forms.** Stored and, for 12-bit volumes, top-10, as the noise point §3 defines x\*. The `window` form is left out,
  as there. Stream depth B: 12 for a 12-bit stored form; 10 for 10-bit stored and every top-10 form.
* **Frame point.** As the noise point's §Sources gives it: x = ac_q(4Q, B) ÷ 8 ÷ σ_frame (σ ÷ 4 for top-10),
  y = `err_noise_band` ÷ σ_frame. ac_q from libaom v3.15.1 `av1/common/quant_common.c`, read from its tag.
* **x\*.** The smallest x with y > 1, truncated to four decimals as noise point §4 step 3 does. Recomputed (a) per G
  as the noise point had it, over all 19 volumes, as a check against 4.9293 and 4.6359; (b) pooled over the G 1 and
  G 16 frames; (c) pooled over G 1 and G 16, per stream depth B. G 8 frames are left out of (b) and (c), as the
  protocol names G 1 and G 16; x\* with G 8 in is reported beside them, not used.
* **Anchors (step 1).** Stored form, ladder rungs only, the highest rung from the bottom up whose worst frame is
  ≤ the bar (`collect.highest`), at bars 1.00 and 1.03, G 1 and G 16, with bytes ÷ the HTJ2K control's bytes.
* **Rule Q (step 3).** Every (volume, form, G ∈ {1, 16}) cell: the highest Q with Δ ÷ σ_min < x\*, on the ladder
  and on integer Q 1–61, under the noise point's two x\*, the pooled x\* and the per-depth x\*. Each ladder pick is
  set against the 1.00 and 1.03 anchors (equal, lower, higher). An integer pick is read against measured rows only
  where its Q was coded.
* **Check, before the reading.** The script must reproduce, from these rows, the noise point's in-sample x\*
  (4.92935 at G 1, 4.63596 at G 16, over its 14 volumes) and its held-out G 1 value with the arms in (4.802), and
  QA F1's table where QA quotes it. **Mutation:** the 8-bit AC table in place of the stream's must fail the check.
* **Code.** `lab/av1/audit/b0.py` on `claude/audit-measure`; its output `lab/av1/audit/rows/b0.json`.

### B0 · measured, 2026-11-11 16:55 UTC

Run as amendment 1 fixes it: `lab/av1/audit/b0.py` at `8cc5fe78`, rows `lab/av1/audit/rows/b0.json`. Zero encodes; every
number is arithmetic on the committed rows. **Fixtures:** the 19 DBT volumes, all from the one EA1141 dataset; ladder
Q 1–56 at G 1 and 16 on all 19, plus the noise point's 53 integer-Q arms on five of them. Nothing here speaks for
another dataset, ultrasound or a phone.

**Check.** The script reproduces the noise point's in-sample x\* (4.92935 at G 1, 4.63596 at G 16), its held-out G 1
value with the arms in (4.80244), and QA F1's table at both bars on all 19 volumes, every Q and every bytes ratio. The
arms and the ladder agree byte for byte wherever they share a cell. With the 8-bit AC table in place of the stream's,
the check fails (x\* 0.383 everywhere): the mutation is seen.

**1 · QA F1's table, reproduced.** Unchanged from `claude/av1-audit-quality:docs/av1/audit-quality.md` §Notes, F1.
The worst frames at the rungs that decide it: `dbts_a1` Q 8 1.0107 · 1.0076, `a2` 1.0075 · 1.0060, `a5` Q 8 G 1 1.0008
(G 16 0.9996), `b1` Q 12 G 16 1.0004 (G 1 0.9989), `b5` Q 12 1.0071 · 1.0069.

**2 · x\* recomputed** (smallest x with e_N ÷ σ > 1; stored and top-10 forms; truncated to four decimals):

| reading | frames | x\* | set by (volume, form, Q, G, frame: e_N ÷ σ) | x_hi |
| --- | --- | --: | --- | --: |
| noise point, G 1 | 14 in-sample volumes | 4.9293 | `dbts_c1` top-10, Q 8 | 6.689 |
| G 1, all 19 | ladder and arms | **4.7584** | `dbts_a5` top-10, Q 8, G 1, frame 70: 1.0036 | 6.689 |
| G 8, all 19 | ladder | 4.6359 | `dbts_b1` 10-bit, Q 12, G 8, frame 30: 1.0004 | 6.693 |
| G 16, all 19 | ladder and arms | 4.6359 | `dbts_b1` 10-bit, Q 12, G 16, frame 30: 1.0004 | 6.693 |
| **pooled**, G 1 and 16 | all 19 | **4.6359** | as G 16 (G 8 in: the same) | 6.693 |
| **per depth**, B 10 | 10-bit stored and every top-10 | **4.6359** | as G 16 | 6.693 |
| **per depth**, B 12 | 12-bit stored | **4.8024** | `dbts_a3` 12-bit, Q 9, G 1, frame 32: 1.0001 | 5.326 |

The held-out volumes' ladder cells lower the G 1 minimum again, from 4.802 to 4.758, on a top-10 frame. G 1 and
G > 1 now differ by 2.6 % (4.7584 against 4.6359), not 6 %.

**3 · Rule Q under each x\*,** 62 (volume, form, G) cells, G 1 and 16, stored and top-10; rows `rules` in `b0.json`.

| x\* | ladder Q against the 1.00 anchor: equal · lower · higher | against the 1.03 anchor | ladder picks changed against the noise point | integer picks changed |
| --- | --- | --- | --: | --: |
| noise point (4.9293 · 4.6359) | 49 · 13 · 0 | 26 · 36 · 0 | — | — |
| pooled 4.6359 | 45 · 17 · 0 | 22 · 40 · 0 | 4 | 14 |
| per depth (4.6359 · 4.8024) | 49 · 13 · 0 | 26 · 36 · 0 | 4 | 14 |

No reading picks a ladder rung above either anchor on any cell. Where an integer pick was coded, its worst frame is
0.921–0.999. The ladder picks that move, with bytes ÷ HTJ2K:
* **pooled**, all four at G 1, one rung down: `dbts_a3` top-10 8 → 4 (0.091 → 0.262), `dbts_b1` 12 → 8 (0.101 →
  0.219), `dbts_c1` 12-bit 8 → 4 (0.096 → 0.285), `dbts_c5` 12-bit 8 → 4 (0.096 → 0.288).
* **per depth**: `dbts_a3` top-10 G 1 and `dbts_b1` G 1 as pooled; `dbts_c1` and `dbts_c5` 12-bit **G 16 up** 4 → 8
  (0.284 → 0.095, 0.289 → 0.096), each now equal to its anchor. F6's 3× G 16 cost on `dbts_c1` goes; `dbts_b1`'s
  G 16 cost does not, and its G 1 cell now pays it too.

**Against the predictions.** **B-6 holds:** the per-depth x\* for 12-bit streams is 4.8024 (≥ 4.8, by 0.05 %), and
the pooled x\* is 4.6359. B-1 to B-5 need B1–B3.

**Decision rule, so far.** Whether B0's x\* replaces the noise point's two turns on δ, which B1 and B2 measure.
Until then: the G 1 x\* the rows support is 4.7584, not 4.9293 (the noise point's value predates shard 3's ladder
cells); the G 1 and G > 1 values differ by 2.6 %; and the per-depth reading reproduces the anchor on as many cells
as the noise point's while removing F6's `dbts_c1` and `dbts_c5` G 16 penalty. B-3's prediction (δ 1–3 %) would put
that 2.6 % inside the resolution.

### B · amendment 1, written 2026-11-11 18:50 UTC before any B encode ran

The protocol names the cells and the readings but not the code or every reading. Fixed here, before the run:

* **Code.** `lab/av1/audit/cells.py` on `claude/audit-measure`, not a new `audit_cells` in the groups branch's
  `plan.py` and a flag in its `cell.py`: it imports `claude/av1-groups-settings` at `0e0e58c8`
  (`lab/av1/groups/`, a detached checkout named by `GROUPS_DIR`) unchanged and runs its `run_cell`, `series` and
  scheduler, so the arm, `measure()` and `sigma_out` are that commit's byte for byte. Its `audit_cells(name, b, g)`
  is the protocol's ladder; the 16 new volumes' frame sizes are read from the data, not typed in. `plan.MIDDLE` is
  emptied, so `dbts_b1` is read whole (50 frames), as the quality study read it; groups shard S1 read 32.
* **B1.** The checkerboard: sample (y, x) is in half 0 when ⌊y ÷ 64⌋ + ⌊x ÷ 64⌋ is even. Per frame, σ on each half
  is `quality.sigma` with the window mask ANDed with the half (the steepest 10 % dropped within that half); e_N on
  each half is `quality.noise_band` of the same coding error with the same AND. σ halves are per volume (a `split`
  row, no encode); e_N halves ride on each cell's frames (`err_noise_band_halves`). For a cell, r_h = e_N,h ÷ σ_h at
  the cell's worst frame (by the whole frame's e_N ÷ σ). **s_split** of a volume is the RMS over its cells of
  (r_0 − r_1) ÷ 2, divided by the mean worst frame: the halves are exchangeable, so the RMS about zero is the
  standard error the protocol means, and it is quoted relative, as B-1's bands are.
* **B2.** In the same `split` row, on the middle 8 frames (from ⌊(n − 8) ÷ 2⌋): Gaussian noise with σ_add = 0.5 σ
  and 1.0 σ (σ: that frame's `quality.sigma` over its window), seeded by (CRC-32 of the volume name, frame,
  arm), rounded to integers, added, clipped to 0 … 2^b − 1 (clipped samples counted), σ re-estimated with the source
  frame's window mask. b = (σ̂(x + n)² − σ̂(x)²) ÷ (σ_add² + 1/12) − 1, per frame and arm; a volume's b is the mean
  over its 16 readings, with their range beside it. **δ** of a volume = max(2 · s_split, |b|).
* **B3.** Worst frame as `anchor.worst`. Q_lo and Q_hi per (volume, G) as the protocol defines them; "both bars'
  integer points" are `anchor.integer_point` at 1.00 and 1.03; G 16's bytes at 1.00 by `anchor.read` (PCHIP in ln
  bytes, rungs up to the first ≥ 1.02), with ε by `anchor.thinned` as groups §S6. B-5's ratio divides G 16's B₁ by
  G 1's B₁ read the same way. Bytes are the sum of the cell's units.
* **A, on the same rows.** ν per cell as `anchor.nu`. "The rule's Q" for A2 is the integer Q under the pooled x\*
  4.6359 and, beside it, the per-depth x\* (B0's two readings), each from B0's `rules`; A2 is judged under both and
  says so. A3 bins x by 0.25 with x as B0's frame point at each cell's median frame. Q_ν uses median-frame ν.
* **Check, before the run.** The first cells coded are the check rungs (O G 1 at Q 4, 8, 12, and 16 on 10-bit) of
  the three timed volumes, then the rest. Every check rung on every volume is compared, as it lands, with
  `claude/av1-quality-metrics` at `2f04f648`, `lab/av1/metrics/rows/shard-{1,2,3,4}.jsonl` (stored form, G 1, same
  Q): its unit sizes must be equal, frame for frame. A mismatch stops the run. **Mutation:** one extra encode,
  `dbt12_ea1141` O G 1 Q 8 with `--cpu-used=5`, compared the same way, must differ; it is a `check` row and no cell.
* **Order and cut.** Volumes in the order `dbts_a1`, `b1`, `c1`, `dbt12_c`, `a2`, `b2`, `c2`, `dbt12_ea1141`, `a3`,
  `b3`, `c3`, `dbt10_d`, `a4`, `b4`, `c4`, `dbt10_ea1141`, `a5`, `b5`, `c5`; G 1 for all, then G 16. One background
  command stops at 2 h on this host, so the run is a sequence of commands that each resume from the rows file
  (finished cells are skipped). If the session's time runs out, G 16 is cut first, then content 2, and the cut is
  named in the result.
* **Rows.** `lab/av1/audit/rows/b.jsonl`, committed about every 10 minutes while the run lasts.
* **Host.** One 4-core cloud host without a GPU, 15 GB; `--jobs 4`, `--memory-gb 13.5`. Encode CPU seconds are
  reported per cell; nothing here is timed for a verdict.

### B · amendment 2, written 2026-11-12 00:20 UTC before any extra rung was coded

The protocol allows one rung outward where a volume's worst frame is not bracketed (§Shared cells), and names no test
for "bracketed". Fixed here, after G 1's 185 cells landed and before any extra encode:

* **Bracketed.** A (volume, G) ladder is bracketed when one rung's worst frame is ≤ 1 − δ and one is > max(1 + δ,
  1.03), so that Q_lo, Q_hi and both bars' integer points each fall inside the ladder. δ is the volume's (B1, B2; it
  does not depend on G).
* **The extension.** Each (volume, G) not bracketed above gains the next integer Q (13 on 12-bit, 17 on 10-bit);
  not bracketed below, the one under (3 on 12-bit, 5 on 10-bit). Once, never further, decided on the ladder's rows
  alone. One still not bracketed is reported *censored*: Q_hi or the bar's point is then "≥ the top rung".
* **Seen at G 1, before this was written** (a reading of `lab/av1/audit/summary.py` on the rows, nothing coded):
  no volume is short below; above, six 10-bit volumes are short: `dbts_b2` (worst 1.028 at most), `dbts_b3` (1.024),
  `dbts_b4` (1.028), `dbts_b5` (1.033, δ 3.8 %), `dbt10_d` (1.028) and `dbt10_ea1141` (1.016). Their Q 17 at G 1, and
  whatever G 16 shows short by the same test, are coded after G 16's ladder, by `cells.py --extra NAME:G:Q`.

### B · measured, 2026-11-12 01:40 UTC

Run as amendments 1 and 2 fix it: `lab/av1/audit/cells.py` at `82a6f18a` on `claude/av1-groups-settings` `0e0e58c8`,
rows `lab/av1/audit/rows/b.jsonl`, read by `lab/av1/audit/summary.py` into `lab/av1/audit/rows/b-summary.json`.
**Fixtures:** the 19 DBT volumes, all from the one EA1141 dataset, read whole, stored form; 185 cells at G 1, 156 at
G 16, and amendment 2's 11 rungs outward (Q 17 on `dbts_b2` G 1; `dbts_b3`, `b4`, `b5`, `dbt10_d`, `dbt10_ea1141` at
G 1 and 16), 352 in all; no cut. One 4-core cloud host, libaom 3.15.1, dav1d 1.5.4. Nothing here speaks for another
dataset, the cut form, ultrasound or a phone.

**Check.** All 57 check rungs (O G 1 at Q 4, 8, 12, and 16 on 10-bit, every volume) equal the quality study's unit
sizes frame for frame. The `--cpu-used=5` mutation differs, in both sessions that ran it (two `check` rows).

**Per volume** (s_split relative; b the mean of 16 injected readings; δ = max(2 · s_split, |b|); Q_lo · Q_hi at
1 ∓ δ; ν at the integer rule Q under B0's pooled and per-depth x\*):

| volume | s_split | b (range) | δ | G 1: Q_lo · Q_hi | at 1.00 · 1.03 | G 16: Q_lo · Q_hi | ν at rule Q (pooled · per depth) |
| --- | --: | --- | --: | --- | --- | --- | --- |
| `dbts_a1` | 0.13 % | +0.5 % (−1.1 … +1.5) | 0.5 % | 7 · 7 | 7 · 9 | — | 0.318 (Q 7) · 0.318 (Q 7) |
| `dbts_b1` | 0.05 % | −2.0 % (−4.6 … −0.3) | 2.0 % | 11 · 13 | 12 · 15 | — | 0.286 (Q 11) · 0.286 (Q 11) |
| `dbts_c1` | 0.25 % | −1.0 % (−4.0 … +0.8) | 1.0 % | 7 · 8 | 8 · 8 | — | 0.447 (Q 7) · 0.322 (Q 8) |
| `dbt12_c` | 0.16 % | +2.7 % (+2.1 … +4.0) | 2.7 % | 8 · 9 | 8 · 9 | 8 · 9 | 0.375 (Q 8) · 0.375 (Q 8) |
| `dbts_a2` | 0.08 % | −0.5 % (−2.7 … +0.7) | 0.5 % | 7 · 7 | 7 · 8 | 7 · 7 | 0.400 (Q 7) · 0.400 (Q 7) |
| `dbts_b2` | 0.05 % | −2.3 % (−4.3 … −1.0) | 2.3 % | 8 · 13 | 10 · ≥ 17 | 8 · 13 | 0.339 (Q 8) · 0.339 (Q 8) |
| `dbts_c2` | 0.14 % | +5.5 % (+3.6 … +8.5) | 5.5 % | 7 · 10 | 8 · 9 | 8 · 10 | 0.415 (Q 8) · 0.292 (Q 9) |
| `dbt12_ea1141` | 0.22 % | +2.1 % (+0.8 … +3.4) | 2.1 % | 7 · 9 | 8 · 9 | 7 · 9 | 0.427 (Q 7) · 0.427 (Q 7) |
| `dbts_a3` | 0.07 % | −0.1 % (−2.0 … +1.8) | 0.1 % | 8 · 8 | 8 · 10 | 8 · 8 | 0.326 (Q 8) · 0.326 (Q 8) |
| `dbts_b3` | 0.08 % | −2.2 % (−4.2 … −0.4) | 2.2 % | 12 · 15 | 13 · ≥ 17 | 12 · 15 | 0.340 (Q 12) · 0.340 (Q 12) |
| `dbts_c3` | 0.08 % | +1.8 % (+0.9 … +2.4) | 1.8 % | 8 · 9 | 8 · 9 | 8 · 9 | 0.389 (Q 8) · 0.389 (Q 8) |
| `dbt10_d` | 0.13 % | −2.9 % (−5.0 … −0.8) | 2.9 % | 10 · 16 | 12 · 16 | 10 · 15 | 0.434 (Q 9) · 0.434 (Q 9) |
| `dbts_a4` | 0.08 % | +0.7 % (−0.5 … +1.5) | 0.7 % | 8 · 9 | 9 · 11 | 8 · 9 | 0.350 (Q 8) · 0.350 (Q 8) |
| `dbts_b4` | 0.11 % | −3.5 % (−6.6 … −1.1) | 3.5 % | 12 · 16 | 13 · 16 | 12 · 16 | 0.362 (Q 12) · 0.362 (Q 12) |
| `dbts_c4` | 0.13 % | +2.7 % (+1.5 … +4.1) | 2.7 % | 8 · 10 | 9 · 10 | 8 · 10 | 0.346 (Q 9) · 0.346 (Q 9) |
| `dbt10_ea1141` | 0.17 % | −1.1 % (−3.2 … +0.5) | 1.1 % | 12 · 15 | 13 · ≥ 17 | 12 · 14 | 0.495 (Q 9) · 0.495 (Q 9) |
| `dbts_a5` | 0.15 % | +0.7 % (−0.3 … +1.6) | 0.7 % | 7 · 8 | 7 · 8 | 7 · 8 | 0.398 (Q 7) · 0.398 (Q 7) |
| `dbts_b5` | 0.04 % | −3.8 % (−6.4 … −1.3) | 3.8 % | 9 · ≥ 17 | 11 · 15 | 9 · ≥ 17 | 0.423 (Q 8) · 0.423 (Q 8) |
| `dbts_c5` | 0.12 % | −0.9 % (−2.8 … +0.9) | 0.9 % | 8 · 8 | 8 · 9 | 8 · 8 | 0.450 (Q 7) · 0.323 (Q 8) |

**Censored after amendment 2** (worst frame still ≤ max(1 + δ, 1.03) at Q 17): `dbts_b2` G 1 (1.0298), `dbts_b3`
G 1 and 16 (1.0292, 1.0300), `dbt10_ea1141` G 1 and 16 (1.0228, 1.0300), `dbts_b5` G 1 and 16 (1.0366, 1.0371).
Their "≥ 17" is a floor. Bytes at every rung are in `b-summary.json`.

**Against the predictions.**
* **B-1 holds:** s_split 0.04–0.25 %, under 0.5 % on every volume.
* **B-2 refuted**, on both counts: |b| is above 5 % on `dbts_c2` (+5.5 %), and b > 0 on six A or C volumes (`a1`,
  `a4`, `a5`, `c2`, `c3`, `c4`), not < 0. Where b is largest it is the 10-bit B volumes that read negative (−2.0 to
  −3.8 %), and system C splits both ways. Not predicted: the 16 readings per volume span 2–6 points, so b is a
  frame-dependent bias, not one number. 173 million injected samples were clipped at 0 or 2^b − 1 over all volumes;
  the protocol did not ask how many of them fall inside the window, and this run did not count it.
* **B-3 refuted**, on the other side from the one its decision rule names: δ is 0.1–5.5 % (median 2.0 %), not
  1–3 % on every volume, and the anchor is unresolved (Q_lo ≠ Q_hi at G 1) on 15 of 19 volumes, not 10. Resolved:
  `dbts_a1`, `a2`, `a3`, `c5`. Against the prediction, 9 volumes are on the other side: `a1` and `a2` resolve
  (δ 0.5 %), while system C's `c1`–`c4`, `a4`, `dbt12_c` and `dbt12_ea1141` do not.
* **B-4 refuted:** Q_hi − Q_lo is 0–3 on 12-bit volumes (3 on `dbts_c2` G 1, over the bound of 2) and 2–≥ 8 on
  10-bit ones (`dbts_b2` 5, `dbt10_d` 6 and 5, `dbts_b5` ≥ 8 at both G, over 4). The 10-bit plateau near 1.02–1.03
  that the prediction assumed is real, and wider than assumed.
* **B-5 holds** by its rule (ε 5.4 % by `anchor.thinned`): G 16 ÷ G 1 bytes at worst frame 1.00 is 0.954–0.986 on
  12-bit volumes and 0.855–0.907 on 10-bit ones. Six are outside the bare band but within ε: `dbts_c2` 0.964,
  `dbt12_ea1141` 0.954, `dbts_c4` 0.957 (under 0.97), and `dbts_b3` 0.869, `dbt10_d` 0.879, `dbt10_ea1141` 0.855
  (under 0.88). G 16 saves 1–5 % at equal quality on 12-bit volumes and 9–15 % on 10-bit ones, at lag 0.

**Decision rule.**
* B-3 is refuted, but not by δ < 0.5 %, the case its second branch names: that branch's premise (1.00 resolvable)
  holds only on `dbts_a1`, `a2` and `a3`. On the other 16 volumes the first branch's reason holds more strongly than
  predicted. *This session's reading, for the owner:* the line stops quoting one bar's Q as the anchor and quotes
  [Q_lo, Q_hi] per (series, G) with bytes at both ends and A's ν beside them, as the first branch says, because the
  refutation widens the bands rather than closing them. Decision 1 in `claude/docs-lines-3:docs/lines/codecs.md`
  §Open 0 is the owner's.
* B0's x\* against δ: the G 1 and G > 1 x\* differ by 2.6 %; that is under δ on six volumes (`dbts_b4`, `b5`,
  `c2`, `dbt10_d`, `dbt12_c`, `c4`) and over it on 13, and over the median δ (2.0 %). By the rule's "otherwise",
  both x\* stay (4.7584 at G 1, 4.6359 at G > 1, B0's values), with δ beside them.
* B-5's ratios are the "G at equal quality" figures for 16 DBT volumes at lag 0. No G is decided here.

### A · measured, 2026-11-12 01:40 UTC

On B's rows (amendment 1 fixes A's readings there): ν per cell by `anchor.nu`, median frame; the rule's Q is B0's
integer pick under the pooled x\* (4.6359) and the per-depth x\* (4.6359 · 4.8024). Fixtures as B's.

* **A1 holds:** ν falls with Q on every volume at G 1; no adjacent pair rises at all (the bound was 0.02).
* **A2 refuted, by one or two volumes:** ν at the rule's Q is 0.286–0.495. Under the pooled x\*, `dbt10_ea1141`
  (0.495, Q 9) and `dbts_c5` (0.450, Q 7) are above 0.45; under the per-depth x\*, `dbt10_ea1141` only. The other 17
  are inside 0.15–0.45. So the OQ view keeps 29–50 % of the fine-band noise's amplitude at the rule's Q (8–25 % of
  its power), and the upper end is at the band's edge, not well inside it.
* **A3 refuted:** at equal x (bins 0.25 wide, ≥ 3 systems), ν's spread across systems is 0.005–0.045 for x < 2.75
  and 0.03–0.24 from 2.75 up, over 0.08 in 15 of those 18 bins (0.11–0.13 at x 4.50–4.75). ν is not one curve of x across systems in the range the rule
  uses (x near 4.6–4.8): theory point 3's white-noise argument does not carry to these volumes.
* **A4 refuted on three volumes:** Q_ν (the highest Q with median ν ≥ 0.5) is one to three rungs under the pooled
  rule's Q, and costs 1.30–1.92× its bytes on 16 volumes; `dbts_c2` 1.295, `dbts_b5` 1.20 and `dbt10_ea1141` 1.16 are
  under 1.3 (where the rule's Q already sits near ν 0.5).

**Decision rule.** A2 is refuted, so the bar's critique (QA F4) is corrected in place with the measured ν: at the
rule's Q the view keeps 29–50 % of the fine-band noise's amplitude on these 19 volumes, not "almost none"; at the
noise anchor itself (worst frame 1.00) ν is lower (`dbts_b1` 0.22 at Q 12, `dbts_c1` 0.32 at Q 8). Q_ν and its bytes
per volume, the option "keep at least half", are in `b-summary.json` (`q_nu`, and A4's ratios above) for the owner's
decision 1 or 9 in `claude/docs-lines-3:docs/lines/codecs.md` §Open 0. What A cannot settle stands: whether the
removed noise is visible or costs a diagnosis.

### C · amendment 1, written 2026-11-12 03:24 UTC before any C decode was timed

The protocol names the arms, streams and checks but not the code or every reading. Fixed here, before the run:

* **Demo tip and builds.** `claude/demo-fixes-2` at `18d2d1ff` (the demo commit `157b7109` with docs only on top),
  as a detached worktree. Its decoder builds are the committed `client/decode/wasm/built/` (openjph, dav1d, xxh3,
  checked by `wasm-glue.js` against `manifest.sha256` at every load); `build.sh` is not rerun (no Docker daemon is
  needed for files the tip already pins). Hk's build is `client/decode/wasm/fetch_openjph.sh` (npm
  `@cornerstonejs/codec-openjph` 2.4.11), as carriers loaded it.
* **Streams.** `lab/av1/audit/c_streams.sh`: the tip's `lab/av1/tools/ingest_coded.py` (the coder `demo-series.sh`
  runs) writes frame files, not bundles: each volume's exact series (`--codec htj2k`) and `--lossy Q 1 --exact-series`
  at Q 8 and at the rule's Q, `--depth-cut` on `dbts_a1` and `dbts_c1`. The rule's Q is B0's integer pick under the
  pooled x\* (`rows/b0.json` `rules`, as A read it): `dbts_a1` top-10 Q 6, `dbts_b1` 10-bit Q 11, `dbts_c1` top-10
  Q 7. Two are below 8 and one (`dbts_b1`) above it, so C5 is judged both ways. Frames: the middle 16, from
  ⌊(n − 16) ÷ 2⌋.
* **One H block per (volume, throttle).** Hp, Hp′, Hb, Hk and the mutation decode the exact series, which does not
  depend on the stream; each runs once per (volume, throttle) in a round, and both streams' W, Wb and D are divided
  by that round's Hp. A round is then, per throttle, three volumes of 5 H arms and 2 × 3 W arms; per volume, its 11
  arm-runs in a Williams order (`lab/order.mjs`) of 11 units rotated by round, and the volumes in a Williams order
  of 3. Throttles in a Williams order of 4 rotated by round, as the protocol says.
* **Clocks** (`performance.now()` in the arm's worker, per frame, one frame in flight; an arm's time is the sum over
  its 16 frames):
  * Hp: the tip's `htj2k.js` `decodeFrame(bytes)` on its `built("openjph")`, then the tip's `xxh3.js` hasher over the
    result's buffer and the digest compared with the frame's XXH3-64: `decoder.js` `checked()` without its second
    decode.
  * Hb: profiles' `openjph()` (`decoders.js:95-104`) on the tip's `built("openjph")`: decode, `getDecodedBuffer()`,
    one `slice()`.
  * Hk: the tip's `htj2k.js` `init()` and `decodeFrame(bytes)` on the npm build (no `getRange`, so `finish()`'s range
    pass runs) — the same module as Hp, on carriers' build.
  * Hm (the known-cost mutation): Hb, then a JavaScript pass summing every 16-bit sample into an accumulator that
    is returned, on Hb's clock; the pass alone is also timed on a clock of its own around it (`pass`).
  * W: the tip's `av1-webcodecs.js` `init({ groupLength: 1 })` and `picture(bytes, { key: true, gen: 0, index })`,
    whose `read()` is the product's copy of the luma out (`copyTo`); its own decoder, kept and flushed at a
    group's end, as the product does.
  * Wb: W, then profiles' `back()` (`shared.js:13-17`) over the luma plane's samples with shift = stored depth − 10
    (2 on `dbts_a1` and `dbts_c1`, 0 on `dbts_b1`, where the loop still runs).
  * D: the tip's `av1-dav1d.js` `init({ ...built("dav1d"), threads: 1 })` and `picture()`.
  Off every clock: the worker is created, the module loaded and the decoder opened, and one frame (the first of
  the 16) decoded once to prime it; then the 16 are timed.
* **Checks as coded.** After each frame's clock, off it: Hp, Hb, Hk and Hm hash their samples with the tip's XXH3
  against the exact series' frame digest (Hp already compared on its clock); W, Wb and D take SHA-256 of the luma
  samples (row by row, little-endian) against native dav1d 1.5.4 (`ingest/.build`) on the same unit. A miss voids
  that round, as the protocol says. The A/A interval and the known-cost check: per (volume, throttle), over rounds,
  the mean of Hp′ ÷ Hp with its t 95 % interval; known cost holds when (Hm − Hb) ÷ Hp and pass ÷ Hp differ by less
  than the A/A half-width. `throttleTree --check` once (no cores); with cores, `lab/av1/audit/c.mjs --check` runs
  four worker loops at once under 4× with `cores` 1 and 2 and reports their time against 1× (expected 16× and 8×).
* **Readings.** Every ratio (W ÷ Hp, Wb, D, Hb, Hk, Hp′ over Hp, and (Wb − W) ÷ Hb) is taken per round from the arm
  sums, then quoted as the mean over rounds with its t 95 % interval; C4's falls and C5's orders compare those
  means. The decision rule's "95 % upper bound" is the interval's upper end.
* **Rounds and cut.** 15 rounds, more up to 30 if time allows. One background command stops at 2 h, so the driver
  resumes from its rows file (a round whose rows are partial is run again whole, its partial rows moved to
  `rows/c-stopped.jsonl`). If a round at 4× runs far over the protocol's 8–12 min, the cut is fewer rounds (never
  fewer than 10), named in the result, not fewer arms or throttles.
* **Rows.** `lab/av1/audit/rows/c.jsonl`, one row per arm-run (round, throttle, volume, stream, arm, 16 frame times,
  hash results, the Chromium version), committed about every 10 minutes. Driver `lab/av1/audit/c.mjs`, worker
  `lab/av1/audit/c_arm.js`, summary `lab/av1/audit/c_summary.py`. A smoke run before round 1 checks the driver and is
  not kept; `C_TAMPER=1` (one frame's reference changed) must give every arm one miss. The cores lever's check is
  `rows/c-check.txt`.
* **Host.** One 4-core cloud host without a GPU, cgroup v1 `cpu`, the pre-installed headless Chromium of Playwright.

### C · measured, 2026-11-12 05:50 UTC

Under amendment 1: 15 rounds of 132 arm-runs, 03:30–05:41 UTC (round 1 rerun whole after a container restart, its
117 partial rows in `rows/c-stopped.jsonl`), no hash miss and no void round; Chromium 153.0.8010.12, headless, the
demo tip `18d2d1ff`. Rows `lab/av1/audit/rows/c.jsonl`, readings `rows/c-summary.json` and `c-summary.txt`
(`c_summary.py`), the cores lever `rows/c-check.txt` (four loops: 4.11× at 4×, 8.14× at `cores: 2`, 15.51× at
`cores: 1`, against 4, 8 and 16). Every figure: mean over 15 rounds (t 95 % interval).

**Checks.** A/A Hp′ ÷ Hp is 0.96–1.02 in every (volume, throttle); no interval lies wholly beyond ±5 %, so no cell
is void. Known cost: (Hm − Hb) ÷ Hp and pass ÷ Hp differ by 0.002–0.042, under the A/A half-width (0.022–0.086) in
all 12 (volume, throttle): the clocks are what the protocol says. The checks' mutation (`C_TAMPER=1`) gave each arm
its one miss.

**The unit.** Hp at 1×: 19.8 (18.0–21.5) ms a frame on `dbts_a1`, 57.1 (53.8–60.4) on `dbts_b1`, 20.1 (18.2–21.9)
on `dbts_c1`.

| reading at 1× | `dbts_a1` | `dbts_b1` | `dbts_c1` | prediction | verdict |
| --- | --- | --- | --- | --- | --- |
| (Wb − W) ÷ Hb, Q 8 · rule Q | 0.27 · 0.26 | 0.37 · 0.37 | 0.34 · 0.34 | C1: 0.20–0.32; refuted outside 0.15–0.40 | not refuted; band missed on `b1`, `c1` |
| Hk ÷ Hb | 1.36 (1.28–1.43) | 1.61 (1.52–1.70) | 1.52 (1.46–1.57) | C2: 1.25–1.50 | band missed on `b1`, `c1` (above) |
| Hp ÷ Hb | 1.03 (0.94–1.13) | 1.06 (0.99–1.13) | 1.08 (1.00–1.17) | C2: 1.00–1.10; refuted > 1.15 | holds |
| W ÷ Hp, Q 8 | 1.24 (1.18–1.30) | 1.74 (1.66–1.81) | 1.36 (1.27–1.45) | C3: 1.4–1.9 (`a1`, `c1`), 1.2–1.8 (`b1`); refuted ≤ 1.0 | not refuted; band missed on `a1`, `c1` (below) |

W ÷ Hp by throttle (rule Q: `a1` 6, `b1` 11, `c1` 7):

| stream | 1× | 4× | 4×, `cores: 2` | 4×, `cores: 1` |
| --- | --- | --- | --- | --- |
| `dbts_a1` Q 8 | 1.24 (1.18–1.30) | 0.68 (0.63–0.72) | 0.74 (0.69–0.78) | 1.16 (1.10–1.23) |
| `dbts_a1` Q 6 | 1.72 (1.63–1.80) | 1.12 (1.04–1.20) | 1.12 (1.06–1.18) | 1.56 (1.49–1.63) |
| `dbts_b1` Q 8 | 1.74 (1.66–1.81) | 1.06 (1.02–1.09) | 1.07 (1.02–1.11) | 1.58 (1.50–1.66) |
| `dbts_b1` Q 11 | 1.29 (1.24–1.34) | 0.69 (0.65–0.74) | 0.74 (0.72–0.76) | 1.21 (1.15–1.27) |
| `dbts_c1` Q 8 | 1.36 (1.27–1.45) | 0.70 (0.66–0.74) | 0.75 (0.71–0.80) | 1.23 (1.15–1.31) |
| `dbts_c1` Q 7 | 1.53 (1.43–1.62) | 0.86 (0.78–0.94) | 0.89 (0.83–0.95) | 1.39 (1.31–1.47) |

D ÷ Hp (dav1d-WASM, one thread) is 1.86–2.89 on every stream and throttle; it barely moves with the throttle, as a
one-thread arm divided by a one-thread arm should.

* **C4 holds.** Uncapped 4× takes 0.52–0.68 off W ÷ Hp on every stream (≥ 0.15). At `cores: 1` W ÷ Hp is within
  0.08–0.16 below its 1× value, inside ±0.15 on four streams and 0.01 outside it on two (`a1` Q 6, `b1` Q 8: −0.16);
  never ≤ 1.0. `cores: 2` lies between, but within 0.00–0.06 of uncapped 4×: two slowed cores give WebCodecs
  nearly all it takes from four.
* **C5 holds** at every throttle: below Q 8 (`a1` Q 6, `c1` Q 7) W ÷ Hp is higher than at Q 8; above it (`b1` Q 11)
  lower.
* **Decision rule.** W ÷ Hp's upper bound is above 1 at `cores: 1` on all three volumes (1.23–1.66), and at `cores: 2`
  above 1 on `dbts_a1` Q 6 and `dbts_b1` Q 8. So "WebCodecs decodes under one HTJ2K frame on a slow device" is not
  claimed: a core-capped host does not show it, and a phone is owed. With four slowed cores and two, the view at the
  Q 8 and rule-Q streams `a1` Q 8, `b1` Q 11, `c1` Q 8 and Q 7 decodes in 0.68–0.89 of the product's HTJ2K frame.
* **Conversion factors** (for restating earlier studies in Hp, *derived*): Hp = 1.03–1.08 Hb; Hk = 1.36–1.61 Hb, so
  Hk = 1.26–1.52 Hp at 1×.

Saturation: at 1× W uses up to four cores and the others one, so its 1× ratios hold for a 4-core host only; at
`cores: 1` and `cores: 2` the cap is the limit. Fixtures: three timed DBT volumes (`dbts_a1`, `dbts_b1`, `dbts_c1`)
of one dataset, the middle 16 frames, G 1 only; one 4-core cloud host without a GPU; software WebCodecs
(`prefer-software`). A capped cloud core is not a phone core: nothing here is a phone claim, and nothing speaks for
G > 1, hardware decode or concurrent decodes.
