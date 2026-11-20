# The asking order during a fill

**Question:** Does asking for the want in ascending order, with no ask across the running fill, change the fill?

*Moved 2026-11-14 from `docs/adr/frame-path.md` at `e5b20cba` (§Experiment 2: the want ascending, and no ask across
the running fill), word for word but for queue-row names. A bare §N or §Name is a section of that ADR: [its
map](../../adr/frame-path.md) names the file each now lives in. Choices 1–8 are [the
cache's](cache-in-opfs.md#the-choices-and-what-decides-each). The design these findings shape is
[`../design.md`](../design.md).*

## Experiment 2: the want ascending, and no ask across the running fill (2026-10-29)

*Rank 2 of the experiments beside the target (`claude/vw-experiments`, frame-path.md §Experiments beside the target).
Pre-registered: written, built and smoked before any data; ~~**not run**~~ run 2026-10-30, *Run* at the end. Its run is a row of its own, after a
methodology review of this text.* Reviewed 2026-10-30, before any data: corrections are marked *Review* where they
stand, the old text kept, and the findings are under *Review* at the end.

**Claim.** Under `worker` while filling, a reader stepping forward faster than the fill delivers ends the run with an
ask for a frame the run was about to send (WIRE §An ask during a fill), and the nearest-first want (c, c+1, c−1, …)
then never ascends, so the rest of the fill goes as alternating asks. A want ascending from the current frame
(c, c+1, …, n−1, 0, …, c−1, wrapping as the cine does) puts the frames ahead first; and a head the running run
delivers within its next k frames is waited for rather than asked. Together they should shorten the wait for the
frame a forward step lands on, by about one round trip a step that ends the fill today — **a guess**, as the table
says. *Review:* the rest goes as asks whatever the want's order, ascending too: once a second ask is owed when the
first lands, each arrival tops the asks back up to D_min and `serveWant` starts a run only with nothing owed, so no
run starts again. Under a reader at 25 slices/s, one step a visit ends the fill, and the lever acts before that ask
alone. The model's figures replace the guess (*Review*, *Predictions*).

**The setting.** `waitAhead: k` in the downloader's options (the lab's `?opts={"waitAhead":k}`; the viewer check's
`--opts`), absent by default. Absent, nothing changes: the want is nearest-first and only the run's next frame is
waited for. Set, the controller's want ascends and the downloader waits for a head among the run's next k frames
(`client/view/controller.js` `want`, `client/transport/downloader.js` `serveWant`). It acts under `worker` only; the
page view sends no want.

**Arms**, one build, one setting, nothing else different: `off`, `off′` (the A/A pair, the same build and setting run
as a second unit), and `on` at k ∈ {1, 2, 4, 8}; k = 1 is the ordering alone.

**The trace.** From frame 0's first paint, a sawtooth over the first third of the stack at 25 slices/s (`claude/ask-patterns-map`'s
drilling trace): 0 → ⌊n/3⌋ → 0, three times, a step every 40 ms through the view's `show`. Not built: the run's row
adds it as a lab lever beside `lab/viewer/levers.js`, recording each step's time, whether its frame was held, and
when it was. The review checks the driver before round 0. *Review:* built and smoked by the review,
`lab/viewer/trace.js` behind `?trace=sawtooth` (`run.mjs --trace sawtooth`). `claude/ask-patterns-map` names the trace, a sawtooth over a
third of the stack at 25 slices/s; the strokes' number and ⌊n/3⌋ are this protocol's reading of it.

**Measured, per visit.** *Primary:* **the wait of a forward step**, from the step to its frame held (0 if held at the
step), averaged over the up-strokes' steps — the same steps in every arm, so no arm chooses which steps count, and
defined for a frame the reader passed before it landed. *Must not regress:* the fill's time (the controller's
`fillMs`); the backward steps' mean wait; the on-demand wait (the same trace with `fill=0`, where the setting changes
nothing by construction); exactness, every frame against its digest and the encoder input's `.sha256`. *Review:* this
departs from the table's figure (the median step → screen) and says so here: a mean to held, compared round by round.
Held is screen less one paint, the same in every arm. On demand the want is the current frame alone, and a frame the
reader left with D_min asks already owed is never asked, so its wait to held can be undefined. The on-demand figure
is the time a step's frame was missing before the next step (`missingMs`, defined for every step).

**Cells.** Sets `ct_lidc` (60 × 512²) and `dbt10_ea1141` (16 tomosynthesis frames), on fixed-rate links of 5 and 20
Mbit/s at 46 and 92 ms round trip, no loss, the relay with `--self-timing`; Chromium and Firefox; 1× CPU, the rig
pinned as TOTAL4 (`taskset -c 0-2`). Plus one on-demand cell per engine (`ct_lidc`, 20 Mbit/s, 92 ms). *Review:*
`ct_lidc` is 100 × 512² ([`../FIXTURES.md`](../../FIXTURES.md) §AV1 data), 164 kB a frame as ingest codes it
([`disk-access.md`](../../adr/disk-access.md) §6), and `dbt10_ea1141` is 24 × 678×1727, ~567 kB a frame (13.6 MB,
[`../native/quic-compared.md`](../../native/quic-compared.md) §9.5). The traces are 198 steps (7.9 s) to frame 33 and 48 steps
(1.9 s) to frame 8. A frame takes 66–907 ms of link in every cell, longer than a 40 ms step, so the reader outruns
the fill everywhere and the live guard binds nowhere (the model: 33–100 % of `off`'s steps up not held). `run.mjs`
took one round trip per invocation (`--one-way-ms`); a link `r5000rtt92` now carries its own, so both round trips
sit in one Williams order.

**Interleaving and rounds.** The six arms in a Williams order inside each cell (`lab/order.mjs`, period 6), cells in
a Williams order each round as the total-time rig orders them; 12 rounds, two periods. `--mutate sample` before round
0 must turn every arm's exactness to 0. *Review:* it left a viewer variant exact (smoke: 30 of 30), as the flip
lived only in the total-time page. The view's ledger now takes it, and the smoke went to 0 of 30, and 0 of 11 on
demand.

**Guards.** *Saturation:* a visit whose relay prints `VOID` (p99 lateness over 1 ms) is dropped and re-run at the
round's end; a cell left under 10 visits an arm is reported as saturated and claims nothing. *Live cell:* the share
of `off`'s forward steps whose frame was not held at the step is reported beside every result; below 10 % the reader
never outran the fill, the cell is dead, and a tie there is not a null. *A/A:* a cell where `off′` − `off`'s paired
median wait is beyond ±8 ms, or its fill outside ×0.98–1.02, is too noisy to decide and says so. *Review:* a
visit that failed, or whose fill stopped short, is re-run as a `VOID` one is, not counted.

**Rule**, fixed before the data, over the live, decided cells:

* *k\** is the largest k whose wait is no later than k = 1's in ≥ 9 of 12 rounds in every such cell: waiting is no
  later than asking. None: k\* = 1.
* `on` at k\* is **adopted as the default** if its wait beats `off`'s by ≥ 16.7 ms (one 60 Hz frame) in ≥ 9 of 12
  rounds in at least one cell per engine; is later than `off` by 16.7 ms in ≥ 9 of 12 rounds in none, forward or
  backward; its fill's paired median ratio to `off` is ≤ 1.02 in every cell; the on-demand cells are within the A/A
  spread; and every frame is exact. An inexact frame in any arm rejects it whatever the timings.
* Better forward and worse backward is a trade-off for the owner, with those cells as its cost. Otherwise `off` stays
  and the setting is removed.
* *Review, amended before data:* a cell whose trace does not climb past k (k ≥ ⌊n/3⌋, `dbt10_ea1141` at k = 8)
  gives that k no vote, for k\* or for adoption: there `on` never asks within the trace, which measures no ask at
  all rather than a wait within k. *The on-demand cells within the A/A spread:* their paired median `missingMs`
  against `off` within the larger of 8 ms and that cell's A/A. `lab/viewer/wait-ahead-summary.mjs` (at `0920153d`) applies the
  guards and this rule to the rows.

**Built and checked** (2026-10-29). Each check was mutated and its mutant failed:

| claim | check | mutant |
| --- | --- | --- |
| under the setting the misses go ascending from the current frame, wrapping | `controller.test.mjs` *waitAhead: the want ascends* | the setting ignored; no wrap |
| by default a head the run delivers second is asked; under k = 4 it is waited for, a head behind the run is asked, and one 5th is asked | `downloader.test.mjs` *aHeadTheRunDeliversWithinKIsWaitedFor* | k ignored; ≤ k; the default as 2; a head outside the run waited for |
| *Review:* the 5th was asked because the run had already ended, and k unbounded or k + 1 under the setting passed. Now each head is in a fresh run: by default the run's 2nd, 4th, 5th and one behind it are asked; under k = 4 the 2nd and 4th are waited for | the same test, rewritten | the two that passed; k ignored; a head outside the run; the default as 2; k − 1: 6 of 6 |

The view worker's reading of the setting has no node check: a smoke ran one round per arm of the viewer check under
`worker` with a cine (`--opts '{"waitAhead":4}'` and without), both green, and with the ascending branch made to throw
only the arm with the setting failed. It is a smoke, and gives no number.

**Review** (2026-10-30, independent, before any data).

*Sources.* This text pins no external file, so there is no sha256 to re-check. Every place it leans on was read at a
commit, and each holds as cited unless corrected above:

* WIRE.md §An ask during a fill, lines 118–137 on this base (`34ebe33`): an ask ends the run, there is no saved
  position, and the downloader re-asks the rest.
* `claude/ask-patterns-map` at `8ffe467`, `docs/ARCHITECTURE.md`. Lines 403–404 name the drilling trace, a
  sawtooth over a third of the stack at 25 slices/s; line 377 gives its rate, Diaz et al. 2015 (abstract only),
  25–30 slices/s.
  *Corrected 2026-11-14:* `claude/ask-patterns-map`'s text was on that branch only, not in the tree, so these citations could not be
  followed here; it now is: [`how-viewers-and-readers-ask.md`](how-viewers-and-readers-ask.md), pattern 1 for the
  trace and the readers' table for the rate.
* The table (`claude/vw-experiments` at `9a829a4`), frame-path.md lines 952 and 968–973.
* The independent design (`claude/review-blind` at `a429a6c`), `docs/adr/frame-path.md`. Lines 428–431 give rule 3,
  waiting for the frame next in the run; line 525 gives its depth, k = 1…8.
* The sets' sizes, from FIXTURES.md lines 353 and 359 and disk-access.md line 391; these corrected the *Cells*.

*Asks that never yield.* After a run ends, `serveWant` (`client/transport/downloader.js`) starts another only when
nothing is owed. Each landing ask tops the asks back up to D_min, so once two are owed, every miss after goes as an
ask. On the downloader alone: a run of 0–39, then two steps (to 5, then 6) before the first ask lands. The rest went as
35 asks and no run, for 34 frames. A lone ask that lands with nothing owed does let a run restart. This is the base's
behaviour (#238), and it bounds both this lever and Experiment 1's `span`: each acts only where a run starts. Changing
it is structural, and the owner's: for instance, start a run when the want's head ascends D_min unsent frames
although asks are owed. **Not built.**

*Predictions.* `lab/viewer/want-model.mjs` (at `0920153d`) is a model, not a measurement. It drives the real downloader against a
simulated server and one FIFO link:

* the server recites a run and ends it at a frame boundary for any message in hand, and serves asks in order;
* it keeps at most BDP plus a queue unacknowledged (0 and 250 kB, the relay's 200 packets);
* decode and paint are taken as instant, and every frame of a set has one size.

All 80 modelled visits ran one run. Each figure below is the forward mean's change against `off`, in ms, over both
round trips; *bwd* is the backward mean's change.

| cell | queue | `off` forward | k = 1 | k = 2 | k = 4 | k = 8 |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| `ct_lidc` 5 Mbit/s | 0 | 2 580–2 770 | +1 | +2…+3 | +10 | +6…+23 |
| `ct_lidc` 5 Mbit/s | 250 kB | 2 129 | 0 | −171 | −165…−178 | −163, bwd −136 |
| `ct_lidc` 20 Mbit/s | 0 | 235–252 | +9…+10 | −15 | −12…−13 | −8…−9 |
| `ct_lidc` 20 Mbit/s | 250 kB | 183 | +20 | −5 | −24 | −23…−28, bwd +15…+16 |
| `dbt10_ea1141` 5 Mbit/s | 0 / 250 kB | 4 199–6 713 | 0 | 0 | 0, bwd +453…+523 | −891…−1 202, no ask |
| `dbt10_ea1141` 20 Mbit/s | 0 | 730–1 056 | 0 | +3…+7 | +207…+412, bwd +307…+391 | 0 |
| `dbt10_ea1141` 20 Mbit/s | 250 kB | 391–439 | 0 | +11 | +45, bwd +61…+64 | 0 |

Every fill is ×0.96–1.04 of `off`'s. Read under the rule, the model decides nothing:

* With the queue empty, no voting cell beats `off` by 16.7 ms, and `off` stays.
* With the queue full, k\* is 8 (k = 2 and 4 are later than k = 1 on the 20 Mbit/s DBT cell). It beats `off` on both CT cells, against
  a backward cost of 15–16 ms at 20 Mbit/s, under the 16.7 ms bar.
* Without the vote amendment, the DBT cells at 5 Mbit/s would count for k = 8 a −891…−1 202 ms win that comes from
  never asking.
* k = 1, the ordering alone, is later than `off` on CT at 20 Mbit/s by 9–20 ms.

The relay's queue occupancy, not the round trip, moves the answer. The run decides; nothing here predicts it.

*The protocol against the rules.*

* *Interleaving:* in place, as Williams orders over arms and over cells, round trips now included.
* *A/A:* `off′` as a unit, with a ±8 ms bound, half the bar. It is not measured on these links. If every cell
  exceeds it, the experiment decides nothing, and says so.
* *Saturation:* the relay's `VOID` and the 10-visit floor; the smoke saw 2 `VOID` of 6 on one round.
* *Rule fixed before data:* yes, and decidable once the four amendments above are in. They are: the vote of a k the
  trace does not climb past; the on-demand figure; failed visits re-run; and `--mutate sample` reaching the viewer.

*Experiment 1's `span` (#243, its review #248).*

* Textually, `downloader.js` merges cleanly. Against #248's head, eight files conflict: `view-worker.js`
  (`connect`), `downloader.test.mjs`, the controller's ledger and its test, `run.mjs`'s `opts`, `gate.sh`,
  `levers.js` and `viewer.js`. Most are both adding beside each other. The last two differ in kind: #248 steps on
  demand and waits for each frame, while here the steps keep time.
* Semantically, both levers act only where a run starts, so the yield above silences both. Under `span`, the run's
  next k frames include held frames it carries, which is wire distance and the k this text means.
* Exp 1's `holdEveryOther` builds its first want from `controller.want()`, which under `waitAhead` ascends. So each
  experiment runs with the other's setting absent. If either is adopted before the other's round 0, the other runs on
  the adopted default and says so.

*Built in review, each test mutated:*

| piece | where | mutants caught |
| --- | --- | --- |
| the sawtooth and each step's wait | `lab/viewer/trace.js`, `trace.test.mjs` | 9 of 10; the tenth reads a repeated frame as up, and the trace has none |
| the ledger's `fillMs` and lab flip | `client/view/controller.js`, `controller.test.mjs` | 4 of 4 |
| the trace driven from frame 0 on screen, each step on time | `client/viewer/viewer.js` | smoke only |
| a variant's `opts`, `--trace`, a link's own round trip, the trace in each row | `lab/av1/delivery/total-time/run.mjs` | smoke only |
| the guards and the rule | `lab/viewer/wait-ahead-summary.mjs` (at `0920153d`), `wait-ahead-summary.test.mjs` | 20 of 20 |

*Smoke*, Chromium, one round per arm. The set was the contract's 16-bit grey frame ×30, behind
`r5000rtt46`/`rtt92`; it shows the rig, and no result is read from it:

* the fill and on-demand cells ran all six arms, with every frame held exact;
* `--mutate sample` turned both arms it was run on, `off` and `k2`, to 0 exact, fill and on demand;
* the setting reached the view worker and the downloader with its value: each made to throw, only the arm with the
  setting failed.

*To run* (its own row). Make each set with `make_frames.py`, and give its `variants.json` the six arms `off`, `offaa`,
`k1`, `k2`, `k4` and `k8`. Each arm carries `"codec": "htj2k"`, `"openjph": "delivered"`, `"viewer"`,
`"view": "worker"`, the digests, and `"opts": {"waitAhead": k}` (absent for `off`, `offaa`). Then run:

```bash
for r in $(seq 0 11); do NODE_PATH=$(npm root -g) node lab/av1/delivery/total-time/run.mjs --rounds 1 --first-round $r \
  --engines chromium,firefox --throttles 1 --links r5000rtt46,r5000rtt92,r20000rtt46,r20000rtt92 --sets ct_lidc,dbt10_ea1141 \
  --trace sawtooth --out rows.jsonl; done        # and --fill 0 --sets ct_lidc --links r20000rtt92 for the on-demand cells
node lab/viewer/wait-ahead-summary.mjs rows.jsonl rows-on-demand.jsonl
```

**Run** (2026-10-30, `claude/core-exp2`, #265). **Verdict: k\* = 8, adopt k = 8**, by the rule as fixed; the
code's default is not flipped here (*The default*, below). Rows, at `claude/core-exp2@1ac440b0`, not in this tree:
[`lab/viewer/rows-wait-ahead.jsonl`](https://github.com/dary-dc/wt-pacs/tree/1ac440b0ba32d509e257cc7c7206268e7cd6bdf7/lab/viewer/rows-wait-ahead.jsonl), [`rows-wait-ahead-on-demand.jsonl`](https://github.com/dary-dc/wt-pacs/tree/1ac440b0ba32d509e257cc7c7206268e7cd6bdf7/lab/viewer/rows-wait-ahead-on-demand.jsonl),
[`rows-wait-ahead-mutate.jsonl`](https://github.com/dary-dc/wt-pacs/tree/1ac440b0ba32d509e257cc7c7206268e7cd6bdf7/lab/viewer/rows-wait-ahead-mutate.jsonl); the driver `lab/viewer/wait-ahead-run.sh`.

*Before round 0.*

* `--mutate sample` turned all six arms to 0 exact on both engines, fill and on demand (24 rows).
* At 5 Mbit/s every visit stalled at 92–93 of 100 frames and timed out. A frame of a run the want's head had left
  arrived after its record was forgotten. It was dropped and also deleted from the downloader's want, and the store
  re-sends a want only when its misses change, so the frame was never asked again. Now it is dropped but stays
  wanted (`downloader.js` `arrived`; `downloader.test.mjs` *aLateFrameOfAnEndedRunIsStillWanted*, which fails on the
  old code). Every row below ran on the fix.
* Rig: Firefox 155 (Playwright's) runs headed under `xvfb-run` (`run.mjs --headed`), as headless Firefox has no
  WebGL2 in a worker. The relay runs on core 3 at `chrt -f 50`, browser and server on cores 0–2. `--fill 0` is
  accepted under `--trace`. The fixtures were made with `VARIANTS=check make_frames.py` and the arms written per *To
  run*; `viewer.json` carries the frame count, `htj2k` and the digests.

*Where the host saturates.* The relay went `VOID` on 418 of 1 570 fill attempts and 75 of 219 on demand. Rounds 0–3
lost 37–52 % of their fill attempts; rounds 4–11 lost 2–19 %. The cause is not measured. Each `VOID` visit was re-run at
its round's end, and the 37 visits still missing after three passes were re-run once more after round 11. That
breaks the interleave for those visits only. Every arm of every cell ended with 12 kept visits: none saturated, no
failed or short fill, and every frame exact.

*Results*, the forward wait's paired median change against `off`, in ms, with `off`'s median (the backward change
after the slash). `—` marks a cell the guards leave out.

| cell | engine | guards | `off` fwd | k = 1 | k = 2 | k = 4 | k = 8 | fill at k = 8 |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `ct_lidc` 5 Mbit/s, 46 / 92 ms | Chromium | A/A 74 / 88 ms — | 8 921 / 8 729 | +13 / +89 | −516 / −251 | −3 551 / −3 128 | −2 728 / −2 566 | ×0.955 |
| `ct_lidc` 5 Mbit/s, 46 / 92 ms | Firefox | decided | 3 170 / 3 189 | +83 / +82 | −144 / −212 | −612 / −601 | −983 / −1 044 | ×0.950 / 0.949 |
| `ct_lidc` 20 Mbit/s, 46 ms | Chromium | A/A 11 ms — | 518 | +25 | +16 | −141 | −315/−166 | ×0.881 |
| `ct_lidc` 20 Mbit/s, 92 ms | Chromium | decided | 571 | +12 | −29 | −120 | −248/−124 | ×0.921 |
| `ct_lidc` 20 Mbit/s, 46 / 92 ms | Firefox | decided | 230 / 258 | +9 / +16 | 0 / −22 | −28 / −32 | −88 / −96 | ×0.946 / 0.947 |
| `dbt10_ea1141` 5 Mbit/s, 46 / 92 ms | Chromium | decided | 5 037 / 5 020 | +17 / +12 | +1 689 / +1 739 | +5 167 / +5 183 | no vote | ×0.688 / 0.690 |
| `dbt10_ea1141` 5 Mbit/s, 46 / 92 ms | Firefox | decided | 5 023 / 5 038 | −3 / +10 | +109 / +133 | +110 / +1 005 | no vote | ×0.924 / 0.925 |
| `dbt10_ea1141` 20 Mbit/s, 46 / 92 ms | Chromium | A/A 11 / 10 ms — | 349 / 367 | −5 / +9 | −7 / +344 | +768 / +1 230 | no vote | ×0.718 / 0.728 |
| `dbt10_ea1141` 20 Mbit/s, 46 ms | Firefox | A/A 12 ms — | 616 | +2 | −132 | −72 | no vote | ×0.935 |
| `dbt10_ea1141` 20 Mbit/s, 92 ms | Firefox | decided | 621 | −1 | −122 | +39 | no vote | ×0.929 |
| on demand, `ct_lidc` 20 Mbit/s, 92 ms | both | decided | 10 | 0 | 0 | 0 | 0 | — |

The rule over the ten decided fill cells:

* *k\**: k = 2 and 4 are no later than k = 1 in at most 1 of 12 rounds on the decided DBT 5 Mbit/s cells. k = 8 votes only on the
  five decided CT cells, and is no later than k = 1 in 12 of 12 rounds in each. So k\* = 8.
* *Adoption at k = 8*:
  * It beats `off` by ≥ 16.7 ms in 12 of 12 rounds on every decided CT cell, which covers both engines.
  * It is later than `off` in 0 rounds, forward and backward.
  * The fill's paired median is ×0.92–0.95, within ×1.02.
  * The on-demand change is 0.0 ms against an A/A of 0.1 ms.
  * Every frame is exact.

The model read the full relay queue as k\* = 8. The relay holds 200 packets, so the queue was full here, and the run
agrees. The model predicted a win of 23–28 ms at 20 Mbit/s and 163 ms at 5 Mbit/s; the run measured 88–315 ms and
about 1 s respectively. It also predicted a 15–16 ms backward cost, which did not appear.

*What the verdict does not cover.*

* Chromium decides on one fill cell. Its CT 5 Mbit/s A/A is 74–88 ms, about 1 % of an 8.7–8.9 s wait, over the
  fixed ±8 ms.
* k = 8 has no vote on a stack whose trace climbs ⌊n/3⌋ ≤ 8, so DBT is undecided at k = 8. There it never asks
  within the trace; the fill's ×0.69 on Chromium comes from that, not from waiting.
* k = 2 and 4 cost +0.1 to +5.2 s against `off` on DBT at 5 Mbit/s, in 12 of 12 rounds. A smaller k is not a safe
  substitute for k = 8.
* Only CPU 1× and these links were run. Nothing is claimed for a `VOID` visit.

*The default.* The rule makes k = 8 the default. This branch records the verdict and leaves the code's default
absent, for two reasons. The setting acts only under `?view=worker`, whose own rule is not run. And the other
experiments (Exp. 1's `span`, Exp. 3) run against `waitAhead` absent; per *Experiment 1's `span`* above, flipping it
now changes their baseline mid-run. Flipping the default is the owner's merge.
