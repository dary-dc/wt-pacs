# What may the client say about the optimal-quality picture's quality, and when should it fetch the exact frame unasked?

**Question:** the client shows every viewer an optimal-quality picture at one Q. Is that Q visually lossless at the
windows readers use, what may the label claim, and should a narrow window fetch the exact frame without a request?
This file is the client's reading only: which Q the ingest codes, and the noise rule that picks it, belong to the
codecs line (`docs/lines/codecs.md`).

*Folded 2026-11-14. Sources, each cited where used: window width against Q
(`claude/av1-window-q:docs/av1/window-q.md` §Verdict, §4, `bb762be5`); how visual losslessness is established
(`claude/av1-vl-metrics:docs/av1/vl-metrics.md` §Answer, §4, 2026-11-09, `b86628d6`); the noise ratio as a criterion
(`claude/av1-noise-ratio:docs/av1/noise-ratio.md` §Verdict, `0a9d33ca`); the harvest of 2026-11-10
(`claude/docs-lines-3:docs/lines/optimal-quality.md` §What the harvest changes, `14ad30c3`;
`claude/docs-lines-3:docs/lines/codecs.md` §Fixtures, §AV1 harvest, `c1b23c64`); the corrections from the quality
audit (`claude/av1-corrections:docs/av1/corrections.md` §1, §3, §5, `2e4efdfc`); and the automatic exact request as
an option (`claude/direction:docs/lines/optimal-quality.md` §4 item 6, `b50be346`). What binds lossy viewing at all is
[`rules-for-showing-lossy-pictures.md`](rules-for-showing-lossy-pictures.md).*

Fixtures, unless a line names fewer: 19 DBT volumes of one dataset (EA1141, systems A, B, C, five each, four of a
second content), three of them timed (`dbts_a1`, `dbts_b1`, `dbts_c1`); two TRUS sweeps; stored form (not the depth
cut). No breast ultrasound cine or ABUS, so nothing here speaks for them.

**Terms, as the sources use them.** σ, the frame's noise in the finest band (Immerkær's estimator); e, the RMS coding
error; e_N, that error through the same band; the **noise rule**, the codecs line's choice of Q per (series, G) by
e_N ÷ σ; its **bar**, the worst frame's e_N ÷ σ it must stay under, 1.00 (strict) or 1.03 (the estimator's own error);
a **display level**, one of 256 steps of a LINEAR window of width W, so an error e shows as about e · 255 ÷ (W − 1)
levels.

## How visual losslessness is established (sources, 2026-11-09)

Only by **readers**: an alternating (flicker) comparison of exact and lossy on a calibrated display, per image. No
guideline states a limit as a metric; every number a guideline gives is a compression ratio tested on 2D JPEG and
JPEG 2000. Against readers, PSNR tracks visual losslessness on CT about as well as MS-SSIM, HDR-VDP better, all at a
fixed clinical window. **PSNR alone cannot claim it**: its peak and pooling are global and it does not see the window.
No metric has been validated against readers on DBT, breast ultrasound cine, 10–12-bit video or AV1 (some CT studies
read as abstracts only). At most a claim here could say "the coding error stays within the frame's own noise at Q, on
these series; readers have / have not confirmed it" (`vl-metrics.md` §4).

## What the measurements show (measured on committed rows; derived where said)

* **Under the noise, at every width.** A window scales e_N and σ by the same factor, so a test that holds at one width
  holds at every width (except where the window clips). At Q 8 every frame keeps e_N ≤ σ on all 5 B volumes, 5 of C,
  4 of the second content and 2 to 3 of A's 5 (all 5 at Q 4); TRUS keeps it to Q 4.
* **Not under one display level.** Q 8's RMS error reaches one level only at W 4 117–4 267 on 12-bit series (range
  4 096), 1 079–1 126 on 10-bit, 345–355 on TRUS. At the header presets Q 8 moves **81–87 % of shown pixels by ≥ 1
  level** and 47–66 % by ≥ 2 (median frame), largest moves 26–44 levels. **The noise is the same size**: 4.5–5.0
  levels on 12-bit DBT, 2.0–2.7 on 10-bit, 1.7 on TRUS, against Q 8's e_N of 4.3–4.6, 1.8–2.1 and 1.2. Keeping the RMS
  error under one level at every preset takes **Q 1–2 on 12-bit DBT (0.64–0.65 of HTJ2K's bytes, against Q 8's
  0.09–0.11)** and Q 4 on 10-bit DBT and TRUS (0.37–0.53 against 0.18–0.34).
* **Q 8 is a candidate, not visually lossless** (the harvest, 2026-11-10). The noise rule picks Q 8 for two of the six
  timed (series, G) cells, `dbts_b1` G 16 and `dbts_c1` G 1; it picks `dbts_a1` Q 4, `dbts_b1` G 1 Q 12, `dbts_c1`
  G 16 Q 4. On `dbts_a1` Q 8 passes the 1.03 bar and fails the strict 1.00 (worst frame 1.0107, *derived*). Both bars
  pass a coding that deletes the fine-band noise outright, since that reads e_N = σ (*derived*), so neither is
  evidence of visual losslessness.
* *Corrected 2026-11-11 (quality audit):* "**a higher Q does not**" meet the noise is too strong. The quality study's
  anchor is Q 12 on 3 of system B's 5 volumes, and integer-Q arms of the noise rule hold at Q 9 (`dbts_a3`, `a4`),
  Q 13 (`dbts_b4`) and Q 12 (a 10-bit second-content set). The window study's "never higher" holds on the 12-bit
  volumes only. It also assumed the residual's RMS does not depend on the grey level; tile σ rises with signal (r
  0.58–0.90 on the three timed volumes), so a narrow window's shares may be wrong either way.
* *Corrected 2026-11-11:* σ "13–18" (A and C) and "4.4–6.7" (B) are the profiles run's Haar MAD. The noise rule's
  Immerkær estimator reads A and C **10–18** and B **3.4–5.7** by frame; the two differ by 1.08–1.44×, not a constant.
* **At the rule's Q the encoder removes noise rather than adding error** (κ ≈ −0.7, *derived* from a model, not
  measured). A quantizer that removes noise of σ also removes faint signal spread over its coefficients: the model
  predicts no loss for masses and a possibly large one for small, faint calcifications. Untested; the model-observer
  protocol (`noise-ratio.md` §5) is not run. The ratio is "a sound guard and a weak criterion", weakest under the
  flicker test.
* **The depth cut's cost in the window is unmeasured.** *Corrected 2026-11-11:* "the cut costs about 0.3 dB and saves
  6–7 % at equal Q" is the top-10 study's one Q 8 row on all-sample PSNR, which counts the air (`dbts_b1` Q 8: 52.05
  dB all-sample, 47.43 in-window), outside that study's Q 12–40 arms; banding (CAMBI) not run. The cut stays justified
  by the decode route alone ([`browser-av1-profile-support.md`](browser-av1-profile-support.md)).

## What the label may claim

The label *Optimal quality* is right; *visually lossless* or *diagnostic* is not, until readers (the harvest). The
glossary's row *optimal quality* and the optimal-quality line's goal still say "visually lossless" (reported to their
owners). Two yes/no questions put to the owner on 2026-11-10 have no answer recorded: stop describing the view as also
for diagnosis until readers confirm it; and whether the view may be temporally denoised and the bar be 1.00 or 1.03
(`claude/docs-lines-3:docs/lines/codecs.md` §Open 0 items 1, 4, 9; `corrections.md` §What is not corrected here). The
reconstruction digest's coding error is a stated number, never a verdict
([`optimal-quality-reconstruction-digest.md`](optimal-quality-reconstruction-digest.md)).

## An automatic exact request on narrow windows (proposal, derived thresholds)

Narrow windows show the coding error most. Today the exact frame comes on an explicit request; fetching it when the
window is narrow (or in a reading mode) is an option to compare. It needs a number X of display levels readers
accept; at Q 8 it fires below W = 1 + 255 · e ÷ X (`window-q.md` §4):

| X | 12-bit DBT | 10-bit DBT | TRUS |
| --: | --: | --: | --: |
| 1 | every width up to the full range | every width | every width |
| 2 | 2 100–2 130 | 540–560 | 175–180 |
| 4 | 1 050–1 070 | 270–280 | 90 |

X 1 fires everywhere, so it is the exact profile under another name; X 2 fires on every DBT preset; X 4 on 35 of 36
12-bit presets and on no 10-bit one. Its per-frame input exists in the built coding error (its RMS in display levels
at the current window, on the overlay). X is the readers', not an agent's; none is chosen.

## Verdict, with its scope

On 19 DBT volumes and two TRUS sweeps of one dataset, stored form: Q 8 keeps the coding error within the frame's own
noise on most volumes at every width, never under one display level at a narrow window, and is not shown visually
lossless by anything measured. Only a reader test decides; none has run.
