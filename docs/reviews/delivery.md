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

## Re-review

DELIVERY-BUILD-FIX-REVIEW, 2026-11-21, of `ffbdccf3..4a904bb2` (`6ad647cf`, `4a904bb2`), by a session that wrote none
of the protocol, the build, the review or the fix.

**Method.** The three unit suites (`judge`, `predict`, `inputs`) at `4a904bb2`: all pass. Each fix reverted with its
tests kept (the file at `ffbdccf3`): both suites fail. 19 mutants of `plan.mjs` and `judge.mjs`'s new code run
against them. `k3-blackout.patch` applied to a worktree at `9fad9d9bf`: it applies, the runner parses, and k3.sh's
reverse check makes it idempotent. The 150 LTE phases `cellLoads("LTE")` draws, read per arm and per (round, volume).
`scripts/check_lab_absent.sh`, `scripts/comment_budget.sh` and `scripts/check_links.py` green. **Not run**: the gate
(the fix's Result reports it green at `4a904bb2`, skips named in PR 406), the driver and `k3.sh` end to end (they need
the coded series).

**B1, closed.** Each LTE load's first blackout is at a phase in [0, 30 s) from the servers' start, seeded by
(cell, round, volume, arm), the period after it; each row carries `blackoutPhaseMs` (spread from the plan) and
`blackoutsFromDialMs` (epoch ms on both sides, as `fillFrom` is). Killed: the old phase (30 s), phase 0, unseeded,
one phase a round, one a cell, half the period, the dial's sign, a dial-less row. K3's visits draw by the same rule
(`K3/<visit>/<prefix>`), so K3 and the cell agree. Per arm the 30 phases average 13.8–15.2 s (uniform: 15.0).

**B2, closed.** Under 8 counted rounds `holds()` sets `cannotHold` and `line()` prints `CANNOT HOLD: n counted,
median <side>`, never `MISSES`; ten rounds above the band still miss. Killed: 7 rounds as the bar, `cannotHold`
false, the old `line()`. The pilot prints each cell's `VOID` share by reason (killed: numbers kept, VOIDs not counted).

**Nothing else changed**: the diff is `lab/delivery/` (the two fixes, m2, m4–m7, README, `k3.sh` and its patch), one
line of this file's §Verdict (the ledger's branch named) and the client line doc. No product path.

### Minors (none blocks DELIVERY-RUN)

* r1. **The phases are drawn per (round, volume), not per load.** FNV-1a without a finalizer moves the high bits
  little for a key's last character, so arms whose names differ only there draw nearly the same phase: C1 and C2
  within 352 ms of each other in all 30 (round, volume) pairs (median 118 ms), A and B within 351 ms in the median
  pair; A′ (a longer key) is independent of A (median gap 10.3 s). Each arm's rate holds in expectation, so no
  cell's judgement is biased, but C1 and C2 (and A and B) meet their blackouts together, and README's "each load now
  draws" is not what runs. Either say so in README (common phases across those arms), or restore a finalizer with a
  test that C1's and C2's phases differ by more than 1 s in most pairs. The finalizer was dropped because it survived
  every test: the test pinned uniformity, not independence.
* r2. Three mutants survive: `ratios.length <= HOLD_ROUNDS` (an 8-counted cell that misses would print `CANNOT HOLD`;
  no test at n = 8); `line()` without the side (B2's "with its median and side"); `voidShares` without its `Set`
  (a load with two reasons of one kind counted twice). One check each.
* r3. The driver's wiring (`spec.blackoutPhaseMs` into the timer, `blackoutsFromDialMs` into the row) has no test and
  was not run here; the rows check themselves: the first `blackoutsFromDialMs` plus the dial's offset from the
  servers' start is the row's `blackoutPhaseMs` (or one period more). DELIVERY-RUN reads that on its pilot rows.

### Verdict

Both blockers closed, no blocker open: DELIVERY-RUN's need on this re-review is met. Three minors for the run's
session or a later fix.

Fixtures and limits: unit tests on synthetic rows and the plan's 150 LTE draws; the smoke rows not re-run; one 4-core
cloud container; nothing measured.

## Fit arm

FIT-ARM-BUILD-REVIEW, 2026-11-25, of `claude/delivery` `4819f8ffb..854372707` (FIT-ARM-BUILD, 14 commits, 25 files)
against `delivery-comparison.md` §Amendment 2 (A2.2–A2.8), by a session that wrote none of the protocol, its fix or
the build.

**Method.** Every changed file read against A2.8's build list. The three unit suites run (`inputs`, `judge`,
`predict`: pass). 13 source mutants of `judge.mjs` and `predict.mjs` run against them: 10 killed. On this 4-core
container, `dbts_b1` fetched (`lab/av1/data.json`), its HTJ2K series coded (`ingest/tools.sh`, `ingest_coded.py`),
`fit_truth.py` and `fit.mjs` run (level 1, 1280 × 1664, prefixes 26.9–27.3 % of a frame, as the build's README), and
one CLEAN FIT load on `dbts_b1` driven by `run.mjs` unmutated and under each FIT mutant, the view stood in by the
exact series as in the build's smoke. Rows: `claude/work-ledger:docs/queue/FIT-ARM-BUILD-REVIEW/*.jsonl`. **Not
re-run**: `escaped`, `k3-from-a`, `split-view-only` and SPLIT's smoke (they need the AV1 view or a lossy form);
their outputs are taken from the README. `scripts/check_lab_absent.sh` and the comment budget green; the gate as
under *Verdict*.

### What holds

* **A2.8's list is built**: FIT's series (2F entries, every level-1 prefix first, each checked whole, at the level
  from the prefix, and one byte short); the `fit` lever (FIT's worker decodes the level by the shipped package,
  clamps, checks it against `ll.py`'s truth by XXH3, joins the rest and checks the frame digest); the zoom (the rest
  asked on the fill's session, the whole frame painted only when `exact === true`); the `split` lever; K3′ from B
  loads only and its curve; A2.5's records (C1's ask → last byte, FIT's zoom with its ask → last byte, SPLIT's
  forms and *x*, every load's `Cpus_allowed_list`, NET_RX softirqs and the relay's involuntary switches); the
  switch's reading in the judge from what every view load records.
* **The stops bite, re-run here** (*measured*, one load each): unmutated, fill 2 760 ms, the window read-back equal
  byte for byte (1280 × 1664, `unequal: -1`), the zoom 257 ms with its ask → last byte 148 ms, every browser process
  on 2-3; `flip-level` → `STOP … received 49 of 50`; `no-clamp` → `received 45 of 50`; `canvas-readback` → `window
  read-back of frame 0: 8946720 bytes for 2129920 samples`; `fit-ignored` → the load passes and `judge.mjs` refuses
  (`frame 0 carried 2063.7 KiB, its level prefix 556.9 KiB`). Each is the README's line.
* **The read-back compares values**, not only sizes: a mutant of this review's, the table looked up one code high
  (`table[samples[k] + offset + 1]`), stops at sample 134 399. The page compares the decoded level, not the truth
  file, which is the same samples once the worker's XXH3 against the truth has passed.
* **A2.7 and A2.3 reproduce**: `predict.test.mjs` pins `dbts_b1`'s A, B, FIT and zoom row for every form and SPLIT
  ÷ A and *x* to the printed digit; the K3′ refusal, the 10-of-12 rule, calibration loads uncounted, the level-0
  zoom reported and `escaped` are each killed when broken.
* **The fills end alike**: A's at the controller's last frame received (`controller.js:93`), SPLIT's at its last
  frame out of a decoder; neither waits on a paint.

### Blockers

None.

### Minors (none blocks DELIVERY-RUN-2)

* **m1. The build's smoke and mutant runs left no rows.** README §Checks cites seven page-level mutant outputs and
  §What FIT-ARM-BUILD found its smoke numbers; none of their rows is on the branch (`rows/smoke/` is DELIVERY-BUILD's,
  2026-11-20). The four FIT ones are re-run above with rows; `escaped`, `k3-from-a` and `split-view-only` rest on the
  README alone. Push them, or say in README that they were not kept.
* **m2. Three unit mutants survive.** `switchReading`'s `.slice(0, group)` taken one frame longer; FIT's regime unit
  (`["B", "FIT"].includes(r.arm)` → `["B"]`, so FIT would be judged in groups of 8); and its `f.form !== "exact"`
  filter, which is dead: `beacon.js`'s `frameRow` drops `form`, so no recorded frame carries one, and SPLIT's reading
  is right only because its first group is always the view. One check each, or drop the filter and say why.
* **m3. The device kit now imports the delivery rig.** `lab/devices/bench.js` and `round-page.js` import
  `lab/delivery/fit-page.js` and `split.js` statically, so the phone round's page (kept, `docs/queue-2026-11-24.md`
  §Standing rules) breaks if `lab/delivery` is removed, and loads SPLIT's module on every round load. Import them
  only under `?fit` and `?split`, or name the dependency in `lab/devices/README.md` and `lab-list.md`.
* **m4. `canvas-readback` stops on the size alone.** Its line reads 8 946 720 bytes against 2 129 920 samples, so
  the build ran no mutant of the comparison of values; the one above (m-table, stop at 134 399) belongs in README's
  table.
* **m5. SPLIT is a lab fill outside the viewer.** Its load never dials the viewer (no store, no label, no paint per
  frame), and A's fill is the product viewer's; README names the start clocks' difference only. The main-thread work
  A does per frame and SPLIT does not is a bias toward SPLIT, not measured: say so beside A2.3's ×0.81–0.90.
* **m6. A product file changed for the lab.** `client/paint/paint-worker.js`'s `readPicture` and `painter.js`'s
  `picture` option are A2.2's "lab-only read beside `readback`", reached only from `lab/delivery/fit-page.js`;
  `client/paint/README.md` §The contract, which the painter's comment points to, does not name `picture`.

**Nits.** n1: README §What FIT-ARM-BUILD found says "the view series stood in by the exact one" while its SPLIT and A
smoke loads ran on the Q 8 G 8 view; say which loads. n2: A2.5 asks per-core softirq counts; only NET_RX is recorded
(the receive path A2.6 names): say so. n3: `flip-level` flips a decoded sample, not a byte of the prefix as A2.8
words it; the check it kills is the same.

### Observations for the run (not the build's)

* The level decode reads ×0.49 of the whole frame's here, not A2.7's ×0.29: K2 decides the run's prediction.
* The zoom is timed at the paint's issue (README), while its prediction carries 17 ms of paint; on CLEAN that is
  ~8 % of 0.20 s, toward low. This load read 257 ms (×1.28 of 0.20, inside 0.75–1.33). C1's latency has the same
  convention since the 23rd.

### Verdict
