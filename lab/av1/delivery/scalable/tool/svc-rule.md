# Part 5's rule, applied to every cell measured (2026-11-05; re-applied 2026-11-08, in progress)

What was run: the 20 Mbit/s 2 % loss cells ([`svc-results-r20000-loss2.md`](svc-results-r20000-loss2.md), 3 of 10 rounds) and more 5 Mbit/s rounds ([`svc-results-r5000.md`](svc-results-r5000.md), 5 of 10), then part 5's pre-registered rule applied again, as written, to every cell measured: three DBT volumes (`dbts_a1`, `dbts_b1`, `dbts_c1`; EA1141) × 5, 20 and 50 Mbit/s, 20 Mbit/s with 2 % loss and 20 Mbit/s with ±20 ms jitter × 1× and 4× CPU × the seven layered variants, layer-major.
What it shows: the two-layer predicted variants `p2-q20` and `p2-q40` pass every clause on `dbts_a1` and `dbts_c1`, two of the three volumes, now including every 2 % loss cell, so on the cells measured the rule reads **interesting**. Every other variant fails on two or three volumes.
What fails them: time to exact at 50 Mbit/s and 4× CPU, where the browser's decode, not the link, sets the last exact frame (`p2-*` on `dbts_b1`, the alone variants on `dbts_a1` and `dbts_b1`); for the three-layer variants, also the bytes test.
What it rests on: three digital breast tomosynthesis (DBT) volumes only, `dbts_a1`, `dbts_b1` and `dbts_c1`, on 4-vCPU containers of one shape (the later rounds in another container than the earlier) and headless Chromium 153.0.8010.12. Nothing is claimed for breast ultrasound cine, ABUS or any other series, host or browser.
What is left, so the verdict is not final: the 2 % loss cells stand at 3 of the protocol's 10 rounds (n = 3 a cell) and 5 Mbit/s at 5 of 10 (n = 3–5 a cell); and the breast ultrasound cine and ABUS rows, which have no fixture.

**Terms.** *SVC*, scalable coding: one AV1 stream coded in layers. The **base** is a small lossy picture at quarter size. The **middle**, in the three-layer `p3-*` only, is a full-size lossy picture. The **top** is the exact (lossless) frame.
*`k2`* is the shipped lossless payload: single-layer AV1 split on 12 bits at k = 2 ([`payload-format.md`](../../../../../docs/av1/payload-format.md)). *`htj2k`* is HTJ2K, exact. *`res`* is HTJ2K with its half-size prefix sent first.
*`a2-q20`, `a2-q40`*: a base at q 20 or q 40 sent alone, beside `k2`. *`p2-q20`, `p2-q40`*: two layers, with the exact top predicted from the base. *`p3-m10`, `p3-m20`, `p3-m30`*: three layers, with the top predicted from a middle at q 10, 20 or 30.
*Layer-major*: every base is sent, then every middle, then every exact frame. *t_P*: the time from the fill's issue until every slice has a picture. *t_X*: the time until every slice is exact.
*The bytes test*: the layered fill's wire bytes divided by `k2`'s. A *cell* is one volume × link × CPU. *1× and 4×*: the browser's CPU unthrottled and slowed fourfold. *A/A resolution*: the smallest t_X change `lab/scripts/aa_rule.py` can tell from HTJ2K sent twice.
*n*: the kept visits in a cell. *`VOID`*: a dropped visit, the relay having broken the rig's 1 ms timing bound.

**The rule**, verbatim from [`docs/av1/README.md`](../../../../../docs/av1/README.md) §The scalable preview as a tool, part 5:

> **Interesting, if and only if**, on at least two of the three volumes and beyond the A/A resolution: one shape
> and order with every frame exact; **t_P ≤ 0.2 × HTJ2K's exact series** at 5 and 20 Mbit/s, 1× and 4×; on the
> scroll at v = 15, more slices reached show a picture than with HTJ2K's prefix first; and **t_X within 1.10× and
> bytes within 1.02× of the shipped representation's** in every cell. If only alone tops pass, the finding is a base
> stored beside the shipped payload — a second representation, structural, proposed then. If none passes the cost
> clause, the branch is not merged and this section records why.

How it was read. Each clause is taken per volume and shape, over the rule's cells: 5, 20 and 50 Mbit/s, 20 Mbit/s with 2 % loss, and 20 Mbit/s with ±20 ms jitter, at 1× and 4×. The `none` link belongs to the metrics protocol (part 10), not to the rule. Order is layer-major, the only one measured.
A clause value is the median over a cell's kept rounds, each round's ratio paired with the same round's control. t_X over 1.10 counts as a fail only beyond the cell's A/A resolution. Every exact frame is checked on every visit, `VOID` ones included.
The scroll clause is applied in every cell, the strictest reading; restricting it to 5 and 20 Mbit/s changes nothing, since it passes everywhere. The clauses are `svc_tables.py`'s `rule()`, unchanged. [`svc_rule.py`](svc_rule.py) prints them per cell, and the two agree on every pass and fail.
One divergence: `rule()` cannot see rounds that never ran, so it does not mark a cell short of its ten rounds undecided. The verdict below says which are.

## Verdict

**On every cell measured: interesting, by `p2-q20` and `p2-q40`, predicted two-layer tops.** **Not final**, because the 2 % loss cells stand at 3 of the protocol's 10 rounds (n = 3 a cell) and 5 Mbit/s at 5 of 10 (n = 3–5 a cell).

* **`p2-q20`, `p2-q40` pass every clause on `dbts_a1` and `dbts_c1`** in all ten cells of each volume:
  * every frame exact;
  * t_P 0.002–0.018 of HTJ2K's t_X;
  * 52–67 slices pictured at 15 slices/s against 0–54 with the prefix first;
  * t_X 0.984–1.070× `k2`;
  * bytes 0.989–0.994×.
  They fail t_X on `dbts_b1` at 50 Mbit/s 4× (1.202×, 1.232×; A/A ±0.3 %).
* **`a2-q20`, `a2-q40`, the alone variants, fail** t_X at 50 Mbit/s 4× on `dbts_a1` (1.115×, 1.116×; A/A ±0.4 %) and on `dbts_b1` (1.218×, 1.198×). They pass on `dbts_c1` only.
* **`p3-m10`, `p3-m20`, `p3-m30` fail on all three volumes**. They fail t_X at 50 Mbit/s 4× (1.247–1.923×). They also fail the bytes test where each middle is sent twice: `p3-m10` on every volume (1.040–1.170×), and `p3-m20` and `p3-m30` on `dbts_b1` (1.044×, 1.022×).

**What the rule then says.** Predicted tops pass, so the finding is not only a base stored beside the shipped payload. It is a change to the stored representation, which is structural and is proposed separately. Part 5's opening says the branch "merges only if the protocol below finds it interesting": on the cells measured that condition is met, but not yet on every cell.
The closest margin among the passing cells is t_X on `dbts_a1` at 50 Mbit/s 4×: 1.069× and 1.070× against 1.10.

**The 2 % loss cells.** At n = 3 the `p2-*` shapes give t_X 0.984–1.011× `k2` on `dbts_a1` and `dbts_c1` (1.006–1.009× on `dbts_b1`) and bytes 0.989–0.994×; every frame exact. A/A resolution: ±0.3 %, ±0.5 %, ±0.6 %, ±2.6 %. At 2 % loss every exact fill is bound by the loss, not the CPU ([`svc-results-r20000-loss2.md`](svc-results-r20000-loss2.md), *Where the host saturates*), so t_X there follows bytes, and the `p3-*` variants fail it where their bytes do (`p3-m10` on `dbts_b1`, 1.165–1.174×).

**What would reverse it.** A fail by both `p2-*` shapes on `dbts_a1` or `dbts_c1` in the 2 % loss or 5 Mbit/s rounds still to run leaves no shape passing on two volumes. The verdict would then be **not interesting**.
At 5 Mbit/s the A/A resolution is ±0.1 % by cell; the `p2-*` cells there pass on their medians (t_X 0.989–1.009×).

## Per shape and volume

`svc_tables.py`'s `rule()` output over every sitting's rows. "pass" means every cell measured passes.

| shape | `dbts_a1` exact · t_P ≤ 0.2 · scroll 15 · t_X ≤ 1.10 · bytes ≤ 1.02 | `dbts_b1` exact · t_P ≤ 0.2 · scroll 15 · t_X ≤ 1.10 · bytes ≤ 1.02 | `dbts_c1` exact · t_P ≤ 0.2 · scroll 15 · t_X ≤ 1.10 · bytes ≤ 1.02 | volumes passing every clause |
| --- | --- | --- | --- | --- |
| `a2-q20` | pass · pass · pass · FAIL · pass (r50000 4×: t_X 1.115× shipped) | pass · pass · pass · FAIL · pass (r50000 4×: t_X 1.218× shipped) | pass · pass · pass · pass · pass | 1 pass, 2 fail, 0 undecided |
| `a2-q40` | pass · pass · pass · FAIL · pass (r50000 4×: t_X 1.116× shipped) | pass · pass · pass · FAIL · pass (r50000 4×: t_X 1.198× shipped) | pass · pass · pass · pass · pass | 1 pass, 2 fail, 0 undecided |
| `p2-q20` | pass · pass · pass · pass · pass | pass · pass · pass · FAIL · pass (r50000 4×: t_X 1.202× shipped) | pass · pass · pass · pass · pass | 2 pass, 1 fail, 0 undecided |
| `p2-q40` | pass · pass · pass · pass · pass | pass · pass · pass · FAIL · pass (r50000 4×: t_X 1.232× shipped) | pass · pass · pass · pass · pass | 2 pass, 1 fail, 0 undecided |
| `p3-m10` | pass · pass · pass · FAIL · FAIL (bytes 1.040× shipped; r50000 4×: t_X 1.247× shipped) | pass · pass · pass · FAIL · FAIL (bytes 1.170× shipped; r20000 1×: t_X 1.170× shipped; r20000 4×: t_X 1.172× shipped; r20000-j20 1×: t_X 1.172× shipped; r20000-j20 4×: t_X 1.243× shipped; r20000-l2 1×: t_X 1.165× shipped; r20000-l2 4×: t_X 1.174× shipped; r5000 1×: t_X 1.170× shipped; r5000 4×: t_X 1.170× shipped; r50000 1×: t_X 1.178× shipped; r50000 4×: t_X 1.923× shipped) | pass · pass · pass · FAIL · FAIL (bytes 1.055× shipped; r50000 4×: t_X 1.375× shipped) | 0 pass, 3 fail, 0 undecided |
| `p3-m20` | pass · pass · pass · FAIL · pass (r50000 4×: t_X 1.262× shipped) | pass · pass · pass · FAIL · FAIL (bytes 1.044× shipped; r20000-j20 4×: t_X 1.146× shipped; r50000 4×: t_X 1.816× shipped) | pass · pass · pass · FAIL · pass (r50000 4×: t_X 1.313× shipped) | 0 pass, 3 fail, 0 undecided |
| `p3-m30` | pass · pass · pass · FAIL · pass (r50000 4×: t_X 1.261× shipped) | pass · pass · pass · FAIL · FAIL (bytes 1.022× shipped; r20000-j20 4×: t_X 1.135× shipped; r50000 4×: t_X 1.811× shipped) | pass · pass · pass · FAIL · pass (r50000 4×: t_X 1.311× shipped) | 0 pass, 3 fail, 0 undecided |

## Every cell

Each clause's value per cell. A **FAIL** is a value outside the rule's bound. *t_P ÷ HTJ2K's t_X* is a clause only at 5 and 20 Mbit/s. The scroll columns count the slices pictured when reached, scrolling from slice 0 at 15 slices/s, against the series' frame count.

| shape | series | link, CPU | n | frames exact | t_P ÷ HTJ2K's t_X (≤ 0.2; 5 and 20 Mbit/s) | slices pictured at 15 slices/s: base · prefix | t_X ÷ `k2` (≤ 1.10) · A/A resolution | bytes ÷ `k2` (≤ 1.02) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `a2-q20` | `dbts_a1` | r20000 1× | 9 | yes | 0.009 | 54 · 0 of 56 | 1.001 · ±0.1 % | 1.001 |
| `a2-q20` | `dbts_a1` | r20000 4× | 9 | yes | 0.017 | 53 · 0 of 56 | 1.001 · ±0.1 % | 1.001 |
| `a2-q20` | `dbts_a1` | r50000 1× | 10 | yes | not a clause here | 54 · 31 of 56 | 1.002 · ±0.2 % | 1.001 |
| `a2-q20` | `dbts_a1` | r50000 4× | 10 | yes | not a clause here | 52.5 · 29.5 of 56 | 1.115 · ±0.4 % **FAIL** | 1.001 |
| `a2-q20` | `dbts_a1` | r5000 1× | 3 | yes | 0.002 | 54 · 0 of 56 | 1.001 · ±0.1 % | 1.001 |
| `a2-q20` | `dbts_a1` | r5000 4× | 4 | yes | 0.004 | 53 · 0 of 56 | 1.001 · ±0.1 % | 1.001 |
| `a2-q20` | `dbts_a1` | r20000-l2 1× | 3 | yes | not a clause here | 54 · 0 of 56 | 0.996 · ±0.3 % | 1.001 |
| `a2-q20` | `dbts_a1` | r20000-l2 4× | 3 | yes | not a clause here | 52 · 0 of 56 | 1.003 · ±2.6 % | 1.001 |
| `a2-q20` | `dbts_a1` | r20000-j20 1× | 9 | yes | not a clause here | 54 · 0 of 56 | 1.001 · ±0.1 % | 1.001 |
| `a2-q20` | `dbts_a1` | r20000-j20 4× | 7 | yes | not a clause here | 52 · 0 of 56 | 1.002 · ±0.1 % | 1.001 |
| `a2-q20` | `dbts_b1` | r20000 1× | 9 | yes | 0.010 | 48 · 0 of 50 | 1.002 · ±0.1 % | 1.002 |
| `a2-q20` | `dbts_b1` | r20000 4× | 10 | yes | 0.018 | 43 · 0 of 50 | 1.003 · ±0.1 % | 1.002 |
| `a2-q20` | `dbts_b1` | r50000 1× | 9 | yes | not a clause here | 47 · 0 of 50 | 1.003 · ±0.3 % | 1.002 |
| `a2-q20` | `dbts_b1` | r50000 4× | 10 | yes | not a clause here | 42 · 0 of 50 | 1.218 · ±0.3 % **FAIL** | 1.002 |
| `a2-q20` | `dbts_b1` | r5000 1× | 5 | yes | 0.003 | 47 · 0 of 50 | 1.002 · ±0.1 % | 1.002 |
| `a2-q20` | `dbts_b1` | r5000 4× | 4 | yes | 0.005 | 42 · 0 of 50 | 1.002 · ±0.1 % | 1.002 |
| `a2-q20` | `dbts_b1` | r20000-l2 1× | 3 | yes | not a clause here | 47 · 0 of 50 | 1.005 · ±2.6 % | 1.002 |
| `a2-q20` | `dbts_b1` | r20000-l2 4× | 3 | yes | not a clause here | 43 · 0 of 50 | 1.001 · ±3.4 % | 1.002 |
| `a2-q20` | `dbts_b1` | r20000-j20 1× | 8 | yes | not a clause here | 47 · 0 of 50 | 1.003 · ±0.1 % | 1.002 |
| `a2-q20` | `dbts_b1` | r20000-j20 4× | 9 | yes | not a clause here | 42 · 0 of 50 | 1.009 · ±0.2 % | 1.002 |
| `a2-q20` | `dbts_c1` | r20000 1× | 10 | yes | 0.011 | 67 · 0 of 69 | 1.001 · ±0.1 % | 1.001 |
| `a2-q20` | `dbts_c1` | r20000 4× | 10 | yes | 0.018 | 66 · 0 of 69 | 1.002 · ±0.2 % | 1.001 |
| `a2-q20` | `dbts_c1` | r50000 1× | 10 | yes | not a clause here | 67 · 54 of 69 | 1.001 · ±0.1 % | 1.001 |
| `a2-q20` | `dbts_c1` | r50000 4× | 10 | yes | not a clause here | 65 · 52 of 69 | 1.076 · ±0.3 % | 1.001 |
| `a2-q20` | `dbts_c1` | r5000 1× | 4 | yes | 0.003 | 67 · 0 of 69 | 1.001 · ±0.1 % | 1.001 |
| `a2-q20` | `dbts_c1` | r5000 4× | 5 | yes | 0.005 | 65 · 0 of 69 | 1.001 · ±0.1 % | 1.001 |
| `a2-q20` | `dbts_c1` | r20000-l2 1× | 3 | yes | not a clause here | 67 · 0 of 69 | 1.003 · ±0.6 % | 1.001 |
| `a2-q20` | `dbts_c1` | r20000-l2 4× | 3 | yes | not a clause here | 64 · 0 of 69 | 1.014 · ±0.5 % | 1.001 |
| `a2-q20` | `dbts_c1` | r20000-j20 1× | 9 | yes | not a clause here | 67 · 0 of 69 | 1.001 · ±0.1 % | 1.001 |
| `a2-q20` | `dbts_c1` | r20000-j20 4× | 10 | yes | not a clause here | 65 · 0 of 69 | 1.007 · ±0.2 % | 1.001 |
| `a2-q40` | `dbts_a1` | r20000 1× | 9 | yes | 0.009 | 54 · 0 of 56 | 1.001 · ±0.1 % | 1.000 |
| `a2-q40` | `dbts_a1` | r20000 4× | 10 | yes | 0.015 | 53 · 0 of 56 | 1.001 · ±0.1 % | 1.000 |
| `a2-q40` | `dbts_a1` | r50000 1× | 10 | yes | not a clause here | 54 · 31 of 56 | 1.001 · ±0.2 % | 1.000 |
| `a2-q40` | `dbts_a1` | r50000 4× | 9 | yes | not a clause here | 52 · 29.5 of 56 | 1.116 · ±0.4 % **FAIL** | 1.000 |
| `a2-q40` | `dbts_a1` | r5000 1× | 4 | yes | 0.002 | 54 · 0 of 56 | 1.000 · ±0.1 % | 1.000 |
| `a2-q40` | `dbts_a1` | r5000 4× | 3 | yes | 0.004 | 52 · 0 of 56 | 1.001 · ±0.1 % | 1.000 |
| `a2-q40` | `dbts_a1` | r20000-l2 1× | 3 | yes | not a clause here | 54 · 0 of 56 | 0.998 · ±0.3 % | 1.000 |
| `a2-q40` | `dbts_a1` | r20000-l2 4× | 3 | yes | not a clause here | 52 · 0 of 56 | 1.001 · ±2.6 % | 1.000 |
| `a2-q40` | `dbts_a1` | r20000-j20 1× | 10 | yes | not a clause here | 53 · 0 of 56 | 1.001 · ±0.1 % | 1.000 |
| `a2-q40` | `dbts_a1` | r20000-j20 4× | 8 | yes | not a clause here | 51.5 · 0 of 56 | 1.003 · ±0.1 % | 1.000 |
| `a2-q40` | `dbts_b1` | r20000 1× | 10 | yes | 0.010 | 47 · 0 of 50 | 1.001 · ±0.1 % | 1.000 |
| `a2-q40` | `dbts_b1` | r20000 4× | 9 | yes | 0.017 | 43 · 0 of 50 | 1.001 · ±0.1 % | 1.000 |
| `a2-q40` | `dbts_b1` | r50000 1× | 10 | yes | not a clause here | 46.5 · 0 of 50 | 1.000 · ±0.3 % | 1.000 |
| `a2-q40` | `dbts_b1` | r50000 4× | 10 | yes | not a clause here | 42 · 0 of 50 | 1.198 · ±0.3 % **FAIL** | 1.000 |
| `a2-q40` | `dbts_b1` | r5000 1× | 4 | yes | 0.003 | 47 · 0 of 50 | 1.000 · ±0.1 % | 1.000 |
| `a2-q40` | `dbts_b1` | r5000 4× | 5 | yes | 0.006 | 43 · 0 of 50 | 1.000 · ±0.1 % | 1.000 |
| `a2-q40` | `dbts_b1` | r20000-l2 1× | 3 | yes | not a clause here | 46 · 0 of 50 | 1.007 · ±2.6 % | 1.000 |
| `a2-q40` | `dbts_b1` | r20000-l2 4× | 3 | yes | not a clause here | 42 · 0 of 50 | 0.991 · ±3.4 % | 1.000 |
| `a2-q40` | `dbts_b1` | r20000-j20 1× | 8 | yes | not a clause here | 46 · 0 of 50 | 1.001 · ±0.1 % | 1.000 |
| `a2-q40` | `dbts_b1` | r20000-j20 4× | 7 | yes | not a clause here | 42 · 0 of 50 | 1.006 · ±0.2 % | 1.000 |
| `a2-q40` | `dbts_c1` | r20000 1× | 10 | yes | 0.010 | 67 · 0 of 69 | 1.001 · ±0.1 % | 1.000 |
| `a2-q40` | `dbts_c1` | r20000 4× | 10 | yes | 0.017 | 66 · 0 of 69 | 1.001 · ±0.2 % | 1.000 |
| `a2-q40` | `dbts_c1` | r50000 1× | 10 | yes | not a clause here | 67 · 54 of 69 | 1.001 · ±0.1 % | 1.000 |
| `a2-q40` | `dbts_c1` | r50000 4× | 10 | yes | not a clause here | 65 · 52 of 69 | 1.078 · ±0.3 % | 1.000 |
| `a2-q40` | `dbts_c1` | r5000 1× | 5 | yes | 0.003 | 67 · 0 of 69 | 1.000 · ±0.1 % | 1.000 |
| `a2-q40` | `dbts_c1` | r5000 4× | 5 | yes | 0.005 | 66 · 0 of 69 | 1.001 · ±0.1 % | 1.000 |
| `a2-q40` | `dbts_c1` | r20000-l2 1× | 3 | yes | not a clause here | 67 · 0 of 69 | 1.002 · ±0.6 % | 1.000 |
| `a2-q40` | `dbts_c1` | r20000-l2 4× | 3 | yes | not a clause here | 66 · 0 of 69 | 0.995 · ±0.5 % | 1.000 |
| `a2-q40` | `dbts_c1` | r20000-j20 1× | 9 | yes | not a clause here | 66 · 0 of 69 | 1.001 · ±0.1 % | 1.000 |
| `a2-q40` | `dbts_c1` | r20000-j20 4× | 10 | yes | not a clause here | 65 · 0 of 69 | 1.009 · ±0.2 % | 1.000 |
| `p2-q20` | `dbts_a1` | r20000 1× | 10 | yes | 0.009 | 54 · 0 of 56 | 0.992 · ±0.1 % | 0.992 |
| `p2-q20` | `dbts_a1` | r20000 4× | 10 | yes | 0.016 | 53 · 0 of 56 | 0.991 · ±0.1 % | 0.992 |
| `p2-q20` | `dbts_a1` | r50000 1× | 10 | yes | not a clause here | 54 · 31 of 56 | 0.992 · ±0.2 % | 0.992 |
| `p2-q20` | `dbts_a1` | r50000 4× | 10 | yes | not a clause here | 52 · 29.5 of 56 | 1.069 · ±0.4 % | 0.992 |
| `p2-q20` | `dbts_a1` | r5000 1× | 4 | yes | 0.003 | 54 · 0 of 56 | 0.992 · ±0.1 % | 0.992 |
| `p2-q20` | `dbts_a1` | r5000 4× | 3 | yes | 0.005 | 52 · 0 of 56 | 0.992 · ±0.1 % | 0.992 |
| `p2-q20` | `dbts_a1` | r20000-l2 1× | 3 | yes | not a clause here | 54 · 0 of 56 | 0.984 · ±0.3 % | 0.992 |
| `p2-q20` | `dbts_a1` | r20000-l2 4× | 3 | yes | not a clause here | 53 · 0 of 56 | 1.011 · ±2.6 % | 0.992 |
| `p2-q20` | `dbts_a1` | r20000-j20 1× | 9 | yes | not a clause here | 54 · 0 of 56 | 0.993 · ±0.1 % | 0.992 |
| `p2-q20` | `dbts_a1` | r20000-j20 4× | 9 | yes | not a clause here | 52 · 0 of 56 | 0.991 · ±0.1 % | 0.992 |
| `p2-q20` | `dbts_b1` | r20000 1× | 10 | yes | 0.010 | 48 · 0 of 50 | 1.006 · ±0.1 % | 1.005 |
| `p2-q20` | `dbts_b1` | r20000 4× | 10 | yes | 0.018 | 44 · 0 of 50 | 1.010 · ±0.1 % | 1.005 |
| `p2-q20` | `dbts_b1` | r50000 1× | 10 | yes | not a clause here | 48 · 0 of 50 | 1.009 · ±0.3 % | 1.005 |
| `p2-q20` | `dbts_b1` | r50000 4× | 10 | yes | not a clause here | 42 · 0 of 50 | 1.202 · ±0.3 % **FAIL** | 1.005 |
| `p2-q20` | `dbts_b1` | r5000 1× | 5 | yes | 0.003 | 47 · 0 of 50 | 1.005 · ±0.1 % | 1.005 |
| `p2-q20` | `dbts_b1` | r5000 4× | 5 | yes | 0.005 | 42 · 0 of 50 | 1.007 · ±0.1 % | 1.005 |
| `p2-q20` | `dbts_b1` | r20000-l2 1× | 3 | yes | not a clause here | 47 · 0 of 50 | 1.006 · ±2.6 % | 1.005 |
| `p2-q20` | `dbts_b1` | r20000-l2 4× | 3 | yes | not a clause here | 42 · 0 of 50 | 1.007 · ±3.4 % | 1.005 |
| `p2-q20` | `dbts_b1` | r20000-j20 1× | 10 | yes | not a clause here | 47 · 0 of 50 | 1.006 · ±0.1 % | 1.005 |
| `p2-q20` | `dbts_b1` | r20000-j20 4× | 9 | yes | not a clause here | 42 · 0 of 50 | 1.020 · ±0.2 % | 1.005 |
| `p2-q20` | `dbts_c1` | r20000 1× | 9 | yes | 0.011 | 67 · 0 of 69 | 0.989 · ±0.1 % | 0.989 |
| `p2-q20` | `dbts_c1` | r20000 4× | 9 | yes | 0.018 | 66 · 0 of 69 | 0.988 · ±0.2 % | 0.989 |
| `p2-q20` | `dbts_c1` | r50000 1× | 10 | yes | not a clause here | 67 · 54 of 69 | 0.989 · ±0.1 % | 0.989 |
| `p2-q20` | `dbts_c1` | r50000 4× | 10 | yes | not a clause here | 65 · 52 of 69 | 1.026 · ±0.3 % | 0.989 |
| `p2-q20` | `dbts_c1` | r5000 1× | 4 | yes | 0.003 | 67 · 0 of 69 | 0.989 · ±0.1 % | 0.989 |
| `p2-q20` | `dbts_c1` | r5000 4× | 5 | yes | 0.005 | 65 · 0 of 69 | 0.989 · ±0.1 % | 0.989 |
| `p2-q20` | `dbts_c1` | r20000-l2 1× | 3 | yes | not a clause here | 67 · 0 of 69 | 0.992 · ±0.6 % | 0.989 |
| `p2-q20` | `dbts_c1` | r20000-l2 4× | 3 | yes | not a clause here | 64 · 0 of 69 | 0.988 · ±0.5 % | 0.989 |
| `p2-q20` | `dbts_c1` | r20000-j20 1× | 9 | yes | not a clause here | 67 · 0 of 69 | 0.989 · ±0.1 % | 0.989 |
| `p2-q20` | `dbts_c1` | r20000-j20 4× | 10 | yes | not a clause here | 64.5 · 0 of 69 | 0.992 · ±0.2 % | 0.989 |
| `p2-q40` | `dbts_a1` | r20000 1× | 9 | yes | 0.009 | 53 · 0 of 56 | 0.994 · ±0.1 % | 0.994 |
| `p2-q40` | `dbts_a1` | r20000 4× | 10 | yes | 0.015 | 53 · 0 of 56 | 0.993 · ±0.1 % | 0.994 |
| `p2-q40` | `dbts_a1` | r50000 1× | 10 | yes | not a clause here | 54 · 31 of 56 | 0.994 · ±0.2 % | 0.994 |
| `p2-q40` | `dbts_a1` | r50000 4× | 10 | yes | not a clause here | 52 · 29.5 of 56 | 1.070 · ±0.4 % | 0.994 |
| `p2-q40` | `dbts_a1` | r5000 1× | 5 | yes | 0.002 | 54 · 0 of 56 | 0.994 · ±0.1 % | 0.994 |
| `p2-q40` | `dbts_a1` | r5000 4× | 4 | yes | 0.004 | 52.5 · 0 of 56 | 0.994 · ±0.1 % | 0.994 |
| `p2-q40` | `dbts_a1` | r20000-l2 1× | 3 | yes | not a clause here | 53 · 0 of 56 | 0.988 · ±0.3 % | 0.994 |
| `p2-q40` | `dbts_a1` | r20000-l2 4× | 3 | yes | not a clause here | 53 · 0 of 56 | 0.996 · ±2.6 % | 0.994 |
| `p2-q40` | `dbts_a1` | r20000-j20 1× | 9 | yes | not a clause here | 53 · 0 of 56 | 0.994 · ±0.1 % | 0.994 |
| `p2-q40` | `dbts_a1` | r20000-j20 4× | 7 | yes | not a clause here | 52 · 0 of 56 | 0.992 · ±0.1 % | 0.994 |
| `p2-q40` | `dbts_b1` | r20000 1× | 9 | yes | 0.010 | 47 · 0 of 50 | 1.009 · ±0.1 % | 1.007 |
| `p2-q40` | `dbts_b1` | r20000 4× | 9 | yes | 0.017 | 43 · 0 of 50 | 1.012 · ±0.1 % | 1.007 |
| `p2-q40` | `dbts_b1` | r50000 1× | 10 | yes | not a clause here | 46 · 0 of 50 | 1.010 · ±0.3 % | 1.007 |
| `p2-q40` | `dbts_b1` | r50000 4× | 10 | yes | not a clause here | 42 · 0 of 50 | 1.232 · ±0.3 % **FAIL** | 1.007 |
| `p2-q40` | `dbts_b1` | r5000 1× | 4 | yes | 0.003 | 47 · 0 of 50 | 1.008 · ±0.1 % | 1.007 |
| `p2-q40` | `dbts_b1` | r5000 4× | 5 | yes | 0.005 | 42 · 0 of 50 | 1.009 · ±0.1 % | 1.007 |
| `p2-q40` | `dbts_b1` | r20000-l2 1× | 3 | yes | not a clause here | 47 · 0 of 50 | 1.009 · ±2.6 % | 1.007 |
| `p2-q40` | `dbts_b1` | r20000-l2 4× | 3 | yes | not a clause here | 42 · 0 of 50 | 1.006 · ±3.4 % | 1.007 |
| `p2-q40` | `dbts_b1` | r20000-j20 1× | 9 | yes | not a clause here | 46 · 0 of 50 | 1.009 · ±0.1 % | 1.007 |
| `p2-q40` | `dbts_b1` | r20000-j20 4× | 10 | yes | not a clause here | 42 · 0 of 50 | 1.025 · ±0.2 % | 1.007 |
| `p2-q40` | `dbts_c1` | r20000 1× | 10 | yes | 0.011 | 67 · 0 of 69 | 0.992 · ±0.1 % | 0.992 |
| `p2-q40` | `dbts_c1` | r20000 4× | 10 | yes | 0.016 | 66 · 0 of 69 | 0.992 · ±0.2 % | 0.992 |
| `p2-q40` | `dbts_c1` | r50000 1× | 10 | yes | not a clause here | 66 · 54 of 69 | 0.992 · ±0.1 % | 0.992 |
| `p2-q40` | `dbts_c1` | r50000 4× | 9 | yes | not a clause here | 65 · 52 of 69 | 1.037 · ±0.3 % | 0.992 |
| `p2-q40` | `dbts_c1` | r5000 1× | 5 | yes | 0.003 | 66 · 0 of 69 | 0.992 · ±0.1 % | 0.992 |
| `p2-q40` | `dbts_c1` | r5000 4× | 5 | yes | 0.004 | 65 · 0 of 69 | 0.992 · ±0.1 % | 0.992 |
| `p2-q40` | `dbts_c1` | r20000-l2 1× | 3 | yes | not a clause here | 67 · 0 of 69 | 0.990 · ±0.6 % | 0.992 |
| `p2-q40` | `dbts_c1` | r20000-l2 4× | 3 | yes | not a clause here | 65 · 0 of 69 | 0.993 · ±0.5 % | 0.992 |
| `p2-q40` | `dbts_c1` | r20000-j20 1× | 9 | yes | not a clause here | 66 · 0 of 69 | 0.992 · ±0.1 % | 0.992 |
| `p2-q40` | `dbts_c1` | r20000-j20 4× | 10 | yes | not a clause here | 65 · 0 of 69 | 0.995 · ±0.2 % | 0.992 |
| `p3-m10` | `dbts_a1` | r20000 1× | 10 | yes | 0.009 | 54 · 0 of 56 | 1.040 · ±0.1 % | 1.040 **FAIL** |
| `p3-m10` | `dbts_a1` | r20000 4× | 10 | yes | 0.015 | 53 · 0 of 56 | 1.039 · ±0.1 % | 1.040 **FAIL** |
| `p3-m10` | `dbts_a1` | r50000 1× | 10 | yes | not a clause here | 54 · 31 of 56 | 1.040 · ±0.2 % | 1.040 **FAIL** |
| `p3-m10` | `dbts_a1` | r50000 4× | 10 | yes | not a clause here | 52 · 29.5 of 56 | 1.247 · ±0.4 % **FAIL** | 1.040 **FAIL** |
| `p3-m10` | `dbts_a1` | r5000 1× | 4 | yes | 0.002 | 53.5 · 0 of 56 | 1.040 · ±0.1 % | 1.040 **FAIL** |
| `p3-m10` | `dbts_a1` | r5000 4× | 5 | yes | 0.004 | 52 · 0 of 56 | 1.040 · ±0.1 % | 1.040 **FAIL** |
| `p3-m10` | `dbts_a1` | r20000-l2 1× | 3 | yes | not a clause here | 54 · 0 of 56 | 1.040 · ±0.3 % | 1.040 **FAIL** |
| `p3-m10` | `dbts_a1` | r20000-l2 4× | 3 | yes | not a clause here | 53 · 0 of 56 | 1.045 · ±2.6 % | 1.040 **FAIL** |
| `p3-m10` | `dbts_a1` | r20000-j20 1× | 10 | yes | not a clause here | 53.5 · 0 of 56 | 1.040 · ±0.1 % | 1.040 **FAIL** |
| `p3-m10` | `dbts_a1` | r20000-j20 4× | 7 | yes | not a clause here | 52 · 0 of 56 | 1.038 · ±0.1 % | 1.040 **FAIL** |
| `p3-m10` | `dbts_b1` | r20000 1× | 9 | yes | 0.010 | 47 · 0 of 50 | 1.170 · ±0.1 % **FAIL** | 1.170 **FAIL** |
| `p3-m10` | `dbts_b1` | r20000 4× | 10 | yes | 0.017 | 43 · 0 of 50 | 1.172 · ±0.1 % **FAIL** | 1.170 **FAIL** |
| `p3-m10` | `dbts_b1` | r50000 1× | 10 | yes | not a clause here | 47 · 0 of 50 | 1.178 · ±0.3 % **FAIL** | 1.170 **FAIL** |
| `p3-m10` | `dbts_b1` | r50000 4× | 10 | yes | not a clause here | 42 · 0 of 50 | 1.923 · ±0.3 % **FAIL** | 1.170 **FAIL** |
| `p3-m10` | `dbts_b1` | r5000 1× | 5 | yes | 0.002 | 46 · 0 of 50 | 1.170 · ±0.1 % **FAIL** | 1.170 **FAIL** |
| `p3-m10` | `dbts_b1` | r5000 4× | 5 | yes | 0.005 | 42 · 0 of 50 | 1.170 · ±0.1 % **FAIL** | 1.170 **FAIL** |
| `p3-m10` | `dbts_b1` | r20000-l2 1× | 3 | yes | not a clause here | 46 · 0 of 50 | 1.165 · ±2.6 % **FAIL** | 1.170 **FAIL** |
| `p3-m10` | `dbts_b1` | r20000-l2 4× | 3 | yes | not a clause here | 42 · 0 of 50 | 1.174 · ±3.4 % **FAIL** | 1.170 **FAIL** |
| `p3-m10` | `dbts_b1` | r20000-j20 1× | 9 | yes | not a clause here | 46 · 0 of 50 | 1.172 · ±0.1 % **FAIL** | 1.170 **FAIL** |
| `p3-m10` | `dbts_b1` | r20000-j20 4× | 8 | yes | not a clause here | 42 · 0 of 50 | 1.243 · ±0.2 % **FAIL** | 1.170 **FAIL** |
| `p3-m10` | `dbts_c1` | r20000 1× | 10 | yes | 0.011 | 67 · 0 of 69 | 1.054 · ±0.1 % | 1.055 **FAIL** |
| `p3-m10` | `dbts_c1` | r20000 4× | 9 | yes | 0.017 | 66 · 0 of 69 | 1.053 · ±0.2 % | 1.055 **FAIL** |
| `p3-m10` | `dbts_c1` | r50000 1× | 10 | yes | not a clause here | 66.5 · 54 of 69 | 1.052 · ±0.1 % | 1.055 **FAIL** |
| `p3-m10` | `dbts_c1` | r50000 4× | 10 | yes | not a clause here | 65 · 52 of 69 | 1.375 · ±0.3 % **FAIL** | 1.055 **FAIL** |
| `p3-m10` | `dbts_c1` | r5000 1× | 5 | yes | 0.003 | 67 · 0 of 69 | 1.054 · ±0.1 % | 1.055 **FAIL** |
| `p3-m10` | `dbts_c1` | r5000 4× | 5 | yes | 0.005 | 65 · 0 of 69 | 1.054 · ±0.1 % | 1.055 **FAIL** |
| `p3-m10` | `dbts_c1` | r20000-l2 1× | 3 | yes | not a clause here | 67 · 0 of 69 | 1.051 · ±0.6 % | 1.055 **FAIL** |
| `p3-m10` | `dbts_c1` | r20000-l2 4× | 3 | yes | not a clause here | 65 · 0 of 69 | 1.058 · ±0.5 % | 1.055 **FAIL** |
| `p3-m10` | `dbts_c1` | r20000-j20 1× | 9 | yes | not a clause here | 66 · 0 of 69 | 1.054 · ±0.1 % | 1.055 **FAIL** |
| `p3-m10` | `dbts_c1` | r20000-j20 4× | 9 | yes | not a clause here | 65 · 0 of 69 | 1.054 · ±0.2 % | 1.055 **FAIL** |
| `p3-m20` | `dbts_a1` | r20000 1× | 10 | yes | 0.009 | 54 · 0 of 56 | 1.000 · ±0.1 % | 0.999 |
| `p3-m20` | `dbts_a1` | r20000 4× | 9 | yes | 0.016 | 53 · 0 of 56 | 0.999 · ±0.1 % | 0.999 |
| `p3-m20` | `dbts_a1` | r50000 1× | 10 | yes | not a clause here | 54 · 31 of 56 | 1.001 · ±0.2 % | 0.999 |
| `p3-m20` | `dbts_a1` | r50000 4× | 10 | yes | not a clause here | 52 · 29.5 of 56 | 1.262 · ±0.4 % **FAIL** | 0.999 |
| `p3-m20` | `dbts_a1` | r5000 1× | 4 | yes | 0.002 | 54 · 0 of 56 | 0.999 · ±0.1 % | 0.999 |
| `p3-m20` | `dbts_a1` | r5000 4× | 4 | yes | 0.004 | 53 · 0 of 56 | 0.999 · ±0.1 % | 0.999 |
| `p3-m20` | `dbts_a1` | r20000-l2 1× | 3 | yes | not a clause here | 54 · 0 of 56 | 0.997 · ±0.3 % | 0.999 |
| `p3-m20` | `dbts_a1` | r20000-l2 4× | 3 | yes | not a clause here | 53 · 0 of 56 | 1.003 · ±2.6 % | 0.999 |
| `p3-m20` | `dbts_a1` | r20000-j20 1× | 8 | yes | not a clause here | 54 · 0 of 56 | 1.000 · ±0.1 % | 0.999 |
| `p3-m20` | `dbts_a1` | r20000-j20 4× | 9 | yes | not a clause here | 52 · 0 of 56 | 1.000 · ±0.1 % | 0.999 |
| `p3-m20` | `dbts_b1` | r20000 1× | 9 | yes | 0.010 | 47 · 0 of 50 | 1.046 · ±0.1 % | 1.044 **FAIL** |
| `p3-m20` | `dbts_b1` | r20000 4× | 10 | yes | 0.017 | 44 · 0 of 50 | 1.050 · ±0.1 % | 1.044 **FAIL** |
| `p3-m20` | `dbts_b1` | r50000 1× | 10 | yes | not a clause here | 46 · 0 of 50 | 1.053 · ±0.3 % | 1.044 **FAIL** |
| `p3-m20` | `dbts_b1` | r50000 4× | 10 | yes | not a clause here | 42 · 0 of 50 | 1.816 · ±0.3 % **FAIL** | 1.044 **FAIL** |
| `p3-m20` | `dbts_b1` | r5000 1× | 5 | yes | 0.003 | 46 · 0 of 50 | 1.045 · ±0.1 % | 1.044 **FAIL** |
| `p3-m20` | `dbts_b1` | r5000 4× | 5 | yes | 0.005 | 42 · 0 of 50 | 1.048 · ±0.1 % | 1.044 **FAIL** |
| `p3-m20` | `dbts_b1` | r20000-l2 1× | 3 | yes | not a clause here | 47 · 0 of 50 | 1.050 · ±2.6 % | 1.044 **FAIL** |
| `p3-m20` | `dbts_b1` | r20000-l2 4× | 3 | yes | not a clause here | 42 · 0 of 50 | 1.033 · ±3.4 % | 1.044 **FAIL** |
| `p3-m20` | `dbts_b1` | r20000-j20 1× | 10 | yes | not a clause here | 45 · 0 of 50 | 1.046 · ±0.1 % | 1.044 **FAIL** |
| `p3-m20` | `dbts_b1` | r20000-j20 4× | 9 | yes | not a clause here | 42 · 0 of 50 | 1.146 · ±0.2 % **FAIL** | 1.044 **FAIL** |
| `p3-m20` | `dbts_c1` | r20000 1× | 10 | yes | 0.011 | 67 · 0 of 69 | 1.000 · ±0.1 % | 1.000 |
| `p3-m20` | `dbts_c1` | r20000 4× | 10 | yes | 0.017 | 66 · 0 of 69 | 1.000 · ±0.2 % | 1.000 |
| `p3-m20` | `dbts_c1` | r50000 1× | 10 | yes | not a clause here | 67 · 54 of 69 | 1.001 · ±0.1 % | 1.000 |
| `p3-m20` | `dbts_c1` | r50000 4× | 10 | yes | not a clause here | 65 · 52 of 69 | 1.313 · ±0.3 % **FAIL** | 1.000 |
| `p3-m20` | `dbts_c1` | r5000 1× | 5 | yes | 0.003 | 67 · 0 of 69 | 1.000 · ±0.1 % | 1.000 |
| `p3-m20` | `dbts_c1` | r5000 4× | 5 | yes | 0.005 | 65 · 0 of 69 | 1.001 · ±0.1 % | 1.000 |
| `p3-m20` | `dbts_c1` | r20000-l2 1× | 3 | yes | not a clause here | 67 · 0 of 69 | 0.988 · ±0.6 % | 1.000 |
| `p3-m20` | `dbts_c1` | r20000-l2 4× | 3 | yes | not a clause here | 65 · 0 of 69 | 1.013 · ±0.5 % | 1.000 |
| `p3-m20` | `dbts_c1` | r20000-j20 1× | 9 | yes | not a clause here | 66 · 0 of 69 | 1.000 · ±0.1 % | 1.000 |
| `p3-m20` | `dbts_c1` | r20000-j20 4× | 10 | yes | not a clause here | 64 · 0 of 69 | 1.005 · ±0.2 % | 1.000 |
| `p3-m30` | `dbts_a1` | r20000 1× | 10 | yes | 0.010 | 54 · 0 of 56 | 0.998 · ±0.1 % | 0.997 |
| `p3-m30` | `dbts_a1` | r20000 4× | 10 | yes | 0.014 | 53 · 0 of 56 | 0.997 · ±0.1 % | 0.997 |
| `p3-m30` | `dbts_a1` | r50000 1× | 10 | yes | not a clause here | 54 · 31 of 56 | 0.999 · ±0.2 % | 0.997 |
| `p3-m30` | `dbts_a1` | r50000 4× | 10 | yes | not a clause here | 53 · 29.5 of 56 | 1.261 · ±0.4 % **FAIL** | 0.997 |
| `p3-m30` | `dbts_a1` | r5000 1× | 4 | yes | 0.003 | 54 · 0 of 56 | 0.998 · ±0.1 % | 0.997 |
| `p3-m30` | `dbts_a1` | r5000 4× | 5 | yes | 0.005 | 52 · 0 of 56 | 0.997 · ±0.1 % | 0.997 |
| `p3-m30` | `dbts_a1` | r20000-l2 1× | 3 | yes | not a clause here | 54 · 0 of 56 | 0.993 · ±0.3 % | 0.997 |
| `p3-m30` | `dbts_a1` | r20000-l2 4× | 3 | yes | not a clause here | 53 · 0 of 56 | 0.994 · ±2.6 % | 0.997 |
| `p3-m30` | `dbts_a1` | r20000-j20 1× | 9 | yes | not a clause here | 53 · 0 of 56 | 0.998 · ±0.1 % | 0.997 |
| `p3-m30` | `dbts_a1` | r20000-j20 4× | 7 | yes | not a clause here | 52 · 0 of 56 | 0.999 · ±0.1 % | 0.997 |
| `p3-m30` | `dbts_b1` | r20000 1× | 8 | yes | 0.011 | 47 · 0 of 50 | 1.023 · ±0.1 % | 1.022 **FAIL** |
| `p3-m30` | `dbts_b1` | r20000 4× | 10 | yes | 0.017 | 43 · 0 of 50 | 1.032 · ±0.1 % | 1.022 **FAIL** |
| `p3-m30` | `dbts_b1` | r50000 1× | 10 | yes | not a clause here | 46 · 0 of 50 | 1.030 · ±0.3 % | 1.022 **FAIL** |
| `p3-m30` | `dbts_b1` | r50000 4× | 10 | yes | not a clause here | 42 · 0 of 50 | 1.811 · ±0.3 % **FAIL** | 1.022 **FAIL** |
| `p3-m30` | `dbts_b1` | r5000 1× | 4 | yes | 0.003 | 47 · 0 of 50 | 1.022 · ±0.1 % | 1.022 **FAIL** |
| `p3-m30` | `dbts_b1` | r5000 4× | 4 | yes | 0.005 | 42 · 0 of 50 | 1.024 · ±0.1 % | 1.022 **FAIL** |
| `p3-m30` | `dbts_b1` | r20000-l2 1× | 3 | yes | not a clause here | 47 · 0 of 50 | 1.021 · ±2.6 % | 1.022 **FAIL** |
| `p3-m30` | `dbts_b1` | r20000-l2 4× | 3 | yes | not a clause here | 42 · 0 of 50 | 1.028 · ±3.4 % | 1.022 **FAIL** |
| `p3-m30` | `dbts_b1` | r20000-j20 1× | 9 | yes | not a clause here | 46 · 0 of 50 | 1.026 · ±0.1 % | 1.022 **FAIL** |
| `p3-m30` | `dbts_b1` | r20000-j20 4× | 10 | yes | not a clause here | 42 · 0 of 50 | 1.135 · ±0.2 % **FAIL** | 1.022 **FAIL** |
| `p3-m30` | `dbts_c1` | r20000 1× | 10 | yes | 0.011 | 67 · 0 of 69 | 0.995 · ±0.1 % | 0.994 |
| `p3-m30` | `dbts_c1` | r20000 4× | 10 | yes | 0.016 | 66 · 0 of 69 | 0.995 · ±0.2 % | 0.994 |
| `p3-m30` | `dbts_c1` | r50000 1× | 10 | yes | not a clause here | 67 · 54 of 69 | 0.995 · ±0.1 % | 0.994 |
| `p3-m30` | `dbts_c1` | r50000 4× | 10 | yes | not a clause here | 65 · 52 of 69 | 1.311 · ±0.3 % **FAIL** | 0.994 |
| `p3-m30` | `dbts_c1` | r5000 1× | 4 | yes | 0.003 | 67 · 0 of 69 | 0.994 · ±0.1 % | 0.994 |
| `p3-m30` | `dbts_c1` | r5000 4× | 5 | yes | 0.005 | 65 · 0 of 69 | 0.995 · ±0.1 % | 0.994 |
| `p3-m30` | `dbts_c1` | r20000-l2 1× | 3 | yes | not a clause here | 67 · 0 of 69 | 0.994 · ±0.6 % | 0.994 |
| `p3-m30` | `dbts_c1` | r20000-l2 4× | 3 | yes | not a clause here | 66 · 0 of 69 | 1.008 · ±0.5 % | 0.994 |
| `p3-m30` | `dbts_c1` | r20000-j20 1× | 9 | yes | not a clause here | 66 · 0 of 69 | 0.995 · ±0.1 % | 0.994 |
| `p3-m30` | `dbts_c1` | r20000-j20 4× | 10 | yes | not a clause here | 65 · 0 of 69 | 0.998 · ±0.2 % | 0.994 |

## For the owner: what each variant gives, at each link

Each entry is the range over the three volumes of each volume's median over kept rounds.
* *first picture*: the first frame drawn of any kind.
* *every slice with a base*: t_P. For `res` this is its half-size prefix; `htj2k` and `k2` have no base.
* *time to exact*: t_X.
* *bytes ÷ `k2`*: the bytes test.

The `none` link is left out: there the host saturates at the relay, so its rows measure that relay ([`svc-results.md`](svc-results.md) §Host). 5 Mbit/s is 3 of 10 rounds. The 2 % loss link has not run.

| link, CPU | variant | first picture, s | every slice with a base, s | time to exact, s | bytes ÷ `k2` |
| --- | --- | --- | --- | --- | --- |
| r5000 1× | `htj2k` | 2.48–3.87 | no base | 110.5–175.0 | 1.055–1.065 |
| r5000 1× | `res` | 0.61–1.07 | 30.0–47.5 (its half-size prefix) | 110.5–175.1 | 1.055–1.065 |
| r5000 1× | `k2` | 2.55–3.82 | no base | 104.9–164.5 | 1.000 |
| r5000 1× | `a2-q20` | 0.07–0.10 | 0.28–0.47 | 105.0–164.8 | 1.001–1.002 |
| r5000 1× | `a2-q40` | 0.09–0.10 | 0.26–0.47 | 104.9–164.6 | 1.000 |
| r5000 1× | `p2-q20` | 0.07–0.10 | 0.28–0.48 | 104.0–165.3 | 0.989–1.005 |
| r5000 1× | `p2-q40` | 0.09–0.10 | 0.26–0.45 | 104.2–165.8 | 0.992–1.007 |
| r5000 1× | `p3-m10` | 0.09 | 0.28–0.43 | 109.1–192.4 | 1.040–1.170 |
| r5000 1× | `p3-m20` | 0.08–0.11 | 0.27–0.50 | 104.8–171.8 | 0.999–1.044 |
| r5000 1× | `p3-m30` | 0.08–0.10 | 0.29–0.48 | 104.6–168.1 | 0.994–1.022 |
| r5000 1× | `lossy-q20` | 0.07–0.11 | 0.29–0.51 | never exact | 0.001–0.002 |
| r5000 1× | `lossy-m20` | 0.09–0.10 | 0.27–0.47 | never exact | 0.008–0.036 |
| r5000 4× | `htj2k` | 2.63–4.21 | no base | 110.6–175.3 | 1.055–1.065 |
| r5000 4× | `res` | 0.69–1.19 | 30.0–47.6 (its half-size prefix) | 110.6–175.3 | 1.055–1.065 |
| r5000 4× | `k2` | 2.86–4.46 | no base | 105.1–165.0 | 1.000 |
| r5000 4× | `a2-q20` | 0.13–0.19 | 0.50–0.91 | 105.2–165.4 | 1.001–1.002 |
| r5000 4× | `a2-q40` | 0.12–0.18 | 0.45–0.97 | 105.2–165.1 | 1.000 |
| r5000 4× | `p2-q20` | 0.13–0.21 | 0.51–0.94 | 104.2–166.2 | 0.989–1.005 |
| r5000 4× | `p2-q40` | 0.12–0.18 | 0.48–0.92 | 104.5–166.5 | 0.992–1.007 |
| r5000 4× | `p3-m10` | 0.13–0.20 | 0.45–0.94 | 109.3–193.1 | 1.040–1.170 |
| r5000 4× | `p3-m20` | 0.12–0.20 | 0.49–0.92 | 105.1–172.7 | 0.999–1.044 |
| r5000 4× | `p3-m30` | 0.13–0.20 | 0.49–0.94 | 104.9–169.1 | 0.994–1.022 |
| r5000 4× | `lossy-q20` | 0.13–0.19 | 0.56–1.02 | never exact | 0.001–0.002 |
| r5000 4× | `lossy-m20` | 0.12–0.19 | 0.49–0.92 | never exact | 0.008–0.036 |
| r20000 1× | `htj2k` | 0.73–1.12 | no base | 27.8–43.9 | 1.055–1.065 |
| r20000 1× | `res` | 0.30–0.42 | 7.61–12.0 (its half-size prefix) | 27.8–43.9 | 1.055–1.065 |
| r20000 1× | `k2` | 0.76–1.20 | no base | 26.4–41.3 | 1.000 |
| r20000 1× | `a2-q20` | 0.07–0.08 | 0.26–0.43 | 26.4–41.4 | 1.001–1.002 |
| r20000 1× | `a2-q40` | 0.09–0.10 | 0.24–0.42 | 26.4–41.4 | 1.000 |
| r20000 1× | `p2-q20` | 0.07–0.08 | 0.26–0.44 | 26.2–41.6 | 0.989–1.005 |
| r20000 1× | `p2-q40` | 0.08–0.10 | 0.25–0.44 | 26.2–41.7 | 0.992–1.007 |
| r20000 1× | `p3-m10` | 0.08–0.10 | 0.25–0.42 | 27.4–48.4 | 1.040–1.170 |
| r20000 1× | `p3-m20` | 0.08–0.10 | 0.25–0.45 | 26.4–43.2 | 0.999–1.044 |
| r20000 1× | `p3-m30` | 0.08–0.10 | 0.28–0.46 | 26.3–42.3 | 0.994–1.022 |
| r20000 1× | `lossy-q20` | 0.07–0.09 | 0.25–0.44 | never exact | 0.001–0.002 |
| r20000 1× | `lossy-m20` | 0.08–0.09 | 0.27–0.44 | never exact | 0.008–0.036 |
| r20000 4× | `htj2k` | 0.83–1.39 | no base | 27.8–44.1 | 1.055–1.065 |
| r20000 4× | `res` | 0.34–0.55 | 7.63–12.1 (its half-size prefix) | 27.8–44.1 | 1.055–1.065 |
| r20000 4× | `k2` | 1.03–1.71 | no base | 26.6–41.8 | 1.000 |
| r20000 4× | `a2-q20` | 0.10–0.16 | 0.47–0.80 | 26.6–41.9 | 1.001–1.002 |
| r20000 4× | `a2-q40` | 0.11–0.15 | 0.41–0.76 | 26.6–41.8 | 1.000 |
| r20000 4× | `p2-q20` | 0.11–0.16 | 0.45–0.78 | 26.4–42.2 | 0.989–1.005 |
| r20000 4× | `p2-q40` | 0.12–0.16 | 0.42–0.74 | 26.4–42.3 | 0.992–1.007 |
| r20000 4× | `p3-m10` | 0.12–0.16 | 0.41–0.76 | 27.6–48.9 | 1.040–1.170 |
| r20000 4× | `p3-m20` | 0.11–0.15 | 0.44–0.74 | 26.6–43.8 | 0.999–1.044 |
| r20000 4× | `p3-m30` | 0.11–0.16 | 0.40–0.75 | 26.5–43.1 | 0.994–1.022 |
| r20000 4× | `lossy-q20` | 0.12–0.15 | 0.45–0.76 | never exact | 0.001–0.002 |
| r20000 4× | `lossy-m20` | 0.11–0.15 | 0.45–0.78 | never exact | 0.008–0.036 |
| r50000 1× | `htj2k` | 0.44–0.77 | no base | 11.3–17.8 | 1.055–1.065 |
| r50000 1× | `res` | 0.29–0.35 | 3.20–4.97 (its half-size prefix) | 11.3–17.8 | 1.055–1.065 |
| r50000 1× | `k2` | 0.48–0.85 | no base | 10.8–16.8 | 1.000 |
| r50000 1× | `a2-q20` | 0.07–0.09 | 0.27–0.47 | 10.8–16.8 | 1.001–1.002 |
| r50000 1× | `a2-q40` | 0.09–0.10 | 0.26–0.47 | 10.8–16.8 | 1.000 |
| r50000 1× | `p2-q20` | 0.07–0.09 | 0.27–0.48 | 10.7–17.0 | 0.989–1.005 |
| r50000 1× | `p2-q40` | 0.09–0.11 | 0.27–0.48 | 10.7–17.0 | 0.992–1.007 |
| r50000 1× | `p3-m10` | 0.09–0.10 | 0.26–0.47 | 11.2–19.8 | 1.040–1.170 |
| r50000 1× | `p3-m20` | 0.08–0.10 | 0.27–0.47 | 10.8–17.7 | 0.999–1.044 |
| r50000 1× | `p3-m30` | 0.09–0.11 | 0.29–0.49 | 10.7–17.3 | 0.994–1.022 |
| r50000 1× | `lossy-q20` | 0.07–0.09 | 0.27–0.44 | never exact | 0.001–0.002 |
| r50000 1× | `lossy-m20` | 0.09–0.10 | 0.29–0.50 | never exact | 0.008–0.036 |
| r50000 4× | `htj2k` | 0.55–1.09 | no base | 11.3–18.0 | 1.055–1.065 |
| r50000 4× | `res` | 0.35–0.48 | 3.21–5.03 (its half-size prefix) | 11.3–18.0 | 1.055–1.065 |
| r50000 4× | `k2` | 0.82–1.76 | no base | 11.0–18.7 | 1.000 |
| r50000 4× | `a2-q20` | 0.12–0.18 | 0.52–0.87 | 12.3–22.7 | 1.001–1.002 |
| r50000 4× | `a2-q40` | 0.12–0.18 | 0.45–0.86 | 12.3–22.3 | 1.000 |
| r50000 4× | `p2-q20` | 0.13–0.19 | 0.52–0.93 | 11.8–22.7 | 0.989–1.005 |
| r50000 4× | `p2-q40` | 0.12–0.18 | 0.46–0.88 | 11.8–22.9 | 0.992–1.007 |
| r50000 4× | `p3-m10` | 0.13–0.18 | 0.47–0.90 | 13.8–35.4 | 1.040–1.170 |
| r50000 4× | `p3-m20` | 0.13–0.17 | 0.50–0.86 | 13.9–33.8 | 0.999–1.044 |
| r50000 4× | `p3-m30` | 0.13–0.18 | 0.46–0.86 | 13.9–34.6 | 0.994–1.022 |
| r50000 4× | `lossy-q20` | 0.12–0.19 | 0.50–0.91 | never exact | 0.001–0.002 |
| r50000 4× | `lossy-m20` | 0.13–0.16 | 0.46–0.84 | never exact | 0.008–0.036 |
| r20000-l2 1× | `htj2k` | 2.62–8.03 | no base | 248.9–400.6 | 1.055–1.065 |
| r20000-l2 1× | `res` | 0.46–1.19 | 68.6–109.6 (its half-size prefix) | 246.4–395.7 | 1.055–1.065 |
| r20000-l2 1× | `k2` | 2.55–6.93 | no base | 236.0–372.0 | 1.000 |
| r20000-l2 1× | `a2-q20` | 0.07–0.10 | 0.28–0.54 | 233.8–371.7 | 1.001–1.002 |
| r20000-l2 1× | `a2-q40` | 0.08–0.13 | 0.26–0.49 | 237.1–368.8 | 1.000 |
| r20000-l2 1× | `p2-q20` | 0.07–0.11 | 0.28–0.49 | 233.7–372.7 | 0.989–1.005 |
| r20000-l2 1× | `p2-q40` | 0.10 | 0.30–0.42 | 234.5–373.5 | 0.992–1.007 |
| r20000-l2 1× | `p3-m10` | 0.09–0.11 | 0.29–0.49 | 246.0–431.8 | 1.040–1.170 |
| r20000-l2 1× | `p3-m20` | 0.09–0.10 | 0.29–0.46 | 235.2–382.9 | 0.999–1.044 |
| r20000-l2 1× | `p3-m30` | 0.10 | 0.28–0.46 | 233.8–375.5 | 0.994–1.022 |
| r20000-l2 1× | `lossy-q20` | 0.08–0.10 | 0.25–0.49 | never exact | 0.001–0.002 |
| r20000-l2 1× | `lossy-m20` | 0.09–0.13 | 0.25–0.48 | never exact | 0.008–0.036 |
| r20000-l2 4× | `htj2k` | 2.80–7.64 | no base | 248.4–395.0 | 1.055–1.065 |
| r20000-l2 4× | `res` | 0.41–1.22 | 69.8–109.5 (its half-size prefix) | 250.2–392.6 | 1.055–1.065 |
| r20000-l2 4× | `k2` | 1.79–7.10 | no base | 235.6–372.1 | 1.000 |
| r20000-l2 4× | `a2-q20` | 0.13–0.15 | 0.55–0.85 | 237.8–370.5 | 1.001–1.002 |
| r20000-l2 4× | `a2-q40` | 0.12–0.18 | 0.50–0.90 | 236.8–370.4 | 1.000 |
| r20000-l2 4× | `p2-q20` | 0.11–0.20 | 0.50–0.90 | 236.9–372.5 | 0.989–1.005 |
| r20000-l2 4× | `p2-q40` | 0.12–0.19 | 0.44–0.93 | 234.4–372.5 | 0.992–1.007 |
| r20000-l2 4× | `p3-m10` | 0.12–0.20 | 0.49–0.92 | 247.0–433.1 | 1.040–1.170 |
| r20000-l2 4× | `p3-m20` | 0.13–0.17 | 0.47–0.92 | 235.4–383.8 | 0.999–1.044 |
| r20000-l2 4× | `p3-m30` | 0.12–0.18 | 0.47–0.90 | 235.2–378.7 | 0.994–1.022 |
| r20000-l2 4× | `lossy-q20` | 0.13–0.19 | 0.53–0.93 | never exact | 0.001–0.002 |
| r20000-l2 4× | `lossy-m20` | 0.14–0.20 | 0.51–0.93 | never exact | 0.008–0.036 |
| r20000-j20 1× | `htj2k` | 0.90–1.33 | no base | 27.9–44.0 | 1.055–1.065 |
| r20000-j20 1× | `res` | 0.40–0.54 | 7.72–12.1 (its half-size prefix) | 27.9–44.1 | 1.055–1.065 |
| r20000-j20 1× | `k2` | 0.96–1.40 | no base | 26.5–41.5 | 1.000 |
| r20000-j20 1× | `a2-q20` | 0.10–0.12 | 0.32–0.57 | 26.5–41.6 | 1.001–1.002 |
| r20000-j20 1× | `a2-q40` | 0.10–0.13 | 0.30–0.51 | 26.5–41.5 | 1.000 |
| r20000-j20 1× | `p2-q20` | 0.10–0.11 | 0.32–0.55 | 26.3–41.8 | 0.989–1.005 |
| r20000-j20 1× | `p2-q40` | 0.10–0.12 | 0.33–0.51 | 26.4–41.9 | 0.992–1.007 |
| r20000-j20 1× | `p3-m10` | 0.10–0.12 | 0.30–0.55 | 27.6–48.6 | 1.040–1.170 |
| r20000-j20 1× | `p3-m20` | 0.10–0.13 | 0.31–0.56 | 26.5–43.4 | 0.999–1.044 |
| r20000-j20 1× | `p3-m30` | 0.09–0.13 | 0.30–0.53 | 26.4–42.5 | 0.994–1.022 |
| r20000-j20 1× | `lossy-q20` | 0.09–0.12 | 0.32–0.57 | never exact | 0.001–0.002 |
| r20000-j20 1× | `lossy-m20` | 0.11–0.13 | 0.31–0.56 | never exact | 0.008–0.036 |
| r20000-j20 4× | `htj2k` | 1.06–1.76 | no base | 28.0–44.3 | 1.055–1.065 |
| r20000-j20 4× | `res` | 0.49–0.69 | 7.75–12.2 (its half-size prefix) | 27.9–44.3 | 1.055–1.065 |
| r20000-j20 4× | `k2` | 1.31–2.12 | no base | 26.8–42.1 | 1.000 |
| r20000-j20 4× | `a2-q20` | 0.15–0.21 | 0.63–1.16 | 26.9–42.6 | 1.001–1.002 |
| r20000-j20 4× | `a2-q40` | 0.15–0.21 | 0.56–1.01 | 26.9–42.4 | 1.000 |
| r20000-j20 4× | `p2-q20` | 0.15–0.21 | 0.63–1.05 | 26.6–43.0 | 0.989–1.005 |
| r20000-j20 4× | `p2-q40` | 0.15–0.23 | 0.51–1.02 | 26.6–43.2 | 0.992–1.007 |
| r20000-j20 4× | `p3-m10` | 0.15–0.20 | 0.57–1.08 | 27.8–52.3 | 1.040–1.170 |
| r20000-j20 4× | `p3-m20` | 0.16–0.21 | 0.55–1.04 | 26.8–48.3 | 0.999–1.044 |
| r20000-j20 4× | `p3-m30` | 0.14–0.21 | 0.58–1.14 | 26.8–47.8 | 0.994–1.022 |
| r20000-j20 4× | `lossy-q20` | 0.15–0.24 | 0.61–1.13 | never exact | 0.001–0.002 |
| r20000-j20 4× | `lossy-m20` | 0.15–0.21 | 0.55–1.00 | never exact | 0.008–0.036 |

## Sources and how it was made

* Rows: [`svc-rows.jsonl`](svc-rows.jsonl), from [`svc-results.md`](svc-results.md): `none` and 20 Mbit/s, 10 rounds.
* Rows: [`svc-rows-r50000.jsonl`](svc-rows-r50000.jsonl), from [`svc-results-r50000.md`](svc-results-r50000.md): 50 Mbit/s, 10 rounds.
* The `jsonl` blocks inside [`svc-results-r5000.md`](svc-results-r5000.md) (5 Mbit/s, rounds 0–4), [`svc-results-r20000-jitter20.md`](svc-results-r20000-jitter20.md) (±20 ms jitter, 10 rounds) and [`svc-results-r20000-loss2.md`](svc-results-r20000-loss2.md) (2 % loss, rounds 0–2).

Read at branch commit `e8fc8c69`. From this directory:

```bash
{ cat svc-rows.jsonl svc-rows-r50000.jsonl
  for f in svc-results-r5000.md svc-results-r20000-jitter20.md svc-results-r20000-loss2.md; do sed -n '/^```jsonl$/,/^```$/{//!p}' "$f"; done; } > /tmp/all.jsonl
python3 svc_tables.py /tmp/all.jsonl - | sed -n '/Part 5/,$p'   # per shape and volume
python3 svc_rule.py /tmp/all.jsonl rule                         # every cell
python3 svc_rule.py /tmp/all.jsonl owner                        # the owner's table
```

`svc_rule.py` was mutated: with the t_X bound set to 1.06, it flags `p2-q20` on `dbts_a1` at 50 Mbit/s 4× (1.069×).
