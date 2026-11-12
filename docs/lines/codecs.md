# Codecs and lab

Last verified 2026-11-10 (the AV1 harvest of that morning: eight result branches read from `origin` to their verdicts;
no new measurement).

## Goal

HTJ2K and AV1, the server, the transport and the disk, investigated and measured to `CLAUDE.md` §Measurement. The PCS
encodes, so a codec finding is a recommendation to the PCS team and an input to the PACS line. Structural theory (what
follows from a format's definition or arithmetic) discards cheaply and names candidates; sizes and times are always
measured, and every result names its fixtures.

## State now

**Fixtures.** Every AV1 timing rests on three EA1141 breast tomosynthesis volumes, `dbts_a1`, `dbts_b1`, `dbts_c1`
(systems A and C 12-bit, B 10-bit), on one 4-core cloud host, headless, software decode, no GPU or phone. The quality
results cover 19 DBT volumes, all from the one EA1141 dataset (no second vendor or dataset), and two TRUS sweeps. σ is
quoted with its estimator: Immerkær's (the noise rule's) reads A and C 10–18 and B 3.4–5.7 by frame; the profiles
run's Haar MAD read 13–18 and 4.4–6.7, and the two differ by 1.08–1.44×, not a constant. No breast ultrasound cine or
ABUS exists among the fixtures ([`../FIXTURES.md`](../FIXTURES.md)); nothing below speaks for them.

* **Design chosen (2026-11-09):** every viewer sees the series' **optimal quality**, an AV1 view meant to be visually
  lossless; a reader's explicit request fetches the **exact** HTJ2K frame whole. Its build is
  [`optimal-quality.md`](optimal-quality.md). "Visually lossless" is still a metric's candidate, not a reader's
  finding (§AV1 harvest (1)).
* **Measured, Q 8, G 1, on the three volumes:** the view is 0.07–0.22 of HTJ2K's bytes. That is Q 8's figure, not
  the noise rule's: at the rule's Q the view is 0.10–0.28 and view plus exact frame 1.10–1.28× (*derived*, audit F7).
  Decode: §AV1 harvest (1) has what the audit left of "1.05–2.04 HTJ2K frames"; AV1 saves bytes, not decode time, at
  Q 8 at 1× on this host.
* **Depth and decode route:** WebCodecs decodes the OQ view; dav1d-WASM is a fallback only. D ≤ 10 is coded at its
  own depth; D > 10 by the depth cut to 10 bits, because WebCodecs gives no 12-bit samples in any engine
  (`claude/av1-webcodecs-profiles`). The cut's cost at Q 8 is not measured in-window (§AV1 harvest (1)).
* **Out of the top, not discarded:** a two-layer SVC preview; lossless AV1 as the exact form.
* **Discarded:** a layered three-layer carrier; preview and view as quality layers of one stream; top-first; HTJ2K
  resolution ladder and quality layers; lossless G > 1; a lossy top plus low stream; key parsing in place of
  WebCodecs' flush (tag `archive/av1-keyparse`); LCEVC.
* **Server and transport:** `claude/line-server` (#254) holds 13 results (congestion and disk designs, PGO, tail
  ping, GSO, and others); no default changed.

**Inputs, one line each** (state 2026-11-10; *measured* = encoded or timed, *derived* = arithmetic on committed rows,
*theory* = sources and reasoning only):

| input | PR | state | kind | pointer |
| --- | --- | --- | --- | --- |
| noise point | #317 → `av1-quality-metrics` | done: P1 and P3 hold on 10 of 10 held-out cells (5 DBT series), worst frame 0.888–0.969; σ on every frame; DBT only. Its top Verdict still reads "held-out test owed" | measured | `claude/av1-noise-point:docs/av1/noise-point.md` §Noise-point protocol, measured |
| window and Q | #323 → `av1-quality-metrics` | done: e_N ÷ σ is the same at every window width; one display level needs Q 1–2 (12-bit) or Q 4 (10-bit) | derived (presets measured in the rows) | `claude/av1-window-q:docs/av1/window-q.md` §Verdict |
| VL metrics | #325 → `av1-quality-metrics` | done: no metric is validated against readers on DBT, 10–12-bit video or AV1; only a flicker test establishes VL | theory (sources) | `claude/av1-vl-metrics:docs/av1/vl-metrics.md` §4 |
| noise ratio | #332 → `av1-noise-point` | done as theory; its model-observer protocol (§5) not run | theory, derived | `claude/av1-noise-ratio:docs/av1/noise-ratio.md` §Verdict, §5 |
| encoder settings | #331 → `main` | done: every flag sourced; lag 0 switches off the temporal filter, TPL and keyframe filtering | theory | `claude/av1-encoder-settings:docs/av1/encoder-settings.md` §2b, §9 |
| quality audit | #329 → `main` | done: 13 findings, 5 change a verdict (F1, F2, F4, F6, F7) | derived | `claude/av1-audit-quality:docs/av1/audit-quality.md` §Findings |
| decode audit | #334 → `main` | done: 20 findings, 6 change a verdict (1–4, 6; 2 at coarse rungs) | derived, code read | `claude/av1-audit-decode:docs/av1/audit-decode.md` §Findings |
| groups | #326 → `av1-quality-metrics` | shard 1 measured (`dbts_b1` slices 9–40 and three lossy-sourced clips, 151 cells); shard 2 (`dbts_a1`, `dbts_c1`, TRUS) owed, so §7's verdict is not reached | measured | `claude/av1-groups:docs/av1/groups.md` §Groups, measured |

## AV1 harvest (2026-11-10)

Docs only: the eight inputs above, read to their verdicts. Fixtures for every line below unless it names fewer: the
three timed DBT volumes, one host; quality readings on 19 EA1141 DBT volumes; no breast ultrasound cine.

**(1) What changes a claim the demo makes.**

* **Q 8 as the VL candidate on DBT.** Qualified, not overturned.
  * The noise rule's Q on the timed volumes is not Q 8 everywhere: `dbts_a1` Q 4; `dbts_b1` Q 12 (G 1) · Q 8 (G 16);
    `dbts_c1` Q 8 (G 1) · Q 4 (G 16) (*measured*, noise point §P4).
  * On `dbts_a1`, Q 8's worst frame is 1.0107 of σ: it fails the strict anchor (bar 1.00) and passes the noise
    rule's own bar of 1.03 (*derived*, audit F1). The line uses both bars; at 1.03 every 12-bit volume sits at Q 8 and
    the 10-bit ones move to Q 12–16.
  * e_N ≤ σ also passes a coding that deletes the fine-band noise: deleting it outright reads e_N = σ (*derived*,
    audit F4). The noise-ratio theory adds that at the rule's Q the encoder removes noise rather than adding error, and
    that removal may cost faint calcifications (*derived* from a model, untested; its §5 P3).
  * No metric has been validated against readers on DBT (*theory*, VL metrics). "Also for diagnosis" rests on a
    proxy until a flicker test runs.
* **The bytes in `optimal-quality.md`.** The Q 8 measurements stand as Q 8's. The design's headline "0.07–0.22 of
  HTJ2K" is not the rule's Q on any timed volume at G 1 but `dbts_c1`; at the rule's Q it is 0.10–0.28 (*derived*,
  audit F7). G 8 and G 16 at Q 8 save −1.2 to +0.2 %; that is an equal-Q reading below a 2.4–4.2× byte cliff, and at
  Q 12 G 16 ÷ G 1 is 0.77–0.94 (*derived*, audit F2).
* **WebCodecs as the route.** The route stands; two speed claims fall.
  * The only evidence that WebCodecs decodes under one HTJ2K frame (0.81–0.97 at 4×) comes from a throttle that caps
    each thread, not the cores; a slow device's speed is unmeasured, not favourable (*code read*, decode audit 1).
  * "1.05–2.04 HTJ2K frames" carries a discarded JS pass on the lossy clock and spans three rungs. At Q 8 only
    `dbts_a1` and `dbts_c1` have cells, both the top-10-bit stream: about 1.55–1.81 with the pass removed
    (*derived*, decode audit 2, 13). `dbts_b1` has no Q 8 cell there.
  * The exact ask's "1.01–1.03 HTJ2K frames" and the view's ratio divide by different HTJ2K units, on two Chromium
    versions; the unit the product ships is timed nowhere (decode audit, §The HTJ2K frame is not one unit).
  * Groups shard 1 timed `dbts_b1` O G 1 at Q 8 through WebCodecs at a mean 97 ms a frame on one host at 1×
    (*measured*); no ratio to an HTJ2K frame is taken there.
* **The depth cut's cost.** "About 0.3 dB and 6–7 % fewer bytes at equal Q" is the top-10 study's one Q 8 row, on
  all-sample PSNR, which counts the air (`dbts_b1` Q 8: 52.05 dB all-sample against 47.43 in-window); its arms ran
  at Q 12–40 (audit F12). Banding (CAMBI) was not run (F10), and λ scales differently at 10 and 12 bits (F9). The cut's
  in-window cost at Q 8 is unmeasured; it stays justified by the decode route alone.

**(2) Corrections owed in other documents** (not edited here; each is its owner branch's to make, in place):

| result | doc (branch) | correction | from |
| --- | --- | --- | --- |
| noise rule's top Verdict | `claude/av1-noise-point:docs/av1/noise-point.md` §Verdict (#317) | the held-out test is done; the bar is 1.03, not 1.005 / 1.000; quote x\* as 4.8 ± 0.15 | audit F5 |
| x\* at G > 1 | same | recompute x\* once over G 1 and G 16 frames, per stream depth; the separate G > 1 x\* makes G 16 cost 2.2–3.0× G 1 on `dbts_b1`, `dbts_c1` | audit F6, F9 |
| noise anchor per series | `claude/av1-quality-metrics:lab/av1/metrics/README.md` §5 | state one bar and re-read the anchors under it; "G 16 gains" as equal-Q readings | audit F1, F2 |
| "never higher than Q 8" | `claude/av1-window-q:docs/av1/window-q.md` §Verdict (#323) | the anchor is Q 12 on 3 of 5 B volumes, and integer-Q arms hold at Q 9 and Q 12–13; the sweep's grey-level-independent error is an assumption the tiles contradict (r 0.58–0.90) | audit F11 |
| reduced-depth banding | `claude/av1-preview-depth:lab/av1/metrics/preview-depth.md` | the σ 1.9–2.4 attribution of the two failing B volumes marked *unverified* | audit F10, F13 |
| top-10 cost | `claude/av1-top10-why:lab/av1/profiles/top10.md` | its "equal quality" is all-sample PSNR at Q 12–40 | audit F12 |
| G saving at Q 8 | `claude/oq-ingest:docs/av1/payload-format.md` §Optimal quality | "at Q 8, 1.2 % fewer bytes" is an equal-Q reading; refuse or label Q 0 (lossless by the AV1 specification) | audit F2; encoder settings §2b |
| profiles decode | `claude/av1-quality-profiles:lab/av1/profiles/README.md` §Profiles decode | the 4× throttle without `cores`; `back()` on the lossy clock; a fresh `VideoDecoder` per jump; Chromium version per row | decode audit 1, 2, 7, 12, 13 |
| residual apart | `claude/av1-residual-apart:lab/av1/delivery/residual/README.md` | 0.97–1.00 divides by an HTJ2K arm with a JS pass; aligned, 1.3–1.6 | decode audit 4 |
| carriers, SNR, SVC | `claude/av1-profile-carriers:docs/av1/profile-carriers.md`, `claude/av1-snr-preview:docs/av1/snr-preview.md`, SVC results (`claude/av1-svc-preview`) | the package's HTJ2K is not the product's; SNR's `two` slower than `sep` is the JS add (a tie); C3 on `dbts_b1` from asks 4–8 | decode audit 6, 15–17, 19 |
| decode notes | `claude/av1-unified-mainbase:docs/decode/README.md` | which HTJ2K unit each ratio uses; stale −7 to −20 % and "fixtures are synthetic" lines; merge-free S against R | decode audit 18, 20 |
| κ | `docs/glossary.md` (whichever branch merges second of `claude/av1-groups`, `claude/av1-noise-ratio`) | κ names two things: groups' share of a band's noise removed, noise ratio's error–noise correlation; one gets a new name | this harvest |

**(3) Do the low-delay settings confound the G results?** Partly, and less than the settings alone suggest.

* *Theory* (encoder settings §2b): `--lag-in-frames=0` switches off libaom's temporal filter, its alt-ref frames,
  TPL and keyframe filtering. `--min-q = --max-q` removes the finer q libaom gives an alt-ref, and `--cpu-used=6`
  prunes inter search. So "G saves almost nothing at Q 8" is a finding about low-delay libaom at speed 6 with a
  pinned q.
* *Measured* (groups shard 1, `dbts_b1` slices 9–40 only):
  * At equal in-window PSNR over the VL interval, the filtered alt-ref arms save 4.9–6.3 % of O G 1's bytes and O G 16
    saves 2.5 %, against a method resolution ε of 0.76 %.
  * At the noise anchor they save nothing. They cross e_N ÷ σ = 1 between Q 8 and Q 10, so their point is Q 8 at
    9.4–10.5 MB against O G 1's Q 12 at 7.05 MB: the filter spends the noise the anchor keeps.
  * They decode unevenly: the slowest frame is 3.4–5.2× the median (0.52–0.63 s on dav1d-WASM).
  * No arm is recommended over O G 1, so G 1 stays on this volume.
  * The noise swap places the cause in the slices' own noise: a shared noise pattern lets G 16 save 69–77 % at
    Q 4–12; a shuffled one changes nothing.
* *Not yet known:* systems A and C (shard 2 owed), and alt-ref with q free and objective delta-q (encoder settings
  T1). Also open: the alt-ref filter's strength (T2), a speed ladder past Q 8 (T3), and the in-loop filters' decode
  cost (T4).
* The confound is real in mechanism and small in bytes on the one volume measured. It decides nothing about G until
  the owner says whether a temporally denoised view still counts as the OQ view (§Open, decision 4).

## Open (ordered)

0. **The owner's decisions this harvest needs** (yes or no; each says what it changes):
   1. *One bar of 1.03 for the noise anchor?* Yes: every 12-bit timed volume reads Q 8 and 10-bit DBT moves to Q 12–16
      (0.04–0.10 of HTJ2K), on the plateau where audit F4 says the noise may be gone. No (bar 1.00): `dbts_a1`, `a2`
      move to Q 4 (0.27–0.28).
   2. *Keep Q 8 hard-coded for the demo, labelled a candidate not confirmed by readers?* Yes: the demo stands.
      No: code the rule's Q per (series, G), with bytes 0.10–0.28.
   3. *Quote the design's bytes at the rule's Q (0.10–0.28) instead of Q 8 (0.07–0.22)?* Yes changes the headline in
      this file and in `optimal-quality.md`.
   4. *May the OQ view be temporally denoised (alt-ref, keyframe filtering)?* Yes: G and alt-ref become levers
      (−5 to −6 % at equal PSNR on `dbts_b1`), and the noise rule needs a new definition. No: lag 0 stays, and
      G 1 stays for DBT.
   5. *Run groups shard 2 (`dbts_a1`, `dbts_c1`, TRUS; about 4.3 h on one 4-core host)?* Yes: §7's verdict for DBT
      becomes reachable.
   6. *Run the zero-encode re-reads first?* That is anchors under one bar, x\* over G 1 + G 16 per depth, and
      σ_out ÷ σ on existing cells (audit F1, F4, F6, F9). Yes settles the Q and G numbers without encoding.
   7. *Hold WebCodecs speed claims until the throttle is re-run with `cores` 1 and 2 and the lossy clock is fixed?*
      Yes: no "WebCodecs under one HTJ2K frame" claim until then (decode audit 1, 2).
   8. *Run the noise-ratio protocol (κ measured, model observer on calcifications) before any reader study?*
      Yes: it tests the removal worry cheaply first.
   9. *Stop describing the view as "also for diagnosis" until readers confirm VL?* Yes changes the design statement
      above and the demo's wording.
   10. *Ask the owner branches in (2) to make their corrections?* Yes: a session per branch, docs only.
1. **G at equal quality** (`claude/av1-groups`, #326): shard 2 and the collect without `--partial`; a structure-only
   source with no coding error of its own; a finer ladder at Q 8–12. Decode time in order matters more than jumps.
   No G is decided for DBT.
2. Harvest and review the AV1 result chain into `av1-unified-mainbase`: #290 → #305 → #317, #312; #283 → #306 → #314
   → #316; #288, #315, #318; now also #323, #325, #326, #332 (into `av1-quality-metrics` or `av1-noise-point`) and
   #329, #331, #334 (into `main`).
3. Explore noise detection at ingest (σ_min, its estimator's timing on the three volumes), then hand it to the PCS team.
4. Owed to a GPU machine or a phone: hardware decoders' exactness, reduced-depth paint timing, group arms, the OQ
   view's decode speed on a real slow device.
5. A note to the PCS team on G for AV1 cine; keep or remove the client's G > 1 path.
6. Held server defaults awaiting a yes or no, listed in `line-server`'s index (#254).
7. HTJ2K with resolution levels and tiles, a separate approach outside the demo (`claude/htj2k-tiles`, protocol
   landed).

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
`claude/av1-noise-point:docs/av1/noise-point.md`, `claude/av1-window-q:docs/av1/window-q.md`,
`claude/av1-vl-metrics:docs/av1/vl-metrics.md`, `claude/av1-noise-ratio:docs/av1/noise-ratio.md`,
`claude/av1-encoder-settings:docs/av1/encoder-settings.md`, `claude/av1-audit-quality:docs/av1/audit-quality.md`,
`claude/av1-audit-decode:docs/av1/audit-decode.md`, `claude/av1-groups:docs/av1/groups.md`, `claude/av1-svc-preview`,
`claude/line-server`.
