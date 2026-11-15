# AV1 study corrections, from the two audits

*Row AV1-CORRECT, 2026-11-11. Docs only: nothing was encoded, decoded or timed. The claims come from
`claude/av1-audit-quality:docs/av1/audit-quality.md` (cited **QA F1–F13**) and
`claude/av1-audit-decode:docs/av1/audit-decode.md` (**DA 1–20**); the list of owed corrections from the AV1 harvest,
`claude/docs-lines-3:docs/lines/codecs.md` §AV1 harvest (2). Every number below is quoted from an audit, which marks
each as derived from committed rows or read in code; none is new.*

The rule followed is [`../adr/disk-access.md`](../adr/disk-access.md) §2 and §11: a retracted claim is corrected
where it stands and says what it used to read. Main's one affected file, [`../lines/codecs.md`](../lines/codecs.md),
is corrected in place on this branch. Every other study lives on its own branch, which this row may not push. For
each one, this file quotes the passage as it stands (branch, file, line, at the commit named) and gives the text to
put in its place. Its owner branch applies that text as it is, and once every entry is applied this file can go.

**Fixtures, for every entry.** 19 DBT volumes, all from the one EA1141 dataset (systems A, B, C, five each, and four
content-2 volumes), three of them timed (`dbts_a1`, `dbts_b1`, `dbts_c1`); two TRUS sweeps. No lossless breast
ultrasound cine or ABUS. Every timing was taken on a 4-core cloud host without a GPU, headless, with software decode.

**Terms.** As the audits use them. **Bar**: the worst frame's e_N ÷ σ that an anchor or rule must stay under, 1.00
(the quality study's anchor (a)) or 1.03 (the noise rule's P1). **The rule's Q**: the noise rule's candidate Q for a
(series, G), noise point §P4.

## 1 · The noise rule — `claude/av1-noise-point:docs/av1/noise-point.md` (at `991c298b`)

**§Verdict, lines 9–11 and 24–27 (QA F5, F6).** Stands:

> where x\* = **4.93 at G 1 and 4.64 at G 8 and 16**.
> …
> With one family left out at a time, it overshoots by one rung on 1 cell at each G. The worst frame there is
> e_N ÷ σ 1.005 and 1.000, inside the estimator's own 3 % error.

Put in its place:

> where x\* = **4.8 ± 0.15** (the estimator's 3 %) at every G. *Corrected 2026-11-11 (audit F5, F6):* this read
> "4.93 at G 1 and 4.64 at G 8 and 16", two in-sample minima of one frame each (`dbts_c1` top-10, Q 8; `dbts_b1`,
> Q 12) set to four decimals; a held-out `dbts_a3` frame already fails at x 4.802 (§Noise-point protocol, measured).
> The separate G > 1 value is not a property of inter coding that the rows resolve, and it makes G 16 cost 2.2–3.0×
> G 1's bytes on `dbts_b1` and `dbts_c1` (rule Q 12 · 8 and 8 · 4; 0.101 · 0.216 and 0.096 · 0.284 of HTJ2K).
> One x\* over G 1 and G 16 frames together, per stream depth, is owed and needs no encode.
> …
> With one family left out at a time, it overshoots by one rung on 1 cell at each G, worst frame 1.005 and 1.000.
> The bar the rule meets is **1.03**, the estimator's own error on integer frames of known σ (§8), not 1.

**§Verdict, lines 40–41, Owed (QA F5).** Stands:

> * the held-out test (§8) on shard 3's five uncoded DBT series;

Put in its place:

> * ~~the held-out test (§8)~~ done 2026-11-09 (§Noise-point protocol, measured): P1 and P3 hold on 10 of 10 cells of
>   five DBT series, worst frame 0.888–0.969 at the rule's Q. Its five series come from systems already in sample, so
>   it does not leave a scanner or a dataset out (audit F8). *Corrected 2026-11-11: this line still listed it as owed.*

## 2 · The quality study — `claude/av1-quality-metrics:lab/av1/metrics/README.md` (at `2f04f648`)

**§Quality metrics, measured, Verdict, line 2799–2801 (QA F1, F4).** Stands:

> the lossy AV1 view keeps part of the frame's fine-band noise to Q 8 (B: 8–12, A: 4–8)

Put in its place:

> the lossy AV1 view keeps part of the frame's fine-band noise to Q 8 (B: 8–12, A: 4–8) at the bar 1.00. *Corrected
> 2026-11-11 (audit F1):* that bar sits inside the estimator's 3 % error. The first failing rung's worst frame is
> within 1.1 % of 1 on five volumes and within 3 % on five more, so the anchor's rung (2–3× in bytes) is set by a
> difference the estimator cannot see. At the noise rule's bar of 1.03, every 12-bit volume sits at Q 8 and the
> 10-bit ones move to Q 12–16 (audit F1's table). Both bars pass a coding that deletes the fine-band noise outright,
> since that reads e_N = σ (audit F4), so neither is evidence of visual losslessness.

**Same section, lines 2879–2882, "G 16 against G 1" (QA F2).** Stands:

> at the noise anchor the two are within 0.015 of each other except where the anchor moves a rung

Append to that bullet:

> *Added 2026-11-11 (audit F2):* every figure in this bullet is an equal-Q reading. G 16 ÷ G 1 at equal Q is
> 0.93–1.01 at Q 8, 0.77–0.94 at Q 12 and 0.58–0.85 at Q 16 over the 19 DBT volumes; at the interpolated noise anchor
> it is 0.84–0.94 on `dbts_a1`, `a3`, `b1`, `b2`, `c1`. "G saves almost nothing" holds only at Q 8, the rung below
> the 2.4–4.2× byte cliff, and only at lag 0.

## 3 · Window width — `claude/av1-window-q:docs/av1/window-q.md` (at `bb762be5`)

**§Verdict, line 61 (QA F11).** Stands:

> * **Never higher.** Above Q 8 the error exceeds the noise.

Put in its place:

> * **Not higher on the 12-bit volumes.** *Corrected 2026-11-11 (audit F11):* this read "Never higher. Above Q 8 the
>   error exceeds the noise", a statement about the ladder's rungs. The quality study's anchor is Q 12 on 3 of system
>   B's 5 volumes, and the noise rule's integer-Q arms hold at Q 9 (`dbts_a3`, `a4`), Q 13 (`dbts_b4`) and Q 12
>   (`dbt10_d`). The rung above Q 8 that still holds depends on the series and the bar (§1 of
>   [`corrections.md`](corrections.md) on `claude/av1-corrections`).

**§What it does not show, line 101 (QA F11).** Stands:

> and it assumes the residual's RMS does not depend on the grey level.

Put in its place:

> and it assumes the residual's RMS does not depend on the grey level. *Added 2026-11-11 (audit F11):* the noise
> rule's tiles show that the noise does: tile σ rises with signal, r 0.58–0.90 on the three timed volumes (noise point
> §P4). So the sweep's shares are a model's, and in a narrow window they may be wrong in either direction.

## 4 · Reduced depth — `claude/av1-preview-depth:lab/av1/metrics/preview-depth.md` (at `a52fdd88`)

**Line 396 (QA F10, F13).** Stands:

> P5 fails on `dbts_b4` and `dbts_b5`, the two B volumes with the least noise (σ 2.4 and 1.9)

Put in its place:

> P5 fails on `dbts_b4` and `dbts_b5`. *Corrected 2026-11-11 (audit F10, F13):* this called them "the two B volumes
> with the least noise (σ 2.4 and 1.9)", a σ that no estimator here produced. This file's rows read B 3.4–5.6, and the
> quality study's Immerkær σ is 5.60 (`dbts_b4`) and 3.65 (`dbts_b5`). What does set those two apart is unexplained
> (*unverified*); one candidate is that lossless AV1 is 0.743 and 0.775 of HTJ2K there against 0.94–0.95 elsewhere
> (profiles §1b, line 792). G 16, lag 0 only.

## 5 · The top 10 bits — `claude/av1-top10-why:lab/av1/profiles/top10.md` (at `c2b1c954`)

**Line 7 (QA F12).** Stands:

> Matched on PSNR, the top 10 bits are 0.93–1.04× the 12-bit stream's bytes.

Put in its place:

> Matched on all-sample PSNR at Q 12–40, the top 10 bits are 0.93–1.04× the 12-bit stream's bytes. *Added 2026-11-11
> (audit F12):* all-sample PSNR counts the air (`dbts_b1` Q 8: 52.05 dB all-sample, 47.43 in-window), and the
> optimal-quality rung Q 8 is outside these arms; its only Q 8 reading is the campaign row, 0.928× at −0.28 dB.

## 6 · The optimal-quality ingest — `claude/oq-ingest:docs/av1/payload-format.md` §Optimal quality (at `36508b0a`)

**Line 265 (QA F2, F7).** Stands:

> G 16 against G 1: at Q 8, 1.2 % fewer bytes on `dbts_b1` and `dbts_c1`, 0.2 % more on `dbts_a1`;

Put in its place:

> G 16 against G 1 at equal Q (not equal quality, which this run did not measure): at Q 8, 1.2 % fewer bytes on
> `dbts_b1` and `dbts_c1`, 0.2 % more on `dbts_a1`. *Added 2026-11-11 (audit F2, F7):* Q 8 is the rung below a
> 2.4–4.2× byte cliff, and it is not the noise rule's Q on these volumes except `dbts_c1` at G 1. At the rule's Q the
> view is 0.10–0.28 of HTJ2K's bytes, not this table's 0.07–0.22.

## 7 · The profiles study — `claude/av1-quality-profiles:lab/av1/profiles/README.md` (at `1232918d`)

**§Bytes, line 784 (QA F2).** Stands:

> at Q 2 and 8 the G = 16 gain is −1.2 to +6.8 %, at each series' crossover rung

Put in its place:

> at equal Q (every gain in this paragraph is at equal Q, not equal quality: audit F2), at Q 2 and 8 the G = 16 gain
> is −1.2 to +6.8 %, at each series' crossover rung

**§Profiles decode, measured (amended), the access-pattern table and its *Read*, lines 2496–2522 (DA 1, 2, 7, 13).**
Insert above the table:

> *Corrected 2026-11-11 (decode audit 1, 2, 7, 13).* Four things qualify every row below.
> (1) **4×** caps each thread, not the cores (`throttleTree` without `cores`, `decode_block.mjs:93`). Multi-threaded
> WebCodecs therefore gets several quarter-CPUs against single-threaded OpenJPH's one, so the 4× rows are not a slow
> device. "WebCodecs in order at 4× at or under one H" (0.81–0.97) reads the thread count; a slow device's speed is
> unmeasured.
> (2) The **lossy clock** carries `back()`, a JavaScript pass that allocates and loops over every sample, even at
> shift 0, and whose result is discarded; the H clock has none. Taken off the clock, the coarse rungs move to about
> 0.77–1.06 and Q 8 stays above one frame (`dbts_a1` ~1.55, `dbts_c1` ~1.81; *derived* by the audit from a Node
> timing of `back()` on another host).
> (3) Each **WebCodecs jump** opens a new `VideoDecoder`, about 0.2–0.25 H of start-up, which the product does not pay.
> (4) **"1.05–2.04" at G 1, 1×** spans three rungs a set. At Q 8 only `dbts_a1` and `dbts_c1` have cells (1.824, 2.040,
> top-10-bit stream); `dbts_b1`'s lowest rung is Q 16 (1.714), and the 1.05 end is `dbts_a1` Q 32, "not decided".
> The Chromium version is recorded per block, not per row (141.0.7390.37 by §Profiles decode, measured).

**§Profiles decode, the residual row: "residual + add costs 1.4–1.7× an HTJ2K frame", line 2430 (DA 3).** Append:

> *Added 2026-11-11 (decode audit 3, 5):* the residual's clock spans the JavaScript add and H's does not. Aligned with
> the other two residual harnesses, the residual's decode alone is 1.02–1.07 HTJ2K frames and the add 0.3–0.4 more.
> The residual is dropped (the owner, 2026-11-09); this stands only as a record.

## 8 · Residual apart — `claude/av1-residual-apart:lab/av1/delivery/residual/README.md` (at `6a2994f8`)

**§Residual apart, measured: the DBT volumes, lines 340–344 (DA 4, 12).** Stands:

> **The rule, as written.** At row 17's quality (bold), 1× and 4×, all six DBT cells read **the same** (medians
> 0.973–1.004).

Put in its place:

> **The rule, as written.** At row 17's quality (bold), 1× and 4×, all six DBT cells read **the same** (medians
> 0.973–1.004). *Corrected 2026-11-11 (decode audit 4):* that ratio divides by an H that carries a JavaScript pass
> over every sample into a fresh array (`apart.js:117-125`), which costs what RA's add costs (H − R 6.2 · 24.9 ms,
> RA − R 5.40 · 24.6 ms on `dbts_a1`, `dbts_b1`, CRF 20, 1×). Against a bare HTJ2K frame the residual plus its add is
> about 1.3–1.6 frames (RA ÷ R 1.32 · 1.58, *derived*), not "the same". The 960/960 exactness checks stand. The
> residual is dropped; this stands only as a record.

**§Residual apart protocol, Pins, lines 140–142 (DA 12).** Append:

> *Added 2026-11-11 (decode audit 12):* these pins are the earlier §Decode time's. §Residual apart, measured ran
> Chrome for Testing 153.0.8010.12 and the product's OpenJPH build with a JavaScript pass in H (its §Host).

## 9 · Profile carriers — `claude/av1-profile-carriers:docs/av1/profile-carriers.md` (at `339e4fcc`)

**Lines 84–86 (DA 4, 16).** Stands:

> the residual's decode plus the add, with the lossy frame on screen, **0.97–1.00× an HTJ2K frame** on the three
> volumes (24.9 · 72.8 · 26.3 ms at 1×), "the same" by its rule, 5 % not resolved.

Put in its place:

> the residual's decode plus the add, with the lossy frame on screen, 24.9 · 72.8 · 26.3 ms at 1×, read there as
> 0.97–1.00× an HTJ2K frame. *Corrected 2026-11-11 (decode audit 4, 16):* that HTJ2K arm carried a JavaScript pass;
> aligned, the residual plus its add is 1.3–1.6 frames, in line with this file's own amended arm (1.37–1.40). Every
> "× HTJ2K" in this file divides by the `@cornerstonejs/codec-openjph` package, whose range pass the product no
> longer runs, so it understates HTJ2K's lead by up to 21–31 %. Ratios between AV1 carriers are unaffected.

**Line 156 (DA 16).** In the table's "separate" column, "OpenJPH-WASM for the residual or frame (the product's)":
replace "(the product's)" with "(the package, not the product's build)".

**C3 on `dbts_b1`, line 474 (DA 17).** After "1.74 · 1.91 · 1.58×", add: "asks 4–8 alone give ~1.35×; the third
ask's 324.8 ms is a transient (*derived*, `results/carriers-rows.jsonl`); 'refuted' stands".

## 10 · The SNR preview — `claude/av1-snr-preview:docs/av1/snr-preview.md` (at `eb7e19c4`)

**Lines 609–611 and 306 (DA 6).** Stands:

> Against `sep`, `two` has fewer bytes to exact (`sep` 1.07–1.47 of HTJ2K, `two` 1.02–1.08) but is decided slower,
> 1.04–1.11× (ratio of medians, *derived*).

Put in its place:

> Against `sep`, `two` has fewer bytes to exact (`sep` 1.07–1.47 of HTJ2K, `two` 1.02–1.08), and its time is a tie.
> *Corrected 2026-11-11 (decode audit 6):* this read "decided slower, 1.04–1.11×". `two`'s exact-stage clock spans
> `decodeFrame` plus the JavaScript add, and `ctrl`'s spans `decodeFrame` alone. With each block's median add taken
> off, the ratio is 0.98–1.02 in all 18 cells (*derived*). So `two` dominates `sep` to exact on bytes.

**Line 697 (DA 16).** Stands: "every AV1 carrier decodes 2.8–10× slower than HTJ2K". Append: "(against the
package's HTJ2K, which carries a range pass the product no longer runs; against the product's build the gap is up
to 21–31 % wider)".

**SVC dominance (DA 19)**, wherever `svc`'s dominance is stated: "dominance counts bytes and time, not fidelity: a
quarter-size q 40 base at 38.0–38.7 dB upscaled, against a full-size Q 24 preview at 45.8–46.5 dB".

## 11 · Decode notes — `claude/av1-unified-mainbase:docs/decode/README.md` (at `696c15d6`)

**Lines 2015–2016 (DA 20).** Stands: "Removing the flush measured −7 to −20 % at 1× and −3 to −28 % at 4×, exact
(row WCLAT, other content)." Put in its place: "Removing the flush measured −7 to −20 % at 1× and −3 to −28 % at 4×
(row WCLAT, other content). *Corrected 2026-11-11 (decode audit 20):* those arms also differed in
`optimizeForLatency`; the flush alone waits 1.3–2.0 ms a frame at 1× (line 1710, §keyParse)."

**Line 2883 (DA 20).** Stands: "**The fixtures are synthetic.**". Prefix: "*Corrected 2026-11-11 (decode audit 20):*
no longer true of the AV1 timings, which use three EA1141 DBT volumes; true of the rows this list indexes."

**§Decode time against HTJ2K, wherever "× an HTJ2K frame" is quoted (DA, §The HTJ2K frame is not one unit).** Add
once: "the HTJ2K unit here is the package through the decoder worker (decode, range pass, XXH3, messaging) on
Chromium 141.0.7390.37. It cannot be set beside a ratio from another study, which uses one of three other units."

**Merge-free (DA 18).** Beside S ÷ W2: "against R, which shares S's buffer reuse, S is 0.82–0.92; 'not proposed'
stands with a smaller margin."

## 12 · SVC preview — `claude/av1-svc-preview` (`lab/av1/delivery/scalable/tool/svc-results*.md`, `svc-rule.md`)

**4× verdicts (DA 1, 15).** Add once to `svc-rule.md` §Verdict: "4× caps each thread, not the cores, and the ±0.3–0.4 %
A/A that judges the 4× cells comes from an arm bound by the 50 Mbit/s link, while AV1 is bound by decode. A cell such as
1.069–1.070 against 1.10 is not resolved by that A/A."

## What is not corrected here

* The bar itself (1.00 or 1.03) and whether the OQ view may be temporally denoised are the owner's decisions
  (harvest §Open 0, decisions 1 and 4). The corrections state both readings and choose neither.
* QA F8 (one dataset) and DA 11 (no phone, no hardware decoder) correct no sentence. They are limits that every
  entry above already names.
* The three findings that matter most for optimal quality get pre-registered protocols in
  [`audit-protocols.md`](audit-protocols.md).
