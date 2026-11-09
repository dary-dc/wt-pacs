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
  lowest frame noise σ_min. Valid for the DBT fixtures only; not for TRUS or MR. The latest commit reports the held-out
  test (P1, P3) holding on five DBT series, while the doc's Verdict still lists that test as owed: reconcile.
* **Depth:** the client keeps full depth for windowing. WebCodecs gives no 12-bit samples; 12-bit goes through
  dav1d-WASM (full depth, slower).
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
3. An idea raised 2026-11-09, undecided: code optimal quality, split its decoded samples into top and low bits, send
   the top, the low only on request (target: the optimal-quality image, not lossless).
4. Owed to a GPU machine or a phone: hardware decoders' exactness, reduced-depth paint timing, group arms.
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
  Q, G and depth.

## Pointers

`docs/av1/` (`payload-format.md`, `MAINBASE.md`, `queue.md`), `docs/decode/README.md`, `docs/FIXTURES.md`,
`docs/transport/`, `docs/adr/disk-access.md`, `lab/`; branches `claude/av1-unified-mainbase`,
`claude/av1-quality-metrics:lab/av1/metrics/README.md`, `claude/av1-quality-profiles:lab/av1/profiles/README.md`,
`claude/av1-noise-point:docs/av1/noise-point.md`, `claude/av1-svc-preview`, `claude/line-server`.
