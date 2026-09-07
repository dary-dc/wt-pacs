# X3L on the Oracle rig — run card

> **Executed 2026-09-07. It separated — per-frame 5.76× worse.** Results, gates and the
> deviations from this card: [`x3l-results.md`](x3l-results.md). Two things this card got
> wrong, both corrected there: the step-scale is **32**, not ~16 (the "one step-scale easier"
> rule was measured with GSO *on*, and turning GSO off halves the achievable rate), and the
> §2 calibration command needs `--segmentation-offload false` too, or the operating point is
> frozen in a condition the campaign never uses. The card is kept as written so the
> corrections are legible against it.

**One campaign, one sitting.** This is not a rig guide — `../../ORACLE-RIG-AGENT-GUIDE.md`
is, and `oracle-runbook.md` covers the R6 campaign generally. This card covers only the run
that is still missing, and exists because that run has three ways to fail silently that the
general docs do not mention.

**What X3L settles.** The real-path campaign could not resolve the stream-shape question at
64 KB: the effect sought is 3.5× and the loss realisation alone moves the reference arm by
4.32×, so the cell could not have detected the simulator's own effect even if it is exactly
right ([`r6cloud-results.md`](r6cloud-results.md), `../../transport-conclusions.md` §2.6).
At 250 KB the predicted effect is **8.5×**, comfortably clear of a 4.3× noise floor. X3L is
the version of that test with the power to succeed, and **it is the only outstanding run
that could change what the project ships.**

**What a null would mean.** If per-frame does *not* separate at 250 KB with the stranding
gate passing, the retransmit-deferral mechanism is in trouble — that is the point of running
it. Write that down before you start; do not discover it afterwards.

---

## Before you touch the rig

| | |
| --- | --- |
| **SSH key** | Treated as compromised — it was pasted into a chat transcript (`../../HANDOFF.md` §8). **Rotate before this run**, do not "just this once" it. |
| **Preflight** | `lab/scripts/cloud_preflight.sh` — fails fast if the environment cannot reach the rig. |
| **Path stability** | The last attempt died because the residential path degraded 51 → 9 Mbps mid-session. This comparison needs one stable sitting. Measure before and after; if the base path moved, the run is not comparable. |
| **Wall-clock** | ~1 hour for two arms at n = 3, **plus** calibration. Calibration is not optional (see §2). |

---

## 1 · The fixture — 125 MB, gitignored, and the guard now checks it

`frames_500x250k` is 500 × 250 000 bytes = **125 MB**, four times the 64 KB fixture, and it
is gitignored. Regenerate rather than fetch:

```bash
FRAMES=500 OUT_ROOT=$PWD/lab/fixtures bash -c 'source lab/scripts/gen_tf_fixtures.sh; gen_one 250000 frames_500x250k'
```

`r6_upload_fixture` compares sizes before sending, so the upload happens once and is skipped
on later runs. On a residential uplink budget several minutes for it. **Regenerating on the
rig itself is faster if you can** — the generator is pure Python and the file is one
repeated byte.

**The trap this used to be.** `FIXTURE` is set once per invocation and uploaded before the
cell loop, so `CELLS="X3L"` alone ran X3L's step-scale against the **64 KB** fixture — a
completed campaign, nine admissible-looking rows, and the one variable X3L exists to change
left unchanged. `r6_campaign.sh` stated the requirement in a comment and
`r6_campaign_cloud.sh` did not state it at all. It is now enforced by
`lab/scripts/r6_cell_inputs.sh`, which refuses the run. Two consequences worth knowing:

- **X3L cannot share an invocation with X1/X2/X3/N0.** One fixture per run. The guard
  refuses the mixture rather than letting one side be wrong.
- The same guard covers **X3S**, which needs `TRACE=.../r6_scrub_500.json` for the same
  reason — on the jump trace it is just X3 under another name.

## 2 · Calibrate the step-scale on the rig — do not inherit one

**`SCALE_X3L` now has no default, deliberately.** It used to default to 16, which is
netsim's 32 halved by the "the real path is one step-scale easier" rule. That rule was
measured for X1/X2/X3 **at 64 KB**, and at 250 KB both the reader's demand and the
achievable rate move — so carrying it across is precisely the "calibrated once, assumed to
hold" mistake that voided 4 of 9 rows in X3S (`../../HANDOFF.md` §5). The script now refuses
to start without an explicit value.

Calibrate on the **incumbent (`shared`) arm only**, then freeze across arms:

```bash
FIXTURE=frames_500x250k DELAY=25 RATE=20 LOSS=1.0 \
  SCALES="4 8 16 32" REPS=1 lab/scripts/e0_r6_calibrate_cloud.sh
```

Pick the scale that **strands frames without voiding on `center_dropped`**. Then re-check
the chosen point at **three independent loss realisations** — netem has no seed, so repeats
resample loss by construction, which is what makes three separate runs the equivalent of
netsim's three seeds:

```bash
FIXTURE=frames_500x250k DELAY=25 RATE=20 LOSS=1.0 \
  SCALES="<chosen>" REPS=3 lab/scripts/e0_r6_calibrate_cloud.sh
```

**All three must be admissible.** X3S was clean at one realisation and then voided 4 of 9
campaign rows; that is the whole reason this re-check exists (E0-R6c).

**Sanity check against netsim's reasoning.** The netsim X3L scale was chosen so the
demand/achievable ratio matched the 64 KB run — 0.64 against 0.66 — keeping frame size the
only thing that changed. Aim for the same property here rather than for a particular number.
If your chosen scale gives a wildly different ratio, the cell is not X3-at-250-KB, it is a
different cell.

## 3 · Run it

```bash
EXP=r6cloud_x3l CELLS="X3L" FIXTURE=frames_500x250k SCALE_X3L=<calibrated> \
  lab/scripts/r6_campaign_cloud.sh 3

python3 lab/scripts/r6_analyse.py .local/measurements/r6/r6cloud_x3l.tsv
python3 lab/scripts/r6_adversarial_checks.py .local/measurements/r6/r6cloud_x3l.tsv
```

Two arms are enough — `shared` and `perframe_fifo`. `perframe_fair` is already settled
(worse in all twelve real-path comparisons) and its control is known invalid, so it buys
nothing here and costs a third of the rig time:

```bash
ARMS='shared|--stream-mode shared --segmentation-offload false;perframe_fifo|--stream-mode per-frame --send-fairness false --segmentation-offload false'
```

Both arms, or the correction is itself a confound.

**Add `--segmentation-offload false` to the server flags on both arms.** It is an
`exact-server` flag, not a netem one — the batching happens on the *sender*, and turning
quinn's UDP GSO off is what makes netem see one datagram at a time. The real-path campaign
found `sch_netem` draws loss **once per GSO batch, not per datagram**, and the batch size
differs by arm — reported as 6.87 datagrams for `shared` against ~4.3 for per-frame, so shared
absorbs ~1.5× fewer congestion events at equal bytes. **Those per-arm numbers have no committed
data file**; the rule stands on the measured GSO-on/off difference (3.37 vs 0.99 datagrams per
batch) rather than on the per-arm ratio. The bias favours the incumbent. It did not matter
when the incumbent failed to separate; **it matters now, because this run is expected to
separate in the incumbent's favour** (`r6cloud-results.md` §3.2).

## 4 · Gates — apply before reading any number

1. **Stranding must be non-zero in every row.** `stranded_bytes == 0` voids the row: no
   stranding means no head-of-line blocking to measure, and the comparison is vacuous.
2. **`center_dropped == 0`.** Any row above zero measured the harness's own ask policy, not
   the transport, and is void for p95.
3. **Keep VOID rows in the TSV.** Failures are systematically the slowest runs, so deleting
   them flatters whichever arm fails. This project has already biased one result exactly
   that way.
4. **Record the base path RTT at start and end.** The campaign measures it via a TCP connect
   to port 22, which sits outside the shaper. If it moved materially, say so in the write-up
   rather than averaging across a path that changed under you.

## 5 · What to write down

Report it beside the 64 KB real-path cell and the netsim 250 KB cell, so the comparison a
reader wants is on one page:

| | shared | per-frame + FIFO | ratio |
| --- | --- | --- | --- |
| netsim, 64 KB | 182.2 ms | 637.1 ms | 3.5× |
| netsim, 250 KB | 372.7 ms | 3159.5 ms | 8.5× |
| real path, 64 KB | — | — | **not a result** (noise 4.32×) |
| **real path, 250 KB** | *this run* | *this run* | *this run* |

Then update, in this order: `r6cloud-results.md` (the data), `../../transport-conclusions.md`
§2.6 (which currently says the mechanism is "unconfirmed on real hardware" — that sentence
is what this run is for), and `../../HANDOFF.md` §3.

**If it separates**, the stream-shape recommendation stops being a simulator result and
becomes a measured property of the transport. **If it does not**, check the stranding gate
first — a null with zero stranding is a rig failure, not a finding — and only then treat the
retransmit-deferral mechanism as being in trouble.
