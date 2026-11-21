# The delivery comparison's build: review

DELIVERY-BUILD-REVIEW, 2026-11-21, of `claude/delivery` at `32364cae` (DELIVERY-BUILD, PR 406) against its protocol,
[`../client/evidence/delivery-comparison.md`](../client/evidence/delivery-comparison.md) (DELIVERY-PROTOCOL), by a
session that wrote neither. Scope: the build's own commits `e8390ef7..32364cae` and `7ab1ea70` (`lab/devices`); the
merged `claude/phone-run` is PR 409's and not reviewed here.

**Method.** The code read against §1–§10; the four unit suites run (`predict`, `judge`, `inputs`, `prefix`: all pass);
32 mutants of `predict.mjs`, `judge.mjs`, `plan.mjs` and `inputs.mjs` run against them; the 75 smoke rows of
`lab/delivery/rows/smoke/` re-read with the judge's own functions; `scripts/check_lab_absent.sh` green. **Not run**:
the driver, K2, K3 and §10's four driver mutants (`flip-exact`, `relay-no-loss`, `fixed-order`, `decoders-3`), which
need the coded series and the full Chromium; their outputs are taken from the build's Result. The gate was not run
(the build's Result reports it green at `32364cae`, skips named there).

## What holds

* **The arms** are §1's: one viewer, one server pair, A and A′ the same parameters (their URLs differ only by the
  `arm` label, which only the beacon reads, `lab/devices/round-page.js:13`); B the exact series alone on its own page;
  C1 `press=lossless` through the viewer's exact downloader; C2 `exactFill=1`, the load's decoder count;
  `decoders=2` on every fill; `cubic-restart`.
* **The clocks end where §5 says.** Fill: the dial (`boot.dial`) to the last frame stored (`issuedAt + fillMs`),
  epoch ms on both sides (`lab/devices/beacon.js`). Wire: the dial to the last frame's `lastByte`, the downloader's
  stamp, same clock. C2: issue to the last frame checked, read from its own `exactFill` record only. C1: the press to
  the first label reading *lossless* after it. In the smoke rows the fill ends at the last decode (to 1 ms) on all 75.
* **The model is §4.1's** (`predict.mjs`): wire, the in-order makespan on two decoders, max of the two terms with the
  last frame's decode, the 10 % regime, slow start from 12 000 B to the BDP, C2 on its own fill with the dial
  correction, the bands of §8. K3's line through two medians uses the same frame bytes as K1 (no entry framing on
  either side), so *G* and the predictions agree on what a byte is.
* **The forms** match §3 (delay one way, rate, queue, loss; RTT 2, 20, 800, 38, 40 ms), and K3 drives
  `9fad9d9b`'s runner with the same relay arguments.
* **Mutants**: 24 of 32 killed. Survivors: m5, m6, m7 below, and K1's unsorted listing (the build's own fifth,
  a sort the filesystem gives).

## Blockers

* **B1. LTE's blackout never reaches a fill, and no row says whether one came.** The driver starts the 30 s
  `blackout 40` timer when the servers are up (`run.mjs`, `setInterval` before `chromium.launch`), so the first
  blackout falls about 30 s into the load. The smoke's LTE dials at +1.2–1.5 s and its clocks end by +2.2 s (A, A′,
  C1), +5.0–15.3 s (B) and +13.3–14.0 s (C2), but for C2 on `dbts_b1` (+34.1 s): **14 of 15 loads had no blackout
  inside any clock**, and A, A′, B and C1 cannot have one unless a fill passes ~29 s. The cell runs as iid 0.1 % only,
  while §3 and the page carry it as LTE with its blackout. The relay prints each `BLACKOUT` line; `tally()` does not
  read them. Fix: each row carries the blackouts' times from the dial; and either the timer's phase is drawn per load
  (seeded, uniform over the 30 s) so the form's rate holds in expectation, or §11 says, before any counted row, that
  LTE runs without in-fill blackouts and the page may not carry them. The same timer is in `9fad9d9b`'s runner, so
  K3's LTE goodput has none either: whatever the fix, K3 and the cell must agree.
* **B2. A cell with fewer than 8 counted rounds reads as a model miss.** `holds()` needs 8 rounds in band, counted
  absolutely, as §8 says; a cell where VOIDs leave 7 or fewer can never hold, and `line()` prints it `MISSES in`, the
  same words as a measured miss. The smoke's guard voided 8 of 15 CLEAN and 5 of 15 PUB loads (re-read: all decode
  bound, cores 2–3 at 0.51–0.99 busy, cores 0–1 at 0.05–0.15, and this review's container, the same 4-core kind, has no SMT siblings by `lscpu`), so at that rate the
  decode side, the one thing the run alone can test (§4.3, §9), would be reported missed on every CLEAN and PUB cell
  without a ratio leaving its band. Fix, inside the rule: a (cell, volume, arm) with under 8 counted rounds is printed
  `CANNOT HOLD: n counted` with its median and side, never `MISSES`; the pilot prints each cell's VOID share by
  reason, so the run's §11 amendment (or the owner, the build's open question) settles the guard before CLEAN.

## Minors

* m1. C1 presses 1.1–2.8 s after its fill ends, not §1's 1 s (smoke, all 15 C1 loads; `dbts_b1` the latest):
  `pressAfter` counts from the hook's start, which waits for the label and the button. The exact session is idle
  either way, so the latency's prediction does not move; record the press's offset from `fillTo` in each C1 row, and
  time it from `fillTo` if one line, else an amendment.
* m2. §6 voids a decoder count "other than 2 (C1's exact downloader: 1)"; the judge voids only more than 2, reads
  back the view's fill only, and neither C2's second fill nor C1's downloader. A wire-bound fill can read back 1 with
  two decoders, so "more than" is defensible: say so in §11, and read C2's `exactFill` frames back too.
* m3. §5's C1 "ask → last byte" is not in the rows (only `label` and `lossless` records are kept); nor are §5's two
  decode floors (Σ `decodeMs` ÷ 2, and the makespan) printed per load. Both are recomputable from the rows' frames but
  the first is not: add the exact frame's last byte.
* m4. `--pilot-medians` takes a file nothing writes: the pilot rows' median per (cell, volume, arm) should come from
  the judge or the driver, not by hand; and the 3× rule is applied to the fill only, not to C1's latency or C2's span.
* m5. §7's input feeds A′ as both the copy and the arm judged (`aaCells`), so `aa_rule.py` can only return `tie`
  (the A/A spread's detectable loss at most 5 %) or `not conclusive`, never `worse` or `better`: a biased A′ (all its
  rounds 10 % slower) passes as a tie. That reading may be what §7 needs (it uses the pair's spread only), but print
  A′ ÷ A's median beside it and say so in the README. Mutant `arm: at("A")` survives.
* m6. `plan.mjs`'s forms are not tested against §3's table: mutants CR at 400 ms RTT, LTE without its 0.1 %, PUB's
  queue at 300 and the Gilbert–Elliott *p* without its `1 − m` all pass the suites. One test pinning `CELLS` to §3.
* m7. Two judge and model choices no test pins: B's measured regime with units of 1 frame (a mutant using the view's 8
  survives), and C1's prediction on the frame on screen (frame 1 instead of 0 survives; the synthetic frames are equal).

## Observations for the run (not the build's)

* The smoke's A fills on CLEAN are 2.0–2.8 s (`dbts_a1`, `dbts_c1`) and 7.2–7.5 s (`dbts_b1`) against §4.3's 0.87,
  1.10, 2.95: K2 must carry this host's decode, and §4.3's 25 % clause will fire. B lands within 0.5 % of §4.3.
* On LTE, C2's span is 3.1× B's fill on `dbts_a1` (11.5 s against 3.76 s) for the same 16 frames, link and seed, with
  no blackout in either; 0.8× on `dbts_c1`. The model predicts them equal. One smoke round decides nothing; the run's
  rows will say whether C2 misses for a reason the model lacks (a third session live, its idle view session).

## Verdict

Two blockers (B1, B2), seven minors. Amendment 17: DELIVERY-BUILD-FIX and DELIVERY-BUILD-FIX-REVIEW appended to
`claude/work-ledger:docs/queue-2026-11-14.md` §Rows; DELIVERY-RUN waits on the re-review with no blocker open.

Fixtures and limits: the smoke rows only (one uncounted round a cell, the three timed volumes `dbts_a1`, `dbts_b1`,
`dbts_c1` at Q 8 G 8 and their HTJ2K series, one 4-core cloud container, full headless Chromium 153, software decode,
the userspace TUN relay at ≤ 90 Mbit, no radio); nothing measured by this review.
