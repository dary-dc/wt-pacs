# Codecs and lab

Last verified 2026-11-09 (AV1 state of 2026-11-07, the design decision and the noise-point result of 2026-11-09).

## Goal

HTJ2K and AV1, the server, the transport and the disk, investigated and measured to `CLAUDE.md` §Measurement. The PCS
encodes, so a codec finding is a recommendation to the PCS team and an input to the PACS line. Structural theory (what
follows from a format's definition or arithmetic) discards cheaply and names candidates; sizes and times are always
measured, and every result names its fixtures.

## State now

**Fixtures.** Every AV1 timing rests on three EA1141 breast tomosynthesis volumes, `dbts_a1`, `dbts_b1`, `dbts_c1`
(systems A and C 12-bit, noise σ 13–18; B 10-bit, σ 4.4–6.7); the quality study covers 20 series, 14 of them DBT. No
breast ultrasound cine or ABUS exists among the fixtures ([`../FIXTURES.md`](../FIXTURES.md)).

* **Design chosen (2026-11-09):** every viewer sees the series' **optimal quality**, a visually lossless AV1 view
  (also for diagnosis, not a preview); a reader's explicit request fetches the **exact** HTJ2K frame whole. The
  residual design (view + HTJ2K residual) is dropped. Its build is [`optimal-quality.md`](optimal-quality.md).
* **Measured, Q 8, G 1, on the three volumes:** the view is 0.07–0.22 of HTJ2K's bytes; view plus the whole exact
  frame 1.07–1.22×; the exact ask decodes in 1.01–1.03 HTJ2K frames. The lossy view decodes in 1.05–2.04 HTJ2K frames
  through WebCodecs and 1.9–4.7 through dav1d-WASM: AV1 saves bytes, not decode time.
* **Quality** (`claude/av1-quality-metrics`, 20 series, one shard missing): the coding error reaches the noise at
  Q 8 (system A: Q 4); no Q keeps every displayed level within 1; visual losslessness needs readers, not run.
* **Noise point** (`claude/av1-noise-point`, #317, 2026-11-09): a candidate Q per series from one number, the series'
  lowest frame noise σ_min. Valid for the DBT fixtures only; not for TRUS or MR. Held-out test (2026-11-09): the rule
  picked the predicted Q on 10 of 10 (series, G) cells of five unseen DBT series, worst frame 0.89–0.97 of σ; σ costs
  0.05–0.09 CPU s/Mpx at ingest and must be taken on every frame (every fourth moved one cell by a rung).
* **Q against window width** (`claude/av1-window-q`, 2026-11-09): a window scales coding error and noise alike, so
  "coding error within the noise" holds at every width once it holds: Q 8 meets it on DBT, a higher Q does not. "Error
  under one display level at the header windows" would need Q 1–2 on 12-bit DBT (0.64 of HTJ2K's bytes against about
  0.10 at Q 8), Q 4 on 10-bit DBT and TRUS. Which reading is visually lossless needs readers.
* **Depth and decode route:** WebCodecs decodes the OQ view; dav1d-WASM is a fallback only. D ≤ 10 is coded at its
  own depth; D > 10 by the depth cut to 10 bits, because WebCodecs gives no 12-bit samples in any engine
  (`claude/av1-webcodecs-profiles`). At Q 8 the cut costs about 0.3 dB and saves 6–7 % of the bytes at equal Q
  (`dbts_a1`, `dbts_c1`), i.e. no real gain at equal quality: it is there for the decode route.
* **Out of the top, not discarded:** a two-layer SVC preview; lossless AV1 as the exact form.
* **Discarded:** a layered three-layer carrier; preview and view as quality layers of one stream; top-first; HTJ2K
  resolution ladder and quality layers; lossless G > 1; a lossy top plus low stream; key parsing in place of
  WebCodecs' flush (tag `archive/av1-keyparse`); LCEVC.
* **Server and transport:** `claude/line-server` (#254) holds 13 results (congestion and disk designs, PGO, tail
  ping, GSO, and others); no default changed.

## Open (ordered)

0. **G at equal quality** (`claude/av1-groups`, protocol then measurement): G has only been compared at equal Q. Open:
   why G saves almost nothing at Q 8 on DBT, whether a lower Q at a larger G wins at equal fidelity, and whether our
   low-delay encoder settings (no lookahead, no alt-ref frames, whose temporal filtering partly averages out noise)
   suppress inter coding. Decode time in order matters more than jumps (sequential reading). No G is decided for DBT.
1. Harvest and review the AV1 result chain into `av1-unified-mainbase`: #290 → #305 → #317, #312; #283 → #306 → #314
   → #316; #288, #315 (residual exactness across decoders, browser cells partial), #318 (WebCodecs profiles).
2. Explore noise detection at ingest (σ_min, its estimator's timing on the three volumes), then hand it to the PCS team.
3. Running (2026-11-10): every encoder setting the line used, sourced and explained, with what it may have biased
   (`claude/av1-encoder-settings`); independent audits of the quality/bytes results (`claude/av1-audit-quality`) and
   of the decode/timing results (`claude/av1-audit-decode`); the theory of coding error against the image's noise as
   the visually-lossless criterion, with model observers (`claude/av1-noise-ratio`); how VL is established in
   radiology (`claude/av1-vl-metrics`, landed); HTJ2K with resolution levels and tiles, a separate approach outside
   the demo (`claude/htj2k-tiles`, protocol landed).
4. Owed to a GPU machine or a phone: hardware decoders' exactness, reduced-depth paint timing, group arms.
5. One place for the coded sets (2026-11-11, findings, [`../reviews/dataset-hub.md`](../reviews/dataset-hub.md)):
   a recipe key and a pin file; release assets on this repository lead. Owed: the same bundle digests on two hosts,
   and the owner's choice of who uploads.
5. A note to the PCS team on G for AV1 cine; keep or remove the client's G > 1 path.
6. Held server defaults awaiting a yes or no, listed in `line-server`'s index (#254).

## Decisions (the owner's)

* 2026-10-12: XXH3 replaces SHA-256; DBT in scope. 2026-10-13: GPU decoding not pursued for now.
* 2026-10-10: frames of 12 bits or fewer are filled, deeper ones fit plus tiles; never a reduced-resolution preview.
* 2026-10-24: tiles delayed, not closed; AV1 types without open data parked until a dataset exists.
* 2026-10-26: no end-to-end G > 1 build. 2026-10-30: AV1 scope = cine-like series (one consecutive dimension), breast
  first, ≤ 12 bits; late frames appended only.
* 2026-11-02: hardware decode only through WebCodecs; VVC parked.
* 2026-11-04: no per-browser-version defaults; every decision states its fixtures' limits.
* 2026-11-05: full depth on the client; one noise point per candidate; lossless AV1 and SVC kept outside the top.
* 2026-11-06: a preview, if any, is the small full-size stream only; reduced-resolution previews not considered now.
* 2026-11-09: optimal quality plus the exact HTJ2K frame on request; the residual dropped. G fixed per modality by
  measurement (no adaptive detector); Q per series by the noise rule; the PCS chooses both, and our side handles any
  Q, G and depth. Splitting the OQ view's decoded samples into top and low streams: discarded (it needs a second
  encode, a lossy top cannot be completed by low bits, and what the screen shows could no longer be controlled).
* 2026-11-10: the browser decodes the OQ view through WebCodecs; dav1d only as a fallback when there is no choice.
  D ≤ 10 at its own depth, the depth cut only for D > 10; no reduced-depth (8-bit) preview. Every encoder setting
  used must be known, sourced and backed by theory before its results count; results are audited for confounds of
  that kind (the low-delay settings without lookahead or alt-ref frames, used in every G result so far).

## Pointers

`docs/av1/` (`payload-format.md`, `MAINBASE.md`, `queue.md`), `docs/decode/README.md`, `docs/FIXTURES.md`,
`docs/transport/`, `docs/adr/disk-access.md`, `lab/`; branches `claude/av1-unified-mainbase`,
`claude/av1-quality-metrics:lab/av1/metrics/README.md`, `claude/av1-quality-profiles:lab/av1/profiles/README.md`,
`claude/av1-noise-point:docs/av1/noise-point.md`, `claude/av1-svc-preview`, `claude/line-server`.
