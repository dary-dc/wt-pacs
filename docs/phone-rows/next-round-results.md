# The phone round of 2026-11-22, read

*PHONE-READ (`claude/work-ledger:docs/queue-client-2026-11-14.md`), 2026-11-22, by a session that wrote none of
[`next-round.md`](next-round.md), the tools or the run branch. Read from the raw rows only:
`raw/2026-11-22/` at `618dd9cd` (the round) and `raw/2026-11-22-cell3/` at `85326fd3` (cell 3 alone). Each cell is
read by `next-round.md` §4's rule and §7's limits, with its two pre-registered predictions beside it: the protocol's
(§4) and DEVICE-THEORY's (`claude/device-theory:docs/decode/mobile/device-model.md` §2 at `cf9f0b43`, pushed
2026-11-20 03:19 UTC). A prediction is* held *when the measured median is inside its band,* missed *otherwise.
Labels:* measured *(this round's rows),* derived *(arithmetic on them, written out),* theory*. Owner decisions last.*

## Fixtures and limits

One phone (Android 16, Chrome 157.0.8103.78, `hardwareConcurrency` 8, `deviceMemory` 8), on one home Wi-Fi in one
room (RSSI −27 dBm before the round, through a repeater wired to the serving laptop: `round-notes.txt`), one
laptop serving, one evening. Two DBT volumes of one dataset: `dbts_b1` (50 frames) and `dbts_a1`'s cut (56), each as
the view (`-q8-g8`, AV1) and as its exact HTJ2K series. No breast ultrasound; no other phone, link or engine. Run
commit `3dbe295a3` (RUN_CODE `a8927df1`). Software decode throughout cells 1–2 (no AV1 component in any load's
`logcat`). The thermal status read 0 through load 28 and 1 from load 29 to the end (`resources.jsonl`). The server's
first and last byte were not recorded, so no load has a measured wire time; *G* below is a lower bound.

## The round as run

* **Cell 1**: 24 loads (8 arms × 3 repetitions) and the drift check's 4 (steps 0–3 of `plan-rest.json`, after cell 3
  had stopped): all `ok`.
* **Cell 2**: 4 warm-ups and 64 counted loads; 62 `ok`. **VOID by name**: load 28 (A, `dbts_b1`, "the runner's
  timers stopped 4636 ms") and load 29 (B, `dbts_b1`, 2041 ms), both in round 0. The renderer then held
  7.6 GB (RSS + swap) after load 28, grown from 1.1 GB over loads 22–28 of one origin (`resources.jsonl`): the
  stall is the memory pressure's, read from the rows, not traced.
* **Cell 3**: loads 92–95 sent their fill record and labels, never their end batch (no verdict); load 96's renderer
  died; loads 97–139 were not run. Run again alone the same evening (PHONE-ROUND-3C): its first load in a fresh
  Chrome lost the end batch too. **Not decided**: 0 pairs of the 16 the rule needs.
* **Cell 4**: one row (`probe/rows/`, quick mode). **Cell 5**, the report cells and M1–M22 were not in the run
  commit (`SATURDAY.md`) and did not run.

## Cell 1 · decode per frame (`dbts_b1`, 50 frames in memory)

Per arm, the three repetitions (median of the 50 frames' own times; effective = span ÷ 50), *measured*:

| arm | a frame, per decoder (ms) | effective (ms) | protocol | DEVICE-THEORY |
| --- | --- | --- | --- | --- |
| HTJ2K × 1 | 40.8, 40.4, 40.2 | 41.9, 41.1, 41.0 | — | 37–59 / 37–59: **held** |
| HTJ2K × 2 | 42.0, 41.6, 42.1 | 25.5, 25.5, 25.4 | — | 41–64 / 20–32: **held** |
| HTJ2K × 3 | 58.9, 58.3, 59.4 | 18.9, 18.8, 19.0 | 76–107 / 26–36: **missed** (faster) | 43–66 / 14–22: **held** |
| HTJ2K × 4 | 60.4, 60.7, 60.7 | 15.5, 15.5, 15.4 | — | 43–67 / 11–17: **held** |
| view × 1 | 180.8, 171.5, 176.7 | 185.5, 178.3, 181.0 | — | 85–125 / 85–125: **missed** (slower) |
| view × 2 | 123.4, 135.4, 115.1 | 65.5, 75.1, 69.8 | — | 104–136 held / 52–68: **missed** (69.8) |
| view × 3 | 115.1, 110.2, 108.9 | 46.3, 42.1, 40.2 | 133–135 / ~45: per frame **missed** (faster), effective held | 125–145 **missed** / 42–48 held |
| view × 4 | 118.8, 117.6, 119.9 | 37.8, 46.2, 50.8 | — | 140–175 **missed** / 35–44: **missed** (46.2) |

* **Saturation** (the smallest count within 10 % of the next, on the repetitions' median): HTJ2K none within four
  (25.5 → 18.9 is −26 %, 18.9 → 15.5 −18 %; *derived*), as DEVICE-THEORY predicted, though both steps are smaller
  than its 29–33 % and 22–25 %. The view saturates at **3**: its fourth decoder is slower, 42.1 → 46.2 ms (+10 %),
  where DEVICE-THEORY predicted a gain of 8–17 % (**missed**; "3 or none" **held**).
* **The ratio** the view ÷ HTJ2K a frame per decoder at three decoders: 110.2 ÷ 58.9 = **1.87** (*derived*), against
  DEVICE-THEORY's 2.0–3.1 (**missed**, just below) and the cloud's 1.24–1.74 the protocol carried. Effective,
  42.1 ÷ 18.9 = 2.23.
* **The refutation line**: HTJ2K effective at three decoders over 26 ms would refute the model. It is 18.9 ms: the
  model stands and the protocol's carry of the cloud ratio does not. **The number LINK-TARGETS owes: 18.9 ms**
  (`dbts_b1`, three decoders, this phone).
* **Drift**: the end's arms against the start's (first repetition): HTJ2K × 1 41.9 → 43.6 (+4 %), × 3 18.9 → 19.9
  (+5 %), view × 1 185.5 → 183.0 (−1 %), view × 3 46.3 → 45.2 (−2 %): under 15 %, **no thermal drift** (both held).
  The end's arms ran after cell 3's renderer had died, in a fresh one.
* **Not explained**: one view decoder takes ~176 ms a frame, three take ~110 ms each. A single decoder's frames are
  slower than any of three decoders' frames. *Hypotheses, not checked*: the scheduler keeps a lone decoder's threads
  off the prime core, or its clocks low (DVFS) under a lighter load; `optimizeForLatency` serialising one decoder.
  It is where the model's single-decoder band fails, and M12/M13 would read it.
* **Route**: no AV1 or HTJ2K codec component in any load's `logcat` (only `c2.qti.vp9.decoder`, in loads 0, 81–87,
  92, 95 and before the round, and audio decoders: from outside the page, not checked); the decode is software in
  Chrome's process, as the bench records (`av1-webcodecs`, `htj2k`).

## Cell 2 · the delivery arms (three decoders, the product's default)

Fill = the beacon's `fillMs`; floor = the sum of the frames' decode times ÷ 3; rest = fill − floor. Medians over the
`ok` loads (`dbts_b1`: 7 of A and B, 8 of C1 and C2; `dbts_a1`: 8 each), *measured* and *derived*:

| | `dbts_b1-q8-g8` | `dbts_a1-q8-g8-cut` |
| --- | --- | --- |
| A, fill | **3.68 s** (3.15–4.42) | **1.20 s** (1.13–1.46) |
| A, rest | 0.25 s | 0.28 s |
| B, fill | **1.74 s** (1.51–2.54) | **0.96 s** (0.91–1.03) |
| B, floor; rest | 1.29 s; 0.45 s (0.28–1.46) | 0.62 s; 0.34 s |
| C1, exact-frame latency (the press to *✓ Lossless*) | **216 ms** (203–269) | **127 ms** (101–152) |
| C2, the view's fill + the exact series' span | 3.34 + 1.86 s | 1.36 + 1.02 s |

**The rule (pooled, pre-registered).** With round 0 VOID, 15 ratios a measure (`next-round.md` §4 fixes 13 of 16;
at 15 the sign test's two-sided p < 0.05 needs 12):

| measure | `dbts_b1` | `dbts_a1` | pooled | verdict |
| --- | --- | --- | --- | --- |
| B ÷ A | 7 of 7 below 1, median 0.513 | 8 of 8, median 0.771 | **15 of 15**, p = 2⁻¹⁴ ≈ 0.00006, median **0.705** | **B faster** |
| C2 ÷ (A + B) | 4 of 7, median 0.985 | 2 of 8, median 1.033 | 6 of 15, p = 0.61, median 1.031 | **no difference shown** |

The ratios: B ÷ A 0.513, 0.689, 0.475, 0.526, 0.439, 0.456, 0.618 (`dbts_b1`) and 0.845, 0.766, 0.875, 0.833, 0.777,
0.722, 0.705, 0.712 (`dbts_a1`). Amendment 11: round 0's VOID pair, were it counted, gives B ÷ A 0.382 and
C2 ÷ (A + B) 0.592; neither verdict moves.

**Against the predictions.**

| line | protocol | DEVICE-THEORY | measured |
| --- | --- | --- | --- |
| A, `dbts_b1` fill | 2.47–2.6 s **missed** | 2.4–3.3 s **missed** | 3.68 s, slower |
| A, `dbts_a1` fill | — | 0.79–1.21 s **held** | 1.20 s |
| B, `dbts_b1` decode floor | 1.3–1.8 s **missed** (1.29) | 0.71–1.10 s **missed** | 1.29 s |
| B, `dbts_a1` floor | — | 0.27–0.43 s **missed** | 0.62 s |
| B, fill | — | 1.65–1.78 **held**; 1.13–1.25 s **missed** | 1.74; 0.96 s |
| B ÷ A, `dbts_b1` | — | 0.50–0.74, 8 of 8 **held** | 0.513, 7 of 7 |
| B ÷ A, `dbts_a1` | — | 0.93–1.58, 0–2 of 8 **missed** | 0.771, 8 of 8 |
| B against A, pooled | *B faster* **held** | *no difference shown*, 8–10 of 16 **missed** | *B faster*, 15 of 15 |
| C2 against A + B | *no difference* **held** | *no difference* **held** | *no difference shown* |
| C1's exact-frame latency, `dbts_b1` | ~0.04 s + one HTJ2K decode (no band) | 80–130 ms **missed** | 216 ms |

* **Where the model missed** (*derived*): A on `dbts_a1` over A on `dbts_b1` is 1.20 ÷ 3.68 = 0.33 measured, where the
  model carried the cloud's work ratio 0.247 (and on 11-11's `dbts_b1` fill, 2.4–3.3 s, not this evening's 3.68 s).
  With A on `dbts_a1` at 1.2 s, B wins there once its wire is under ~0.9 s: 542.5 Mbit ÷ (1.20 − 0.29) s ≈ 600 Mbit/s,
  which this link gave. The model's threshold of 760–800 Mbit/s assumed A's middle, 1.0 s.
* **In a fill HTJ2K decodes slower than in memory**: B's frames take 52–114 ms (medians a load) on `dbts_b1` against
  the bench's 58.9 ms, and the floor is 1.29 s against 50 × 18.9 = 0.95 s. *Hypothesis, not checked*: the receive
  path and the page share the cores with the decoders.
* **The link, a lower bound** (*derived*): the whole exact series arrived within B's fastest fills, so the goodput
  over the fill was at least 859.3 Mbit ÷ 1.512 s = 568 Mbit/s (`dbts_b1`) and 542.5 ÷ 0.912 = 595 Mbit/s (`dbts_a1`).
* **Regime**: A's rest, 0.25–0.28 s, is inside the 0.22–0.35 s band: decode-bound, as predicted. B's rest on
  `dbts_b1` is 0.45 s (0.28–1.46): something past the floor binds, the wire or the receive path; which is *not read*
  (no wire time).
* **Saturation**: on the loads whose processes were read before and after, Chrome's CPU summed to at most 2.8 of the
  8 cores over the load's wall time (*derived* from `/proc/<pid>/stat`, `utime + stime`, assuming 100 ticks a
  second); the renderer is often a new process within a load, so the sum is partial. No fill shown saturated.
* **A grows over the round**: `dbts_b1`'s A fills were 2.27–3.74 s in the warm-ups and 3.15–4.42 s counted, with the
  renderer's memory carried between same-origin loads (MEMORY-LEAK-TRACE). The B ÷ A ratios are within a round, so
  they pair loads of like state; A's absolute fill is this evening's, not the product's floor.

§7: this decides the arms' order on this one link (a best case of the target), not on LTE, 5G or enterprise Wi-Fi.

## Cell 3 · the view comparison

**Not decided**: no load sent its end batch (frame-change, cine, busy, exact frame, verdict), in the round (loads
92–95) or in a fresh Chrome (PHONE-ROUND-3C's load 0). Every measure and both guards are *not decided*; the
predictions stand untested. The fills of loads 92–95 arrived (`load` records) and are not a cell-3 measure. Cell 3
waits for BEACON-LOSS (amendment 28) and PHONE-ROUND-2.

## Cell 4 · the hardware-decode probe (exploratory, deciding nothing)

*Measured*, one row; the forms of `claude/hw-decode:docs/decode/hardware.md` §17 at 16 × 16 and 256 × 256:

| form | `no-preference` / `prefer-software` | `prefer-hardware`, 16 × 16 | `prefer-hardware`, 256 × 256 |
| --- | --- | --- | --- |
| `g8`, `g10` (4:0:0) | a frame, `I420` / `I420P10`, exact | unsupported (`OperationError`) | supported, decode fails: `EncodingError` "Error during flush." |
| `g8f` (8-bit, full range) | exact | unsupported | a frame, `RGBA`; R, G and B each equal the luma, 256 distinct, exact |
| `g10f`, `ramp10` (10-bit, full range) | exact | unsupported (`ramp10` has no 16 × 16 unit) | a frame, `RGBA`, 8 bits: off by one on 19–49 k of 65 536 samples a channel |

* `logcat` names `c2.qti.av1.decoder` (292 lines) during the probe: the hardware decoder was allocated.
* `ramp10` painted: WebGL2 `RGBA16F` **1024 distinct** values, WebGPU 261, none exact (max difference 2.6 and 4.3
  codes). More than 256 values reached a WebGL2 shader from a hardware frame.
* §17's predictions: `g8f` and `g10f` decode in hardware **held**; "come back `BGRX`" **missed** (`RGBA`; `copyTo`
  gives `RGBA`, `RGBX`, `BGRA`, `BGRX` alike); `g8`, `g10` unknown → they fail at flush; `ramp10` "at most 256 values
  on both APIs" **missed** (1024 and 261). The 16 × 16 refusal matches the codec list's minimum, 96 × 96.
* DEVICE-THEORY's "a hardware AV1 decoder is listed" **held**: `codecs.xml` lists `c2.qti.av1.decoder`, size
  96 × 96 to 8192 × 8192, 138 240 blocks, 7 776 000 blocks a second, performance points to 7680 × 4320 at 60.
  `dbts_b1`'s 2560 × 3328 is 33 280 blocks: inside the declared limits (declared, not decoded at that size).
* WebGPU: an adapter (`adreno-7xx`), `subgroups` and `shader-f16` among its features; limits not recorded.

## The decode-option asks M1–M22

Written into each option file's phone section on `claude/mobile-decode` (PR 397). None ran as asked; what the round
measured toward each:

| ask | measured this round |
| --- | --- |
| M1, M5 (forms and sizes through `prefer-hardware`) | only cell 4's 256 × 256 units; not at a volume's size, not HEVC, VP9 or H.264 |
| M2, M3, M6, M7 (the picture one-to-one; a frame inverted and checked) | not run; cell 4: an 8-bit full-range grey frame came back as `RGBA` equal to its luma at 256 × 256 |
| M4 (codec lists and sizes) | the list read (`probe-shell/codecs.xml`): AV1 `c2.qti.av1.decoder` to 8192 × 8192; HEVC and VP9 hardware to 4096 × 2176, which `dbts_b1` exceeds in both orientations (declared); Android's software AV1 to 1920 × 1080; the `getSupported…` calls not run |
| M8–M11, M13–M19, M21, M22 | not run |
| M12 (decoders to `hardwareConcurrency`) | `hardwareConcurrency` 8; cell 1 to four only: the view saturates at three |
| M20 (the WebGPU decoder) | the adapter and `subgroups` only; no decode |

## Octets (amendments 7, 11)

The 11-11 run's six-octet reading stays the reading of record. This round's rule counts time loads ran and stopped
no load: cell 2's budget was not reached, round 0's two VOID loads are reported above with the verdict unchanged by
them, and cell 3's lost loads ran but returned no measure.

## Owner decisions

1. **The delivery on fast Wi-Fi.** On this phone and link the exact series alone (B) filled faster than the view (A)
   in 15 of 15 rounds, median 0.705, on both volumes; DEVICE-THEORY predicted a tie. The question belongs to the
   delivery page (`delivery-per-link`): whether B is the route above a goodput this round bounds at ≥ 568–595 Mbit/s.
   A yes queues the per-link sweep `docs/client/design.md` §Open owes; a no keeps the view first everywhere. Nothing
   is decided here.
2. **The device model.** HTJ2K's bands held at every decoder count; the view's missed at one and four decoders, and
   the cell-2 outcome missed. Recalibrating the model's view (AV1) speed and its `dbts_a1` work ratio from this
   round is ROUTE-POLICY's input: the owner's yes is to the page that uses it, not here.
3. **Cell 3 is open.** The view comparison needs a round whose end batch arrives (BEACON-LOSS) and a fresh renderer
   per load (amendment 28 item 8); the guard form (a), 52 ms, stays as chosen.
