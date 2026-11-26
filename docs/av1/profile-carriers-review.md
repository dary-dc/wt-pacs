# Carriers review: profile carriers, independent

*2026-11-04, a review of [`profile-carriers.md`](profile-carriers.md) (its pre-registered protocol and its measured
section) and of [`lab/av1/delivery/carriers/`](../../lab/av1/delivery/carriers/) at `c1ae67f7`. It asks what could make the
verdict wrong or not general, not which carrier is better.*

1. **Reviewed:** the protocol, the measured section, every file of the harness, and its committed rows and indexes
   (`results/carriers-rows.jsonl`, `results/dbts_{a1,b1,c1}.json`): the tests run, the three tables reproduced, two
   verdict cells re-derived by hand, four checks mutated.
2. **Found:** 22 findings — **3 change the verdict, 11 weaken it, 8 cosmetic**. The order-effect gate cannot be read
   at this design; without it three of the four role verdicts change. The high-view bytes rest on an interpolation
   that no measured rung bounds.
3. **Rests on:** the run's own rows and indexes for the three DBT volumes `dbts_a1`, `dbts_b1`, `dbts_c1`, and nothing
   newly timed. Every number below is *derived* from those files unless it says otherwise.
4. **Left:** no new timing was run; the interpolation finding is bounded, not resolved (it needs encodes); the
   alternative designs proposed are not run.
5. **What changes:** the verdict should be read as "separate payloads are better for the exact frame on request from
   `p3-m20`, on bytes and on times alike"; the cheap view, the `p3k1-m20` ask and the high view are open until the
   protocol changes below are run.

**Terms** (those of `profile-carriers.md` otherwise). *Cell*: one (volume, throttle, arm). *Order effect*, *not read*,
*A/A range*, *strict*: as that document defines them. *Gate*: the rule that an arm whose order effect passes 10 % is
not read. *Rung*: one of the separate high-view streams, Q 8, 16, 32, 56. *Chord*: the log-bytes-linear-in-PSNR line
between two rungs, which `roles.at_psnr` uses. *Ungated*: `verdict.py` with the gate off (`ORDER_LIMIT` set past every
effect), everything else as committed.

## What was run

* `roles_test.py`: 16/16. `mutate.py`: each of its six breaks caught (15/16, 15/16, 13/16, 15/16, 15/16, 15/16).
* `roles.py`, `verdict.py` and `predictions.py` on the committed rows and indexes: each output equals the committed
  `results/roles.md`, `verdict.md`, `predictions.md` byte for byte.
* **Two verdict cells by hand**, from the rows, with an exact Mann–Whitney (every split of the 20 values enumerated),
  not `aa_rule.py`'s normal approximation:
  * *Exact ask, `p3-m20` vs residual, bytes, `dbts_a1`.* Group 24; tops (top − middle unit) of 24 … k plus k's low
    bits: 1 187 753 · 1 997 165 · 2 804 888 · 3 610 695 · 4 414 066 · 5 215 291 · 6 014 103 · 6 809 689 B, mean
    4 006 706; residual mean 1 242 777; 3.22×, 3.49× a shipped frame. Matches `verdict.md` and the measured table.
  * *High view, `mid-m20` vs `sep-q16`, decode a frame, `dbts_b1`.* Paired sep ÷ layered 1.357 at 1×, 1.327 at 4×;
    A/A range 0.85–1.55 and 0.82–1.12; every round's separate ratio above every layered one (exact p = 1/184 756).
    So *not resolved* at 1× (inside the range) and *layered* at 4×. Matches `verdict.md` (1.36, 1.33).
* **Checks mutated** (`dbts_*` indexes and rows; each restored after):

| break | caught? |
| --- | --- |
| `roles.ask_bytes` adds frame k + 1's low bits | **yes**, `roles_test` 14/16 |
| `roles.lower` reversed (every bytes comparison) | **no**, 16/16; `verdict.py` then prints 48 strict "layered better" lines |
| `roles.ask_ms` ignores `exact` | **no**, 16/16 |
| `verdict.ORDER_LIMIT` off | **no**, 16/16 (`verdict.py` has no test) |

## Findings

Severity: **V** changes the verdict · **W** weakens it or its generality · **C** cosmetic. Fixtures: every finding
rests on `dbts_a1`, `dbts_b1`, `dbts_c1` as the run coded them unless it names fewer.

| # | sev. | finding | evidence | protocol change that fixes it |
| --- | --- | --- | --- | --- |
| 1 | **V** | **The order-effect statistic cannot be read at this design: it measures round-to-round spread, not order.** 17 arms in a Williams order (odd n, so a 34-round period, `lab/order.mjs:13`) over 10 rounds give each arm 10 distinct predecessors, one round each: "median by predecessor" is one round's value, and the statistic is the largest deviation of one round from the median. | Every one of the 102 cells has 10 predecessors, one round each (170 of the 289 (arm, predecessor) pairs seen, each once; 34 rounds would give each pair twice). Shuffling predecessor labels across rounds leaves the statistic unchanged: permutation p = 1.00 in all 42 gated cells. Across cells the statistic follows the round CV (r = 0.89); e.g. `svc`, `dbts_a1` 1×, gated at 10 % with a round CV of 2.4 %. Ungated, the verdict changes: `p3k1-m20` ask *layered better* → **a trade** (bytes layered, decode separate 0.09–0.31×); cheap view *separate better* → **a trade** (bytes separate, decode layered, 9.2–9.8× on `dbts_a1` 1×); high view *separate better* → separate better in 16, a trade in 8 of the 24 (volume, throttle, pair) lines. The `p3-m20` ask is unchanged. | Run each comparison in its own small Williams block (layered, separate, `htj2k`, `htj2k-aa`: n = 4, period 4), ≥ 12 rounds so each predecessor has ≥ 3 values; test carryover by permuting predecessor labels within rounds (round-centred values) and gate at p < 0.05, not at a fixed 10 %. Pre-register what the gate does to a verdict (finding 2). |
| 2 | **V** | **"Not read" becomes "absent", so a role whose every time metric is voided is called *better* on bytes alone.** The rule says "better if none of the role's metrics is decided against it"; `verdict.py:310` drops "not read" before `verdict()`, so a voided metric counts as one that is not against. | Strict reading: no time metric is read in any (volume, throttle) (`htj2k` or `htj2k-aa` gated in all six), so all four role verdicts are bytes verdicts. Ungated, the bytes and the times disagree in three roles (finding 1). The measured section says so in prose ("times not read") but its table still prints **better**. | A role with any of its pre-registered time metrics not read gets **no verdict on time**, printed as "bytes: X; times: not read", never "X better". |
| 3 | **V** | **The high-view bytes at equal PSNR rest on the chord across wide rung gaps; no measured rung bounds them below 1.** | Rung gaps 1.7–5.4 dB with 5–14× bytes between rungs (e.g. `dbts_a1` Q 16 → Q 8: 506 895 → 4 640 590 B). The nearest measured rung at or above each middle's PSNR is m 10 · 20 · 30 **1.67 · 1.00 · 2.30×** (`a1`), **1.56 · 1.30 · 4.04×** (`b1`), **1.60 · 1.13 · 2.92×** (`c1`) the layered base + middle. The curve is not one shape: log-bytes slopes per dB are 0.43 · 1.03 · 0.70 (`a1`, Q 56→32→16→8), 0.59 · 0.79 · 0.30 (`b1`), 0.41 · 1.07 · 0.52 (`c1`). Using the adjacent segment's slope instead of the chord gives m 10 **1.05 · 1.56 · 1.60** (`a1` · `b1` · `c1`, the last two capped at the Q 8 rung): separate *more* bytes. Only `dbts_a1` m 20 is settled by a measured point (Q 16: the same bytes, +0.43 dB). | Encode the separate stream at quantizers bisected to each middle's PSNR (within ±0.1 dB) and compare measured bytes; the encodes are deterministic and cheap next to the rounds. Keep the chord only as a cross-check. |
| 4 | W | **The A/A range is a min–max over rounds of a noisy ratio, so it widens with n and blocks consistent effects.** | `htj2k` is the noisiest reference: round CV 7–21 % (`dbts_a1` 1× 20.6 %). Finding 3's re-derived cell: separate slower in every one of 10 rounds (exact p ≈ 5·10⁻⁶), paired 1.36, *not resolved* because 1.36 lies in 0.85–1.55. Computing the gate on the ratio the rule decides (round mean ÷ `htj2k`) instead of raw ms gates 94 of 96 cells. | Compare the paired median to an interval of the A/A paired median (bootstrap over rounds), or apply `decided()` to `htj2k-aa` vs `htj2k` and require the comparison to pass where the A/A does not; use a less noisy reference (a longer HTJ2K decode, or the whole group). |
| 5 | W | **Eight correlated time metrics a pair, any one decided against makes "a trade", with no primary metric.** Six of the eight are `pipeline()` of the same per-round decode. | `roles.py:175–181`, `verdict.py:302–307`. Ungated, the high view's "a trade" lines come from first-picture metrics decided one way and decode metrics the other (measured section: "10 for separate, every one a first picture"). | Pre-register one primary time metric a role (the ask's decode; the view's every slice at 20 Mbit/s); report the rest as secondary, outside the rule. |
| 6 | W | **The role times are a model of a link, not validated for either carrier, and the ask over a link is serial.** | `roles.pipeline`: t₀ = 40 ms flat, no transport, no request per unit, no slow start; §6 of the scalable README found the model 0.15–0.7 s against 0.28–0.61 s measured for the bases (up to 2× off), and nothing for the separate stream. The layered ask "bytes ÷ R + decode" (measured section, *derived*) serialises download and a chain decode that could overlap. | Validate the model against real fills on the rig's shaped link for one arm a carrier before reading role times; model the layered ask chain as `pipeline()` over its units, not bytes ÷ R + decode. |
| 7 | W | **The high-view comparison confounds the carrier with the encoder and the group.** | Separate: `aomenc --good --cpu-used=6`, G = 16; layered: `svc_encoder_rtc` speed 7, k = 8, plus the base it carries (the protocol's 2b names all three and calls them not separable). So C5's 0.45–0.67 is a claim about these two configurations. G = 16 helps the separate view's bytes; k = 8 shortens the layered ask's chain: the arms are not compared at one group size. | Add arms that hold the encoder and group fixed: a single-layer `svc_encoder_rtc` stream at speed 7 and k = 8, and `p3` at k = 16, so the carrier's own cost is the difference. |
| 8 | W | **Times are paired at the nearest rung, not at equal quality.** | `dbts_b1` m 10 (49.23 dB) is read against Q 16 (46.69, 2.54 dB lower); the other gaps are 0.16–1.83 dB. A cheaper rung decodes faster. | As finding 3: encode each separate rung at the middle's PSNR. |
| 9 | W | **The access patterns favour one shape of reader and leave the separate carrier's own jump untimed.** | One cold ask a position, uniform over the 8 positions of one middle group a volume (frames 24–31, 24–31, 32–39: 24 frames in all); no dweller (k then k + 1 on a kept decoder); the views start at frame 0. A jump inside the separate high view costs its G = 16 chain (8.5 decodes on average, *derived*), the layered view's k = 8 chain 4.5; neither is timed, while the layered ask's chain is. | Add a view-jump arm for both carriers, a dweller arm (k, k + 1, … k + 3 on one decoder), and asked groups at three depths of each volume. |
| 10 | W | **`p3k1-m20` is judged for the ask without the high-view cost it brings.** | Its base + middle is 1.96 · 1.49 · 1.93× `p3-m20`'s; the separate stream at its middle's PSNR is 0.32 · 0.44 · 0.31× of it (chord, *derived*). `mid1-m20` was timed every round and is in no comparison (`verdict.py:285–287`). The summary's line 2 reads as a carrier option. | Judge a carrier across every role it serves at once: compare `mid1-m20` against the separate high view and print the `p3k1-m20` carrier's verdict as one row. |
| 11 | W | **WebCodecs arms enter the rule against one-thread dav1d-WASM.** | `wc-q16`, `wc-q56` are in the comparisons (`verdict.py:285–287`); the document says WebCodecs "is not a one-core figure". | Report WebCodecs beside the rule, or give the layered side a dav1d-WASM arm at the same thread count. |
| 12 | W | **The code that decides every strict verdict cell has no test.** | Mutations above: `lower` reversed and `ask_ms` without its exactness filter pass `roles_test` 16/16; `verdict.py` (`not_read`, the strict and compared-only gates, `pairing`) is not tested at all. The committed verdict is right (re-derived above); the code that makes it is unguarded. | Tests for `lower`, `pairing`, `not_read` and both gates, each with a break in `mutate.py`. |
| 13 | W | **The fixtures are three DBT volumes, one a system; the mutations ran on one.** | `dbts_a1` (56 frames), `dbts_b1` (50), `dbts_c1` (69); browser mutations on `dbts_a1` at 1× only. Nothing for FFDM (one frame a view, where the group question does not arise), ultrasound cine or ABUS (the document says so). | Name the claim "these three volumes" in the verdict table itself; run the mutations on each volume and throttle once. |
| 14 | W | **C3 is refuted without a cause, and the ask arms stop their clocks at different points.** | Residual + add 1.53–1.97× an HTJ2K frame, against RESIDAPART's 0.97–1.00. `ask.js:190–194` times the residual decode and a JS add loop; `:197–200` times HTJ2K's decode only, no crop or copy; `svc` and `k2` include the merge loop. | Time each arm to the same endpoint (cropped samples in one array); split `res` into decode and add. |
| 15 | C | **The run's rounds differ from §4 as committed.** | Pre-registered 10 (`4b12442`), changed to 7 by the harness session (`e67b87d`, "the budget from the timed round"), run 10, while the measured section says "§4 as written". Rerun on rounds 0–6 and 0–7 only: the same verdict line for line. | Say the deviation in the measured section. |
| 16 | C | **Mutations and rounds ran on different `ask.js`.** | `e311fd3` vs `e67b87d`: a 20 s WebCodecs bound and a `try` around each view; `checkExact` and `checkLossy` unchanged. | Re-run the five browser mutations on the commit the rounds ran. |
| 17 | C | **The two carriers' lossy frames are reconstructed differently for PSNR on 12 bits.** | `content.py:170` puts the layered layers back at x · 4 + 1.5; `content.py:189` the separate at x · 4. At 46.3 dB (MSE ≈ 390 at peak 4095) a 1.5-code bias is about 0.6 % of the MSE, ≈ 0.03 dB (*derived*, assuming uniform low bits; its sign in the background is *unverified*). As pre-registered. | One reconstruction for both. |
| 18 | C | **Which PSNR.** | The rule reads volume PSNR over every sample, background included. In-window PSNR moves the high-view ratios up by 0.00–0.14 (`dbts_c1` m 30: 0.45 → 0.59), none past 1. | Pre-register in-window PSNR as the matching metric, all-sample beside it. |
| 19 | C | **The first arm of a round runs slow.** | `htj2k` first after `warm()` on `dbts_a1` 1×: 31.9 ms against 15.6–20.0 after any other arm; first-in-round > 1.10× the cell median in 6 of 60 cells. `warm()` (`ask.js:234–246`) decodes one HTJ2K frame and two dav1d units, not the merge or add loops. | Warm every arm's path, or run one untimed sacrificial arm first. |
| 20 | C | **Mutate-and-restore can leave the mutant in Python's bytecode cache.** | Reproduced here: a same-length break of `roles.py`, restored within the same second, imported as the mutant from `__pycache__` (even with `-B`, which stops writing, not reading). `mutate.py`'s six breaks all change the file's length, so its outcomes stand. The cache's keying is *unverified* against Python's documentation. | Run `mutate.py`'s children with `PYTHONPYCACHEPREFIX` set to a fresh directory. |
| 21 | C | **`verdict.not_read` sums a view's `ms` with no guard.** | `verdict.py:226` against `roles.py:189`, which skips `None`. No row errored, so no effect. | Guard it as `roles.py` does. |
| 22 | C | **The cheap view compares bytes at unequal quality, and the separate carrier may send the base itself.** | 14 985 vs 11 272 B at 38.05 vs 40.36 dB (`dbts_a1`); 2c says the separate carrier may send the very base, so it cannot lose that role by construction. The bytes verdict holds (smaller and better), but it is a choice of stream, not of carrier. | State the cheap-view question as "Q 56 or the quarter base", outside the carrier verdict. |

## Order and statistic, in one paragraph

At 17 arms the Williams order needs 34 rounds for each arm to follow each other arm twice; at 10 rounds each follows
10 of 16 once. A "median by predecessor" of one value is that round; the statistic is then a round's distance from
the median, and an arm with a round CV of 2–5 % can pass 10 % on one draw of ten (`sep-q56`, `dbts_a1` 1×: CV 4.9 %, gated at 15 %) (*derived*: 42 of 102 cells gated,
r = 0.89 with the round CV). No design with one value a predecessor can separate a carryover from a round; the fix is
fewer arms a block and more rounds a block (finding 1), with a test, not a threshold.
