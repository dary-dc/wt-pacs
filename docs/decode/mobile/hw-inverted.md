# A hardware frame inverted to its samples and checked

*Queue row MOBILE-OPT-HW-INVERTED, 2026-11-15, the option of [`new-options.md`](new-options.md) §3, §4 and §2.1
(`claude/work-ledger:docs/queue-client-2026-11-14.md`, amendments 20 and 21), worked out as its advocate, then its
disadvantages. Sources and theory, and two cloud byte cells pre-registered in §8 before either ran. Nothing run on a
device or a GPU. Every choice stays the owner's.*

Labels, as [`new-options.md`](new-options.md): **(S)** a source quoted verbatim, listed in §11 with its revision;
**(R)** a result of this repository, by its file; **(D)** derived here, the arithmetic written out; **(T)** theory,
not measured; **(M)** measured here, §9.

*(Sections 1–7 and 10–11 are being written; §8 is the pre-registration and binds the cells.)*

## 8. The cloud cells, pre-registered (2026-11-15, before any cell ran)

Two cells, by the quality study's harness (`claude/av1-noise-ratio:lab/av1/metrics` at `0a9d33ca`, the commit
DEPTH8-MEASURE's rows record), the way DEPTH8-MEASURE ran it (`claude/depth8:lab/av1/depth8/measure.py` at
`ddd3ec0e`): libaom 3.15.1 `aomenc` at the study's lossy settings, one thread a process, dav1d 1.5.4 (built, with
`LD_LIBRARY_PATH` naming it), the 19 DBT volumes from `lab/av1/fetch_data.sh` checked by their pins, G 1, every
measure at the source depth. Code and rows under `lab/decode/mobile/hw-inverted/` on this branch; predictions from
`predict.py` there (DEPTH8-THEORY's model, `claude/depth8:lab/av1/depth8/theory.py`, with this form's scale and
rounding), in `predictions.json`, written before any cell ran.

### 8.1 Cell C1: the 220-level form against DEPTH8-MEASURE's 256-level rows

**The form, `inv220-420`.** A D-bit sample v becomes the 8-bit luma code

```
c = 16 + round(v ÷ s),   s = (2^D − 1) ÷ 219        so c runs 16 … 235, 220 levels
```

and code c stands for `round((c − 16) × s)` source units. s = 1023 ÷ 219 = 4.671 at D 10 and 4095 ÷ 219 = 18.699 at
D 12 (D). Coded 8-bit 4:2:0 with both chroma planes 128, `--profile=0 --bit-depth=8 --input-bit-depth=8`, colour
range left at libaom's default (studio swing, `color_range` 0), the form the hardware route takes (§3).

**Arms.** Per volume, the Qs ascending, from `predictions.json`'s independent Q to its removal Q + 1 at both bars,
extended by DEPTH8-MEASURE's amendment A3 (the next Q until the highest tested fails 1.03, the Q below while the
lowest fails 1.00, never under Q 1); a **cut-only** row (the codes uncoded, measured as a cell); and one **A/A** cell
per Stage A volume: `cut8` at its DEPTH8-MEASURE highest Q under 1.00, re-run here, which must reproduce that row's
bytes exactly (one thread is deterministic) or the comparison is VOID for that volume. Order: DEPTH8's Stage A
volumes first (`dbts_a1`, `dbts_b1`, `dbts_c1`, `dbt12_ea1141`, `dbts_b2`, `dbts_c4`), then its Stage C order.
`cut8` and today's form are not re-run: DEPTH8-MEASURE's rows (`stage-a.jsonl`, `stage-c.jsonl` at `ddd3ec0e`) are
the comparison.

**Predictions** (each cell against its prediction, misses included):

* **I1 · the cut alone.** The cut-only row's e_N ÷ σ is r ÷ σ per frame within 3 %, with r the RMS of the form's
  rounding over every source value: **1.363** at D 10 and **5.401** at D 12 (D, `predict.py`; s ÷ √12 gives 1.348 and
  5.398). Against the 256-level cut's 1.118 and 4.61 that is 1.219× and 1.172×.
* **I2 · the highest Q.** The highest Q with every frame's e_N ÷ σ ≤ 1.00 lies in the table's interval (the
  independent and the removal model), and at or under `cut8`'s measured highest Q on every volume.
* **I3 · bytes.** `inv220-420` ÷ `cut8`, each at its highest Q under 1.00, lies in the table's interval widened 10 %
  downward (DEPTH8's bytes-model allowance); volumes without stored-form cells have no interval and are reported
  only. Over all: **0.94–1.38** (so 1.07–2.57 × today's view, by DEPTH8's 1.14–1.86).
* **I4 · the range.** Decoded luma outside 16…235 is counted per cell (samples, frames, the extreme). Theory: the
  coding error overshoots at the range's ends wherever the source reaches its extremes; predicted under 10⁻⁴ of the
  samples and at most 4 codes beyond, at every Q in the plan. A miss here is the ingest's headroom question of §5.
* **I5 · the chroma.** Every decoded chroma sample is 128.

| volume | D | r ÷ σ_min | highest Q ≤ 1.00, `inv220-420` (indep.–removal) | the same, `cut8` (model) | ≤ 1.03 | bytes ÷ `cut8` |
| --- | --: | --: | --- | --- | --- | --- |
| `dbt12_c` | 12 | 0.40 | 2–6 | 4–7 | 3–7 | 0.96–1.38 |
| `dbt12_ea1141` | 12 | 0.49 | 1–5 | 2–6 | 2–6 | 1.01–1.24 |
| `dbts_a1` | 12 | 0.52 | 1–4 | 2–5 | 1–5 | 1.04–1.29 |
| `dbts_a2` | 12 | 0.50 | 1–5 | 2–6 | 1–6 | 1.01–1.25 |
| `dbts_a3` | 12 | 0.42 | 2–6 | 3–7 | 2–7 | — |
| `dbts_a4` | 12 | 0.41 | 2–6 | 3–7 | 3–7 | — |
| `dbts_a5` | 12 | 0.50 | 1–5 | 2–6 | 1–6 | — |
| `dbts_c1` | 12 | 0.45 | 2–5 | 3–6 | 2–6 | 1.01–1.13 |
| `dbts_c2` | 12 | 0.39 | 3–6 | 4–8 | 3–7 | 1.06–1.21 |
| `dbts_c3` | 12 | 0.40 | 3–6 | 4–7 | 3–7 | 0.96–1.06 |
| `dbts_c4` | 12 | 0.36 | 3–7 | 5–8 | 4–8 | 0.94–1.24 |
| `dbts_c5` | 12 | 0.44 | 2–5 | 3–6 | 2–6 | 1.01–1.13 |
| `dbt10_d` | 10 | 0.35 | 3–7 | 5–8 | 4–8 | — |
| `dbt10_ea1141` | 10 | 0.33 | 4–8 | 6–9 | 5–9 | 0.95–1.15 |
| `dbts_b1` | 10 | 0.26 | 7–10 | 9–12 | 8–12 | 1.02–1.10 |
| `dbts_b2` | 10 | 0.41 | 3–6 | 4–7 | 3–7 | 0.98–1.07 |
| `dbts_b3` | 10 | 0.25 | 7–11 | 10–13 | 9–13 | 1.00–1.24 |
| `dbts_b4` | 10 | 0.24 | 7–11 | 10–13 | 9–13 | — |
| `dbts_b5` | 10 | 0.38 | 3–7 | 4–8 | 3–8 | 0.97–1.06 |

**Mutants**, each run once and seen to fail: (n1) s = 2^(D−8) (the 256-level step) in place of (2^D − 1) ÷ 219: I1
fails, r falls to the 256-level cut's; (n2) the back map without the offset 16: I1 fails by orders of magnitude;
(n3) chroma 127: I5 fails; (n4) the range counter reading chroma in place of luma: I4's count reads zero on a frame
built to overshoot.

### 8.2 Cell C2: a second picture (§4), theory's one byte cell

On the three timed volumes only (`dbts_a1`, `dbts_b1`, `dbts_c1`), after C1. **Picture A** is `inv220-420` at a
coarse Q_A ∈ {24, 40}; its decoded reconstruction r_A, mapped back to source units as above (`back(r_A)`). **Picture
B**, 8-bit 4:2:0, chroma 128, codes what A missed, one code per source unit:

```
b = clamp(v − back(r_A) + 126, 16, 235)          shown = back(r_A) + r_B − 126
```

B at Qs ascending from 1 until its worst frame's e_N ÷ σ, measured on `shown` against the source, exceeds 1.03.
**Reported:** B's highest Q under 1.00; bytes(A) + bytes(B) at it, ÷ today's form's bytes at its own highest Q under
1.00 (DEPTH8-MEASURE's rows); the share of samples where `b` clamped, per Q_A.

**Predictions** (T): **J1** the ratio lies in 1.2–2.5 at both Q_A (a layered coding costs more than one stream at
the same quality; B codes the noise at the source's resolution, which today's stream also spends its bytes on);
**J2** the clamped share is under 10⁻³ at Q_A 24 and above it at Q_A 40 on the 12-bit volumes (A's error in source
units grows with s = 18.7). A cell that reaches neither bar at Q 1 is reported as such.

**Mutant** (n5): `shown` without the − 126: J's e_N ÷ σ rises past every bar at every Q.

**Saturation.** Every measure but wall time is deterministic at one encoder thread; no time is claimed. Each cell
records its wall time; the report says whether 4 processes saturated the host's 4 cores (`/proc/stat`).

**Fixtures and limits.** 19 DBT volumes of three systems (C2 on three); libaom 3.15.1 at cpu6, one thread; dav1d
1.5.4; one σ estimator in one band; one 4-core cloud host without a GPU; no browser, no hardware decoder, no reader.

### Amendment, before any run (2026-11-15)

Written by the measuring session before any cell ran. What the host and the harness forced:

* **A1 · Where the forms live.** As DEPTH8-MEASURE's A1: `lab/decode/mobile/hw-inverted/measure.py` loads the
  harness from a checkout of `claude/av1-noise-ratio` at `0a9d33ca` and adds `inv220-420` and `cut8` to its `forms`
  (`cut8` rewritten from DEPTH8-MEASURE's `code8`; the A/A cells check it byte for byte). No harness file is copied or
  changed; every row records the harness commit. The series rows (σ per frame) are measured again here and checked
  equal to DEPTH8-MEASURE's; DEPTH8-MEASURE's cells are read with its own σ.
* **A2 · `inv220-420`'s arguments.** The harness's non-monochrome branch tags RGB series' colour (`bt601`); as
  DEPTH8-MEASURE's A4, it is replaced by `--profile=0 --bit-depth=8 --input-bit-depth=8` and nothing else. The back
  map is applied to every decoded code 0 … 255 unclipped, as written, so an overshoot counts in e_N as well as in I4.
* **A3 · C1's starting Qs.** From bar 1.00's independent Q to the larger of the two bars' removal Q, + 1 (as
  DEPTH8-MEASURE's A3 read its own); then §8.1's extension.
* **A4 · C2's Qs.** "Ascending from 1" is about 270 cells of B: by libaom's AC tables (D), B's step in source units
  (one code a unit) reaches today's form's step at its highest Q only near 8-bit Q 44–50 on the 12-bit volumes and
  Q 33–35 on `dbts_b1`, so 50, 50 and 36 cells a chain, six chains, against C1's ~145 cells on the same 4 cores. B
  runs instead at Q 1 and every multiple of 4 ascending until the worst frame exceeds 1.03, then at every Q between
  the highest multiple whose worst frame is ≤ 1.00 and that failing Q. This assumes the worst frame rises with Q
  between the multiples; the report lists every chain's worst frame by Q, so a step down shows.
* **A5 · Picture A.** Coded once per (volume, Q_A) as a C1 cell of `inv220-420` (its row kept in `c2.jsonl`), its
  decoded luma kept outside the repository for B's cells; bytes(A) is that row's. The clamped share is counted while
  B's input is written, the same at every Q of a chain.
