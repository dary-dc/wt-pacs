# Step-scale, per cell — what each number is and why it is frozen

Moved here out of `r6_campaign.sh` and `r6_campaign_cloud.sh`, where it had grown into
seventy lines of comment. The scripts now carry the values; this carries the reasoning.

**What a step-scale is.** A multiplier on the trace's own frame interval. The reader's
offered load has to be set against the rate the link can **achieve**, not the rate it is
labelled with: at 1 % loss and 600 ms RTT, Cubic's Mathis ceiling is 0.24 Mbps while a
30 fps reader over 64 KB frames demands ~15 Mbps. Run that and every arm collapses
identically at 93 % censoring, which distinguishes nothing.

**The rule.** Calibrate once per cell, on the incumbent (`shared`) arm only, then freeze
across every arm. The operating point is not a free parameter to be chosen after seeing arm
results: tuning it per arm lets the rig be shaped to fit whichever answer had started to look
right, which is how three previous campaigns went wrong.

**The admissible band**, fixed in
[`../../lanes/R6-preregistration.md`](../../lanes/R6-preregistration.md) before any arm ran:

| | |
| --- | --- |
| `center_asks_dropped == 0` | the frame being measured was always actually asked for |
| `stranded_frames > 0` | something arrived that the reader no longer wanted |
| `censored_frac <= 0.25` | the arm did not simply collapse |
| `nz_n >= 30` | there is a tail to take a percentile of |

N0 is the negative control, so `stranded_frames > 0` is **inverted** there rather than
dropped — `r6_row.py` encodes the same asymmetry as `STRANDING_CELLS = {X1, X2}`. Without
that, the control's own passing rows print as NOT-ADMISSIBLE.

**E0-R6c, translated for the rig.** Under netsim the guard was "re-check the chosen scale at
every campaign *seed*", because netsim's loss is a seeded PRNG and scale 6 was clean at seed
4242 then voided 4 of 9 rows. `sch_netem` has no seed — every run is already an independent
realisation — so the guard becomes **REPS**: re-run the chosen scale N times and require the
band to hold in *every* repetition. Same guard, same failure caught.

**Calibrate in the condition the campaign runs in.** A frozen operating point is only valid
for the condition it was calibrated in, so whatever the campaign puts on both arms belongs in
the calibration too. X3L forced this: it runs `--segmentation-offload false`, which changes how
`sch_netem` draws loss (per datagram rather than per GSO batch,
[`r6cloud-results.md`](r6cloud-results.md) §3.2) and therefore changes the achievable rate the
reader is being set against. Calibrating with GSO on and running with it off is the same
"calibrated once, assumed to hold" mistake as carrying a scale across rigs.

---

## netsim (`r6_campaign.sh`)

| cell | delay ms | rate Mbps | loss % | scale | what it is |
| --- | ---: | ---: | ---: | ---: | --- |
| X1 | 25 | 20 | 0.1 | 2 | mild loss |
| X2 | 25 | 20 | 0.1 | 4 | reader outruns the link |
| X3 | 25 | 20 | 1.0 | 8 | loss-dominant |
| N0 | 25 | 20 | 0.0 | 8 | negative control |
| X3S | 25 | 20 | 1.0 | 7 | X3 on the scroll trace |
| X3L | 25 | 20 | 1.0 | 32 | X3 at 250 KB frames |

**X3 is loss-dominant, not loss-without-stranding** — no such point exists on this trace,
because loss lowers achievable throughput and that itself strands. At scale 8, 1 % loss
strands 35 frames where 0 % strands none. 1 % rather than 0.1 % because at 0.1 % the cell is
degenerate: p95 79.6 ms with loss against 79.5 ms without.

**N0 is the negative control.** Any arm separating here means the rig is measuring something
other than what it claims, and the campaign is void — not adjusted, void.

**X3S scale 7, not 6.** Scale 6 was clean at the calibration seed and then voided 4 of 9
campaign rows on `center_dropped`, because a harder loss realisation pushed the transport far
enough behind that the outstanding ceiling bound. Scale 7 is validated against all three
campaign seeds (7932 / 15851 / 23770). X3's scale 8 cannot be reused: under the scroll trace
it strands 6 frames, too thin to read a percentile from.

**X3L scale 32.** Chosen so frame size is the only thing that changed: reader demand
1.82 Mbps against Cubic's 2.85 Mbps ceiling is a ratio of 0.64, matching the 64 KB run's 0.66.

## Real path (`r6_campaign_cloud.sh`)

**The real path is one step-scale easier than netsim.** netsim's X1 at scale 2 (152 stranded)
is this rig's scale 1 (155 stranded); netsim's X3 at scale 8 (35 stranded, p95 181 ms) is this
rig's scale 4 (14–46 stranded, p95 85–191 ms). Reusing the netsim column would have put X1, X2
and X3 all at zero stranding — running the campaign in cells that cannot produce the effect.

The rig sweep, on `shared` only, re-checked at three independent loss realisations (the
E0-R6c guard). Data: [`r6cloud_calibration.tsv`](r6cloud_calibration.tsv).

| loss | sc=1 | sc=2 | sc=4 | sc=8 |
| --- | --- | --- | --- | --- |
| 0.1 % | 155 stranded, ADM | 30 stranded | 0 stranded | 0 stranded |
| 0.0 % | 153 stranded, ADM | 30 stranded | 0 stranded | 0 stranded |
| 1.0 % | VOID, cdrop=67 | 363 stranded | 75 stranded, ADM | 0 stranded |

**N0 is held at X3's reader speed**, not its own, so the control and the decisive cell differ
only in loss. netsim's campaign has the same property.

**X3L has no default scale, deliberately.** It used to default to 16 — netsim's 32 halved by
the rule above. That rule was measured for X1/X2/X3 at **64 KB**, and at 250 KB both the
reader's demand and the achievable rate move, so carrying it across is the "calibrated once,
assumed to hold" mistake that voided 4 of 9 rows in X3S. Calibrate on the rig:
[`x3l-run-card.md`](x3l-run-card.md).

---

## Why the two rigs differ

Four ways, already written up in [`real-path-notes.md`](real-path-notes.md) §2: egress-only
shaping, an RTT that is base + delay rather than the flag, no seed, and a meaningless
`ns_cpu_s`. Not restated here.

## Method properties both campaigns share

Fixed in writing in [`../../lanes/R6-preregistration.md`](../../lanes/R6-preregistration.md)
before either ran. Each is a scar from a previous review:

- The reader is **open-loop**, so the transport can fall behind it (review 4).
- Step-scale is calibrated on the incumbent arm and **frozen** across arms.
- Rows carry stranded / censored / centre-dropped counters, and a row that failed to produce
  the condition under test is **VOID** rather than quietly averaged in (review 3).
- VOID rows are **written, never dropped**: failures are systematically the slowest runs, so
  deleting them flatters whichever arm fails (review 3).
- Arms are **interleaved within each repeat**, because host drift is not common-mode and has
  already produced one wrong answer in this work (review 1).
- The netsim seed **varies per repeat**, so repeats resample loss instead of replaying one
  sequence; with a constant seed the reported ranges measure host jitter and the non-overlap
  rule fires on noise (review 2).

**A fixed-N stream pool is untested.** It would need a server change, and this lane is
constrained not to modify `server/`. Recorded as untested rather than inferred about.
