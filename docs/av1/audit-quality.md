# Audit of the AV1 quality results

*Row AV1-AUDIT-QUALITY, 2026-11-10. An independent audit, adversarial toward the results, of the seven studies the
optimal-quality design rests on. Nothing was encoded. Every number marked *derived* is arithmetic re-run here on a
study's committed rows; every other number is quoted from the study at the line given.*

## Method card

* **Audited** (branch : file, as fetched 2026-11-10):
  * the quality study, `claude/av1-quality-metrics:lab/av1/metrics/README.md` (cited **M**) and its rows
    `rows/shard-{1,2,3,4}.jsonl`, `rows/curves.tsv`;
  * the profiles bytes study, `claude/av1-quality-profiles:lab/av1/profiles/README.md` (**P**), rows
    `results/cells.jsonl`, `results/altref.jsonl`;
  * the noise rule and its measured protocol, `claude/av1-noise-point:docs/av1/noise-point.md` (**N**);
  * the window-width reading, `claude/av1-window-q:docs/av1/window-q.md` (**W**);
  * the reduced-depth reading, `claude/av1-preview-depth:lab/av1/metrics/preview-depth.md` (**D**);
  * the top-10 study, `claude/av1-top10-why:lab/av1/profiles/top10.md` (**T**);
  * the optimal-quality ingest's bytes, `claude/oq-ingest:docs/av1/payload-format.md` §Optimal quality (**O**).
* **Re-run here** (Python on the committed rows, no encode, no timing, so no host limit applies):
  1. every DBT frame's e_N ÷ σ (`frames[i].err_noise_band` ÷ the series row's `sigma[i]`), its worst frame per cell,
     and anchor (a) by noise read at a bar of 1.00 and of 1.03. At 1.00 it reproduces M's per-series table
     (M:2896–2953) on all 38 DBT (series, G) cells, which checks the re-read.
  2. G 16 ÷ G 1 bytes at equal Q, and at the median frame's e_N ÷ σ = 1, ln bytes interpolated linearly in that
     ratio between the two bracketing rungs (*derived*: the studies' own interpolation rule, T §Terms).
  3. The alt-ref arm's bytes against the lag-0 arms at the alt-ref cell's PSNR, ln bytes interpolated linearly in PSNR
     on `curves.tsv` (*derived*). The alt-ref rows carry the series-mean PSNR, `curves.tsv` the median frame's; the two
     differ by under 0.1 dB on the lag-0 cells where both exist.
* **Fixtures**, inherited and not widened: 19 DBT volumes, all from the one EA1141 dataset (systems A, B, C, five each,
  and four content-2 volumes, [`../FIXTURES.md`](../FIXTURES.md) §AV1 data), three of them (`dbts_a1`, `dbts_b1`,
  `dbts_c1`) timed; two TRUS sweeps. No lossless breast ultrasound cine or ABUS exists. Nothing here speaks for them.

**Terms.** As M §Terms. **Q**: libaom's `--cq-level`. **G**: frames per keyframe. **σ**: a frame's noise in the 3 × 3
Laplacian's band (Immerkær, M §4.4); **e_N**: the coding error in that band. **Anchor (a) by noise**: the highest
ladder Q at which every frame has e_N ≤ σ (M §5). **Lag 0**: `--lag-in-frames=0 --auto-alt-ref=0`, the setting of
every quality cell (M:97). **Alt-ref arm**: P's secondary arm, `--lag-in-frames=19 --auto-alt-ref=1`, G 16, bytes and
PSNR only (P:219, P:1720). **The cliff**: the rungs over which the coding starts deleting the noise, Q 8 → 12 on 12-bit DBT (bytes fall
2.6–3.4× at G 1) and Q 12 → 16 on 10-bit (Q 8 → 12 there 1.7–2.2×); above it e_N ÷ σ sits on a plateau of 1.02–1.09
(*derived*, M's rows).

## Verdict

**The owner's question: did lag 0 decide "G saves nothing at the VL point"?** Not by itself, as far as the rows can
say; the conclusion is decided by two other things, and alt-ref's effect on the measure that matters was never taken.

* **By PSNR, alt-ref does not change the Q 8 reading.** At Q 8, G 16, alt-ref is 37–59 % smaller than lag 0 but 1.9–2.1
  dB lower (P:1724–1738). At equal PSNR it is 1.02–1.07× the lag-0 G 16 stream and 0.87–0.95× the G 1 stream
  (*derived*). Above the cliff it does pay: 0.66–0.98× lag-0 G 16 at Q 16–32 (*derived*).
* **What decided it is the equal-Q reading at the rung below the cliff.** At Q 8, G 16 ÷ G 1 is 0.93–1.01 on the 19 DBT volumes because the
  bits code the noise, which the next slice cannot predict (neighbour-slice ρ 0.11–0.27). One rung up, at Q 12, it is
  0.77–0.94; at the interpolated noise anchor it is 0.84–0.94 (*derived*); N's integer-Q arms, at equal worst frame,
  read 0.99–1.00 on system A and 0.90–0.94 on the 10-bit series (N:502–555).
* **And the anchor itself cannot resolve G.** The noise anchor of a series moves a ladder rung, at 2–3× the bytes, on
  worst-frame differences of 0.001 against an estimator error of 3 %, in either direction between G 1 and G 16
  (F1).
* **Alt-ref is untested where it matters.** Its temporal filter removes noise, which is what e_N ÷ σ, display levels
  and JOD measure; none of them was run on the alt-ref streams (F3).

So "G saves nothing at the VL point on DBT" should read: *at Q 8 on the ladder, lag 0, −1 to 7 %; between Q 8 and Q 12,
6–16 % (derived, unmeasured at equal quality); alt-ref unmeasured at equal quality.* No G decision for DBT should
rest on the current rows. Three findings matter most for the optimal-quality design (§The three).

## Findings

Severity: **verdict** (changes a verdict a document states), **weakens** (the verdict stands on less than it says),
**cosmetic**. Decision: Q choice, G choice, depth cut, noise rule, VL claim.

| # | finding | severity | evidence | decision | cheapest measurement that settles it |
| --- | --- | --- | --- | --- | --- |
| F1 | The noise anchor is decided inside the estimator's error, and the ladder's 2–3× byte steps amplify it; G 1 against G 16 flips either way | **verdict** | Worst frame at the deciding rung, G 1 · G 16 (*derived*): `dbts_b1` Q 12 0.9989 · 1.0004 → anchors Q 12 · 0.101 and Q 8 · 0.216 (M:2910–2911); `dbts_a5` Q 8 1.0008 · 0.9996 → Q 4 · 0.279 and Q 8 · 0.088 (M:2908–2909); `dbts_a1` Q 8 1.0107 · 1.0076, `dbts_a2` 1.0075 · 1.0060 → Q 4 · 0.27–0.28 where `dbts_a3`, `a4` (0.958–0.970) get Q 8 · 0.10. Estimator error: "within 3 %" (M:144). At N's own bar of 1.03 (N:368) every A volume is Q 8 (0.074–0.102), B moves to Q 12–16 (0.041–0.101), and G 16 ≤ G 1 on every DBT cell (*derived*) | Q choice, G choice, noise rule | None: state the bar (1.00 or 1.03) once for the line and re-read M's anchors under it (done above, zero encodes). Then N's integer-Q arms (Q 5–16) at G 1 and G 16 on the 14 in-sample DBT volumes, interleaved: about 1.5 h on 4 cores (*derived* from N's 5 117 encode CPU s for 53 cells, N:488) |
| F2 | "G saves almost nothing at Q 8" is an equal-Q reading at the rung below a 2.4–4.2× byte cliff, presented as the VL point's verdict | **verdict** | G 16 ÷ G 1 at equal Q (*derived*, `curves.tsv`): Q 8 0.93–1.01, Q 12 0.77–0.94 (`dbts_a1` 0.772, `a3` 0.863, `b1` 0.936, `b2` 0.834, `c1` 0.860), Q 16 0.58–0.85, over the 19 DBT volumes. At the median frame's e_N ÷ σ = 1 (`dbts_a1`, `a3`, `b1`, `b2`, `c1`): 0.84–0.94. N's arms at equal integer Q and equal worst frame: `dbts_b4` Q 13 0.074 · 0.082, `dbt10_d` Q 9–12 −6 to −10 %, A Q 7–9 0 to −1 % (N:502–555). O's table makes the same equal-Q reading ("at Q 8, 1.2 % fewer bytes", O:265). P's crossover framing (P:784) is equal Q too | G choice | The same integer-Q arms as F1, read as bytes at equal worst-frame e_N ÷ σ |
| F3 | Every quality reading and the noise rule's G > 1 threshold rest on lag 0; the alt-ref arm was measured for bytes and PSNR only, and PSNR cannot tell its noise removal from error | weakens | Lag 0 on every cell (M:97, N:476–482, O:228–232). Alt-ref arm: Q 8 −37 to −59 % at −1.9 to −2.1 dB (P:1724–1738); at equal PSNR 1.02–1.07× lag-0 G 16, 0.87–0.95× G 1; at Q 16–32 0.66–0.98× lag-0 G 16 (*derived*). Its shown frames include 5-byte units (`altref.jsonl` `lossy`), displayed copies of temporally filtered frames, and its histograms carry 18 entries at qindex 0 that P leaves *unverified* (P:764). N's x\* at G > 1 is 6 % lower than at G 1, with the cause "*unverified*" (N:157). Lag 0 was chosen for the product's group model (decode 0 … k), not for quality (P:215–218) | G choice, noise rule, VL claim | Re-encode P's 15 alt-ref cells (Q 8, 16 on `dbts_a1`, `b1`, `c1` suffice: 6 cells, about 0.5 h) and run `cell.measure` on them; add an arm with the temporal filter off (`--arnr-strength=0`, flag name *unverified* against libaom 3.15.1's `arg_defs.c`) to separate the hidden reference from the denoising |
| F4 | e_N ≤ σ passes wholesale removal of the fine-band noise, and the 1.03 bar passes rungs where the noise is gone | **verdict** (on what "VL" means) | *Derived*: if the decoded frame were the noise-free signal, the residual would be the noise and e_N = σ, because Immerkær's √(π/2) · mean\|·\| equals the RMS for Gaussian noise. Measured plateau above the cliff: 1.02–1.09 (N:135–143, M:2861). Under N's P1 bar (1.03): `dbts_b4` Q 16 worst 1.028, 0 of 84 frames over (N:543) and `dbt10_d` Q 16 1.028–1.030 (N:555) pass, one and two rungs above the rule's Q 12 and Q 8. The documents say the anchor "marks the last Q that keeps part of the noise" (N:83); the design calls the view visually lossless "also for diagnosis" (`docs/lines/codecs.md`) | VL claim, noise rule, Q choice | σ of the decoded frame against the source's (σ_out ÷ σ, D already computes σ_out, D:527) on the existing cells, which says how much noise each Q keeps; then M §6's flicker test, the only test of visibility |
| F5 | The rule's x\* is an in-sample minimum set to four decimals from one frame, and held-out frames already moved it; the top Verdict was not corrected | weakens · cosmetic | x\* G 1 4.929 from one frame of `dbts_c1` top-10, G > 1 4.636 from one frame of `dbts_b1` Q 12 (N:154–155); "rounding up to 4.636 would let `dbts_b1`'s own failing cell through" (N:196). Held out: one `dbts_a3` frame fails at x 4.802 (N:446–449), "x\* is not a strict bound". N's top Verdict still lists the held-out test as owed (N:40–41) and the bound as 1.005 and 1.000 "inside the estimator's own 3 % error" (N:24–27), while §Measured states the bar is 1.03, not 1 | noise rule | None: correct N's top Verdict in place, quoting x\* as 4.8 ± 0.15 (3 %) and the bar as 1.03 |
| F6 | The rule's separate G > 1 threshold, fitted to one lag-0 frame, makes G 16 cost 2.2–3.0× G 1's bytes on two of the three timed volumes | **verdict** (G choice under the rule) | Rule Q at G 1 · G 16 (N:603–609): `dbts_b1` 12 · 8, `dbts_c1` 8 · 4. Bytes ÷ HTJ2K there (*derived*, M's rows): `dbts_b1` 0.101 · 0.216, `dbts_c1` 0.096 · 0.284. At G 16 the rule picks a rung below the measured anchor on 6 of 23 cells, at G 1 on 3 (N:165–167) | G choice, noise rule | Recompute x\* once over G 1 and G 16 frames together, with F1's bar; zero encodes |
| F7 | The design's headline bytes are quoted at Q 8 on all three timed volumes, which is not the rule's Q on any but one cell | weakens | "Measured, Q 8, G 1 … the view is 0.07–0.22 of HTJ2K's bytes; view plus the whole exact frame 1.07–1.22×" (`docs/lines/codecs.md`:21); O:259–263 codes Q 8 and 24 only, "The quality at each Q is not measured here". At the rule's Q (N:603–609) the view is 0.27 (`dbts_a1`, Q 4), 0.10 · 0.22 (`dbts_b1`, G 1 · 16), 0.096 · 0.28 (`dbts_c1`) of HTJ2K's: **0.10–0.28**, view plus exact frame **1.10–1.28×** (*derived*). `dbts_a1`'s Q 8 worst frame is 1.0107: Q 8 fails the strict anchor there | Q choice | None: re-quote from M's rows at the rule's Q, or at the bar F1 settles |
| F8 | All DBT volumes come from one dataset; the leave-one-family-out test and the held-out test do not leave a scanner out | weakens | Content 2's four DBT volumes are EA1141 too (FIXTURES.md:358–372); their 12-bit and 10-bit sets match A/C and B in σ and windows (M:2896–2953). N's held-out five are three systems already in sample (N:339–342). Three timed volumes; no lossless breast ultrasound cine | every decision; VL claim | One DBT volume from another dataset or vendor through the rule and the anchor (14 encodes, under 1 h); no substitute exists for ultrasound |
| F9 | The rule assumes one curve h(x) across depths from the step alone, but the encoder's λ scales differently at 10 and 12 bits | weakens | N §2 (N:112): "Depth enters only through the table". T §2: λ₁₂ ÷ λ₁₀ 0.97 at Q 8, 1.13 at Q 12, 1.23 at Q 16 (T:92); "the same Q buys a *different quality*" (T:7); the 12-bit G 16 stream spends "up to 10 % more than [it needs] at equal PSNR" (T:240). x\* pools 12-bit and 10-bit-coded frames, and its G 1 minimum comes from a top-10 frame (N:154) | noise rule, G choice (12-bit inter) | x\* recomputed per stream depth on the existing rows; zero encodes. Near Q 8 the λ ratio is 0.97, so the effect there is a few per cent |
| F10 | The depth study's banding measure was not run, and its explanation of the two failing B volumes uses a σ no estimator here produced | weakens | "CAMBI, P3, P4 and §6's banding call are **not run**" (D:400); "`dbts_b4` and `dbts_b5`, the two B volumes with the least noise (σ 2.4 and 1.9)" (D:396), while D's own rows read B 3.4–5.6 (D:123) and M reads `dbts_b4` 5.60, `dbts_b5` 3.65 (M:2868). What does set those two apart: lossless AV1 is 0.743 and 0.775 of HTJ2K there, 0.94–0.95 elsewhere (P:792). G 16, lag 0 only | depth cut | None for the attribution (correct D in place as *unverified*); CAMBI on D's existing streams for banding. The owner's full-depth decision does not depend on D, so the cut stays closed |
| F11 | "Never higher than Q 8" is a ladder statement that later integer-Q arms contradict, and W's sweep assumes an error independent of grey level, which a sibling measurement shows false for the noise | weakens | W:61 "Never higher. Above Q 8 the error exceeds the noise"; M's anchor is Q 12 on 3 of 5 B volumes (M:2955–2972); N's arms hold at Q 9 (`dbts_a3`, `a4`, 0.995–1.009), Q 13 (`dbts_b4`), Q 12 (`dbt10_d`) (N:502–555). W:101 states its assumption; N's P4 measures tile σ rising with signal, r 0.58–0.90 (N:603–609) | Q choice, VL claim | None for the first (correct W in place). For the second, an in-window \|Δ\| histogram by signal tercile in `cell.py`, then the 294 cells re-encoded (W:110) |
| F12 | The top-10 study's "equal quality" is all-sample PSNR at Q 12–40 on two volumes; the optimal-quality rung, Q 8, is outside its arms | cosmetic | T:11, T:16. Its only Q 8 reading is the campaign row, top10 0.928× at −0.28 dB (T:99–101). All-sample PSNR counts the air: on `dbts_b1` Q 8 it is 52.05 dB against 47.43 in-window (`cells.jsonl`) | depth cut (closed) | None while the client keeps full depth; T's arms at Q 6–10 if a 10-bit view is ever reopened |
| F13 | Two σ estimators are quoted as one | cosmetic | `docs/lines/codecs.md` gives "σ 13–18 … σ 4.4–6.7", the Haar MAD of P (P:810–826); the rule and the anchors use Immerkær's, A and C 10–18 and B 3.4–5.7 by frame (M:2804). Their ratio on DBT is 1.08–1.44, not a constant (N:281–284). The brief's "`b4` and `b5` 1.9–2.4" survives as *unverified* in N:344 and as a cause in D:396 | noise rule (input), VL claim | None: name the estimator wherever σ is quoted |

## Notes on the findings

**F1, the margin.** The first rung that fails, worst frame (*derived*): within 1.1 % of 1 on five volumes (`dbts_a1`
Q 8 1.0107 · 1.0076, `a2` Q 8 1.0075 · 1.0060, `a5` Q 8 G 1 1.0008, `b1` Q 12 G 16 1.0004, `b5` Q 12 1.0071 · 1.0069)
and within 3 % on five more (`dbts_b2`, `b3`, `b4`, `dbt10_d`, `dbt10_ea1141`: 1.016–1.030); on systems C, `a3`, `a4`
and the 12-bit content-2 volumes it is 1.031–1.090. On the first ten the anchor, and bytes differing 1.4–3.6×, is set
by a difference the estimator cannot see. Re-read at 1.03 (*derived*, rows of M):

| series | bar 1.00, G 1 · G 16 (Q · bytes ÷ HTJ2K) | bar 1.03, G 1 · G 16 |
| --- | --- | --- |
| `dbts_a1` | 4 · 0.268, 4 · 0.270 | 8 · 0.074, 8 · 0.074 |
| `dbts_a2` | 4 · 0.279, 4 · 0.279 | 8 · 0.089, 8 · 0.088 |
| `dbts_a5` | 4 · 0.279, 8 · 0.088 | 8 · 0.090, 8 · 0.088 |
| `dbts_b1` | 12 · 0.101, 8 · 0.216 | 12 · 0.101, 12 · 0.095 |
| `dbts_b2` | 8 · 0.150, 8 · 0.141 | 16 · 0.041, 12 · 0.061 |
| `dbts_b3` | 12 · 0.120, 12 · 0.106 | 16 · 0.065, 16 · 0.051 |
| `dbts_b4` | 12 · 0.096, 12 · 0.088 | 16 · 0.053, 16 · 0.046 |
| `dbts_b5` | 8 · 0.143, 8 · 0.139 | 12 · 0.076, 12 · 0.066 |
| `dbt10_d` | 12 · 0.110, 12 · 0.099 | 16 · 0.069, 16 · 0.055 |
| `dbt10_ea1141` | 12 · 0.126, 12 · 0.113 | 16 · 0.081, 16 · 0.066 |
| system C (5), `dbt12_c`, `dbt12_ea1141`, `dbts_a3`, `dbts_a4` | 8, unchanged | 8, unchanged |

At 1.03 the 12-bit volumes all sit at Q 8; the 10-bit ones move to Q 12–16, which F4 shows is on the plateau. Neither
bar is derived from visibility. The line uses both (M's anchor at 1.00, N's P1 at 1.03) and should use one.

**F2 and F3, why lag 0 is not the main lever at Q 8.** At Q 8 nearly every bit codes the noise, which is uncorrelated
from slice to slice, so no reference — lag-0 or alt-ref — predicts it; alt-ref's saving there comes with its PSNR loss,
which is the noise its filter removed. That makes the G question at the optimal-quality point a question about F4:
if keeping the noise is the definition, G can save at most the signal's share of the bits, measured at 0–10 % near
the anchor; if a reader accepts a temporally denoised view, alt-ref and G become large levers and the definition has
moved. Neither reading has been put to a reader.

## The three

1. **F4, what the criterion admits.** The optimal-quality view's Q comes from e_N ≤ σ, which an encoder that deletes
   the fine-band noise passes, and the rule's 1.03 bar passes 10-bit rungs where the noise is gone. Until σ_out ÷ σ is
   read and M §6's flicker test is run, "visually lossless" is a name for "the last rung before the noise is deleted",
   and the design's diagnostic use rests on it.
2. **F1, one bar, at the estimator's resolution.** The bar (1.00 against 1.03) moves 10 of 19 volumes' Q, the 10-bit
   ones by a full rung, and decides G 1 against G 16 by 0.1 % margins that swing the bytes 2–3× either way. Fix one
   bar, then measure integer Q near it.
3. **F2 with F3, G at equal quality.** The rows support "G 16 saves 0–1 % on 12-bit and 6–10 % on 10-bit DBT near
   the anchor, lag 0"; "nothing" is the Q 8 equal-Q reading. Alt-ref's effect on the noise measure is unmeasured, and
   its 34–59 % saving at Q 8 is a different operating point, not a free gain. Row 0 of `docs/lines/codecs.md`
   (`claude/av1-groups`) should take its arms at integer Q and include the six alt-ref cells of F3.
