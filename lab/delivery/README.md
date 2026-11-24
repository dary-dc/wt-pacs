# delivery: the delivery comparison's cloud rig

The build of [`docs/client/evidence/delivery-comparison.md`](../../docs/client/evidence/delivery-comparison.md) §10
(DELIVERY-BUILD), for the protocol as pre-registered: arms A, A′, B, C1, C2 through the relay's TUN plane, the model's
predictions from the host's own K1–K3, and the judge of §6–§8. Nothing here is a result: the counted rows are
DELIVERY-RUN's.

| file | what |
| --- | --- |
| `plan.mjs` | §1–§3, A2.1: the five forms (relay arguments, prefixes, K3's two prefixes), the arms' levers (`decoders=2`; C1 `press=lossless&pressAfter=1000`; FIT `fit=1&zoomAfter=1000`; SPLIT `split=1`), a cell's loads in §2's order (a Williams row of the six arms a round, 12 rounds, run for each volume, the volumes rotated by one a round), each LTE load's first blackout, K3′'s 8 B loads a lossy (form, volume) |
| `predict.mjs` | §4.1's model (wire, decode floor, fill, regime, C1's slow start from 12 000 B) with A2.3's SPLIT, A2.4's wire curve and C1's ask → last byte, A2.7's FIT fill and zoom; `predictions.json` from `inputs.json`, with its XXH3-64 by the product's hasher |
| `inputs.mjs` | §4.2: K1 (each frame's coded bytes, FIT's prefixes and rests), K2 (the bench's median per-frame decode, FIT's level decode), K3 (the line through two prefixes' medians), K3′ (A2.4's curve from B loads only) as `inputs.json` |
| `run.mjs` | the driver: one cell's loads, K2's bench loads (`--bench`) or K3′'s (`--k3-prime`), each a fresh relay, both series' servers and the page server in the relay's server namespace, a fresh browser at A2.2's viewport; raw rows as they land, the page's beacon records in each row, A2.5's cores, softirqs and the relay's involuntary switches |
| `judge.mjs` | §6–§8, A2.8: each load's `VOID` reasons (`escaped` among them) and the stop; per (cell, volume, arm, clock) the ratio's median, rounds in band, holds, misses and its side, or `CANNOT HOLD` under 10 counted rounds; a level-0 zoom reported, SPLIT's *x* beside its prediction, the switch's exact picks named; a FIT load not asking its prefixes refused; regime misses, strict and round-paired past 25 % `VOID`; `UNBALANCED`; §7's input for `lab/scripts/aa_rule.py` with A′ ÷ A's median beside it; the pilot's medians for `--pilot-medians` |
| `series.sh` | the arms' series as `scripts/demo-series.sh` codes them (each set's HTJ2K and its Q 8 G 8 view), frames kept for K1, the prefixes, and FIT's series where the fit is a level |
| `fit_truth.py`, `fit.mjs` | A2.2: the fit level by ADR §8.2's rule on 1080 × 2100, `ll.py`'s clamped low band as each frame's truth; FIT's series (entry *i* < F frame *i*'s smallest exact prefix, F + *i* its rest), each frame checked whole, at the level from the whole and from the prefix, and one byte short |
| `fit-decoder.js`, `fit-page.js` | FIT in the viewer: the worker (the level by the shipped OpenJPH package, checked against the truth's XXH3; the rest joined and checked by the frame digest), the `fit` lever, the window read-back and the zoom after the fill; C1's ask → last byte |
| `prefix.py` | a series' first N frames as a series of its own (`<id>-p<N>`), the view's naming its exact series' prefix |
| `k3.sh` | K3: `claude/transport-arms` `9fad9d9b`'s `run.mjs`, its WT-TS arm alone, on `dbts_b1` HTJ2K at each form's two prefixes, four visits each, interleaved, in a worktree at that commit with `k3-blackout.patch` applied (LTE's first blackout at the phase `plan.mjs` draws for the visit) |

## Run

Needs, past `README.md` §Prerequisites: `iproute2` (`apt-get install -y iproute2`; the cloud image lacks `ip`),
`/dev/net/tun`, `unshare`, `nsenter`, `taskset`; Playwright's full Chromium (`channel: "chromium"`); `ingest/tools.sh`'s
build; `target/release/series-server` and `pack-series`.

```bash
lab/delivery/series.sh S                                           # K1's series and the prefixes
node lab/delivery/run.mjs --bench --series S                       # K2: rows/K2.jsonl
lab/delivery/k3.sh S lab/delivery/rows                             # K3: rows/K3-<CELL>.jsonl
node lab/delivery/inputs.mjs S lab/delivery/rows/K2.jsonl lab/delivery/inputs.json --k3 CLEAN=lab/delivery/rows/K3-CLEAN.jsonl …
node lab/delivery/predict.mjs lab/delivery/inputs.json lab/delivery/predictions.json   # git add -f it, push before any counted row
node lab/delivery/run.mjs --cell CLEAN --series S --predictions lab/delivery/predictions.json --pilot   # 2 rounds, not counted; prints the VOID share by reason
node lab/delivery/judge.mjs lab/delivery/predictions.json lab/delivery/rows/CLEAN-pilot.jsonl    # writes rows/CLEAN-pilot.pilot-medians.json
node lab/delivery/run.mjs --cell CLEAN --series S --predictions lab/delivery/predictions.json --pilot-medians lab/delivery/rows/CLEAN-pilot.pilot-medians.json
node lab/delivery/judge.mjs lab/delivery/predictions.json lab/delivery/rows/CLEAN.jsonl
python3 lab/scripts/aa_rule.py lab/delivery/rows/CLEAN.aa.json --bar 0.05
```

A cell is 150 loads; one cell a job, each under 2 h (§6). The driver re-runs itself under `unshare -rn` and pins the
relay to core 0, the servers to core 1, itself and so the browser to cores 2–3. **The run stops** on a load whose page
failed (a frame not exact, C1 painted without its exact frame, C2 not filling every exact frame); **`VOID`** (kept, with
why): a crash or no verdict, the page's timers stopped, the relay's guard p99 over 1 ms, core 0 or 1 over 95 %, past 3×
the pilot's median (`--pilot-medians`, `{"CELL/VOLUME/ARM": ms}`), more than 2 decoders read back from the frames' own
decode spans. The pilot also refuses when the relay's loss pooled over its loads is not within 3× of the form's.

## What the build found, for the run's amendment (§11)

None of these is in the protocol's text; each changes how the rig runs, none what it measures.

* **The page is served from the server's namespace**, at `10.77.0.2`, beside both series' servers: the viewer's
  `connect-src` (`server/dev-server.py`'s policy) allows only loopback and the page's own host, so a page on loopback
  cannot dial the relay's far side. The page and its scripts therefore cross the relay before the dial; the fill's clock
  starts at the dial (§5), so they cost no clock.
* **That origin is marked secure** by Chromium's `--unsafely-treat-insecure-origin-as-secure` for the two page
  origins (WebTransport and `crypto.randomUUID` need a secure context); Playwright's headless shell ignores the switch,
  so the browser is its full Chromium build (`channel: "chromium"`, 153.0.8010.12 here), printed in every row.
* **`navigator.hardwareConcurrency` reads 2** under `taskset -c 2,3`, so the downloader's default
  `min(3, hardwareConcurrency)` is already 2 here: the `decoders` lever's absence would not show in a read-back, and
  §10's "the decoders lever ignored" mutant is checked as a lever that asks 3 (`--mutate decoders-3`).
* **C1's exact frame is frame 0**: the viewer opens on it and a C1 load never steps (`client/view/controller.js`).
* **C2's second downloader dials at its issue** (`lab/devices/bench.js` `exactFill`), so its span keeps the form's
  whole start (`exactDialed: false`).
* **K1's bytes are each frame's coded bytes** (the frame files `ingest_coded.py` writes), without the bundle's entry
  framing.
* **The relay** is the tree's `lab/scripts/link_impair.py`, which differs from `9fad9d9b`'s only by the control
  port's `window` command, unused here.
* **LTE's blackout phase** (DELIVERY-BUILD-FIX, B1 of [`../../docs/reviews/delivery.md`](../../docs/reviews/delivery.md)):
  §3 says "a 40 ms blackout every 30 s" and no phase. A timer started with the servers put the first blackout ~30 s
  into a load, after almost every clock had ended. Each load now draws its first blackout uniformly over the 30 s
  (`plan.mjs` `blackoutPhaseMs`, seeded by cell, round, volume and arm), the period after it, so a fill meets
  blackouts at the form's rate in expectation; each row carries `blackoutPhaseMs` and `blackoutsFromDialMs` (each
  blackout sent, in ms from the dial; negative is before it). K3's visits draw theirs by the same rule (keyed
  `K3/<visit>/<prefix>`), so *G* and the cell see the same form.
* **A decoder count "other than 2"** (§6) is judged as *more than* 2: a wire-bound fill can read back 1 with two
  decoders running. C2's exact fill is read back too (its frames' `at` as each decode's end).
* **Under 8 counted rounds** a (cell, volume, arm, clock) cannot meet §8's 8 of 10 and is printed `CANNOT HOLD: n
  counted`, never `MISSES`; the pilot prints each cell's `VOID` share by reason, so the guard's share (8 of 15 CLEAN
  and 5 of 15 PUB loads in the smoke) is settled here before CLEAN's first counted row.
* **The A/A input** feeds A′ as both the copy and the arm judged, so `aa_rule.py` can return only `tie` or `not
  conclusive`; §7 uses the pair's spread alone. The judge prints A′ ÷ A's median beside it, which shows a biased A′.

## What FIT-ARM-BUILD found (§Amendment 2)

Smoke loads only, 2026-11-24, on this 4-core container (`dbts_b1`, `dbts_a1` HTJ2K; the view series stood in by the
exact one): none is a result, and none changes what the run measures.

* **The product's OpenJPH build has no `decodeSubResolution`.** FIT's level is decoded by the shipped package (as
  RESLEVEL did), its whole frame by the product's build; `codec.js` takes the package as `levelPackage`.
* **The level decode reads ×0.49 of the whole frame's here**, not RESLEVEL's ×0.27–0.31 that A2.7 used (K2's bench, 3
  loads, two decoders: 20.2 against 41.0 ms a frame; the level's clamp and its lab check inside the span). FIT stays
  wire-bound on `dbts_b1` (a floor ~0.5 s against ≥ 2.5 s of wire); the run's predictions come from its own K2.
* **The clamp matters on `dbts_b1`**: unclamped, 5 of its 50 level pictures (frames 5–9) are not the truth.
* **FIT's prefixes are 26.9–27.3 % of a frame, 0.2712 of the series**, as RESLEVEL measured on `dbts_b1`.
* **A zoom's paint is timed at its issue**: the round page's paints are unsettled, as every label clock here is, so the
  zoom carries no draw time (on `dbts_a1`, 0.6 ms for A2.7's 17 ms, which is reported, not judged).
* On CLEAN, one load each: FIT `dbts_b1` fill 2.76 s (A2.7: 2.72), zoom 0.25 s (0.20), its ask → last byte 0.15 s;
  FIT `dbts_a1` fill 6.29 s (§4.3's B: 6.29). Each window read-back equal byte for byte (1280 × 1664, 1142 × 1785).
* **Not built yet: SPLIT and the switch's reading** (A2.3, A2.5): `split=1` is refused by no lever and acted on by none;
  the rows carry no `split` or `switch` record. The judge and the predictions already read them.

## Checks, and their mutants (§10)

Each run 2026-11-20, on the synthetic pair (the model's and the judge's in their tests, `predict.test.mjs`,
`judge.test.mjs`, `inputs.test.mjs`, `prefix_test.py`, each also failing on the mutants its Result names in
`claude/work-ledger:docs/queue/DELIVERY-BUILD.md`):

| §10's check | mutant | what it gave |
| --- | --- | --- |
| a frame flipped in one exact entry stops the run | `--mutate flip-exact`: the exact series' frame 0 digest flipped | `STOP: … C2: exactFill: frame 0 decoded false, not exact`, exit 3 |
| the relay at 0 % where 1 % is asked: the pilot refuses | `--mutate relay-no-loss` on LOSS's pilot | `PILOT REFUSES: relay loss 0.000 %, asked 1 %`, exit 3; unmutated, it passes |
| the order forced to a fixed cycle: `UNBALANCED` | `--mutate fixed-order`, two rounds | the judge prints `UNBALANCED`; unmutated, nothing |
| the decoders lever wrong: `VOID` by the read-back | `--mutate decoders-3`, CLEAN `dbts_a1` | `VOID 3 decoders read back, not 2` on A and A′; unmutated, not |
| C1 painted without an exact frame: the load fails | the C1 page's own check (`losslessFailure`); with `flip-exact`, any load that checks frame 0 fails | as the first row |
| C2 judged from A's and B's rows added: the judge refuses | `judge.test.mjs`: a C2 row with no `exactFill` record | `C2 … reads only its own`; a span from A + B is killed by a claim |
| `predictions.json` changed after the first counted row: the judge refuses | `judge.test.mjs`: one prediction edited | `refused: … carries predictions …` |
| A2.8: a sample flipped in a level-1 picture stops the run | `--mutate flip-level`, CLEAN `dbts_b1` FIT | `STOP: … received 49 of 50` (frame 0's level unequal to its truth) |
| A2.8: the clamp removed stops the run | `--mutate no-clamp`, CLEAN `dbts_b1` FIT | `STOP: … received 45 of 50` (frames 5–9) |
| A2.8: the read-back from the placed canvas stops the run | `--mutate canvas-readback`, CLEAN `dbts_b1` FIT | `STOP: … window read-back of frame 0: 8946720 bytes for 2129920 samples` |
| A2.8: the FIT lever ignored: the judge refuses | `--mutate fit-ignored` (the exact series for FIT), then `judge.mjs` | `refused: FIT round 0 dbts_b1: frame 0 carried 2063.7 KiB, its level prefix 556.9 KiB` |
| A2.8: a browser process allowed on core 0 is `VOID` | `--mutate escaped` | `VOID escaped: chrome … on 0,2-3` |
| A2.8: K3′ from A loads: the predictor refuses | `inputs.test.mjs`: an A row among the curve's | `K3′: its rows must be B's, got A` |

## Limits

One 4-core container, headless Chromium (full build), software decode, the userspace TUN relay at ≤ 90 Mbit, no radio.
The build was smoke-tested (one round a cell, `rows/smoke/`; `CR-lost-records.jsonl` is CR's first, before the driver waited for a load's last beacon) on the synthetic pair of `lab/devices/round_headless.sh` (64 × 48, 20 frames) and on the
three timed volumes only where its Result says so.
