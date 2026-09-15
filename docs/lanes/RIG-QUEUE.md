# The rig queue — orders out, results back

Two agents share this branch and cannot talk to each other: the one with rig access runs the
shaped cells, and the one without reads the rows and writes the conclusions. This file is the
channel. [`RIG-RUNBOOK.md`](RIG-RUNBOOK.md) is the standing how-to; this is what to run next.

## The contract

**Territory, so the branch never conflicts.** The runner writes **only** under
`docs/measurements/r2/<run-id>/`. It does not edit `server/`, `lab/`, `docs/lanes/`, or
`docs/transport/` — if a script needs a fix, say so in a PR comment and it arrives as a commit
from the other side. This file is written by the reader; the runner only reads it.

**The runner does not interpret.** Raw rows and an execution log, in their own commit. Whether
an arm passed its rule is decided against the rule as written *before* the run — that
separation is why the estimator is already in code
(`lab/scripts/stream_shape_pool.py`) rather than chosen after the numbers are in.

**Every commit says who ran it.** All agents here commit as the repository owner, so the author
line cannot tell them apart. End each commit with a trailer naming the agent and its session.

**Comment on PR #30 when a run lands.** This is the contract's one synchronous step, not a
courtesy: the reader is woken by PR comments, and a bare push may not reach it. One line
naming the run id and whether the pooler returned a verdict or VOID is enough.

**Pull before every cell, not just before every push.** The reader fixes the cell while the
runner is running it, so a campaign started from a commit can be obsolete by its second cell.
Check the branch head between cells and restart the campaign if the scripts moved; a cell run
on a superseded script is rig time spent to reproduce a known fault.

## What comes back, per run

`docs/measurements/r2/<run-id>/` holding the raw JSONs or TSV, and a `RUN.md` stating:

* the **commit SHA the binaries were built from**, and the arms' binary names,
* `uname -r`, core count, and the `tc qdisc show` line the cell actually installed,
* every deviation from the order, and anything that failed or was retried,
* the pooler's or `runtime_ab_pair.py`'s **output verbatim**, including a VOID verdict.

A VOID cell is reported, not fixed by raising repeats. Report it and stop; the cell's design is
the other side's to change.

## Queue

One campaign at a time — a second `tc qdisc replace` silently corrupts the first, and the rig
is two cores.

| # | Run id | Order | Status |
| --- | --- | --- | --- |
| 1a | `t3-250k-l0` | the null cell | **done**, twice, agreeing to 0.3 points |
| 1b | `t3-250k-l0.5` | the decision cell | **done** — `shared` stays default; see [`T3`](T3-stream-shape.md) |
| 1c | `t3-250k-ge`, `-ge-r18` | Gilbert–Elliott, the target's bursty loss | **done** at 6 and 18 repeats |
| 1d | `t3-250k-tput-l{0,0.5,2}` | probe-only throughput | running; it tests a claim already retracted, so it can only confirm a null |
| ~~1e~~ | ~~`t3-250k-l2`~~ | ~~the stress cell~~ | dropped — its step interval comes from the slowest arm, so it measures slack, not latency |
| 3 | `t2-*` | **the controller** | **the case to release it is below** |
| 2 | `t3-32k-l0`, `-l0.5`, `-l2` | T3 at 32 KB, `DEPTH=4`, `ARMS="shared pool:2 pool:4 per-frame"` | **released**, after run 1 |
| 3 | `t2-*` | Controller, Cubic vs BBR — **step 1 is the source review and comes first**, [`T2`](T2-controller.md) | held |
| 4 | `t9-*` | Segment cap, seg45 vs seg10 plus the LAN control, [`T9`](T9-segment-cap.md) | held |

Run 4 (the segment cap) stays held. **Run 3, the controller, is the one to release next**, and
the reason is a finding from run 1 rather than a plan: from the same baselines, bursty loss
degrades `shared` by 38 % where scattered loss of the same 0.5 % mean degrades it by 9 %. The
delivery shape of the loss costs four times what its rate does, no stream shape changes it, and
the controller is what reads a burst. That is now better evidenced than anything left in T3.
[`T2`](T2-controller.md) step 1 is a source review and needs no rig at all — it can start
before any cell does. The owner's call.

**Say which commit to be on, in every comment.** Three cells were run on superseded scripts
because fixes landed mid-campaign. Fixes now wait for a cell boundary.

## Run 1 is done: what it cost and what it bought

Six cell-design faults, all in the cell rather than the rig or the arms, each found because the
runner stopped on a VOID and committed its rows rather than pushing through: the client pacer
left at its default, a reader outrunning the link, a cold page cache pooled with warm repeats,
a step interval taken from the link's label rather than its measured rate, a void check built on
a misread field, and an estimator that flattered the arm that missed most. One claim was
published and retracted within the hour (a 3.5× throughput gap that was a single 4-second
sample). A prediction was called falsified at six repeats and un-falsified at eighteen, and is
recorded as untested.

What it bought is in [`../transport/transport-conclusions.md`](../transport/transport-conclusions.md) §2.
The lesson worth keeping is the one the Phase C review already stated and this campaign
re-learned six times: **a cell that decides nothing is a design error, and the only cheap place
to find one is before the rig runs it.** `lab/scripts/stream_shape_preflight.sh` exists for
that, and caught three contract breaks in its first hour.

## Run 1, first attempt: what was wrong with the cell

`t3-250k-l0` returned VOID and the runner stopped, which is the contract working. Two faults,
both in the cell rather than the rig, and both now fixed in `stream_shape_cells.sh`:

* **The client throttled itself to a fifth of the link.** `window-harness --read-bps` defaults
  to 2 Mbit/s and the script never overrode it, so a 10 Mbit cell delivered 2.27 Mbit/s and
  measured the harness's own pacer. L2's brief already said `--read-bps 0`; the script now
  passes it.
* **The reader outran the link even unthrottled.** `x3_short_scroll` steps every 185 ms and a
  250 KB frame is 200 ms of wire at 10 Mbit, so the backlog grew without bound and 63 % of
  waits were censored. The step interval is now **derived** from the frame size and the rate
  (`HEADROOM` 1.4, so 280 ms at this cell, 36 ms at 32 KB) instead of taken from the trace.

Both now void the cell by name if they ever recur.

A third finding is about the instrument, not this cell: **`on_time_rate` and `late_*` are
closed-reader metrics.** `wait_displayable` is handed a scheduled time only on the closed
path, so under `--reader-mode open` — the only mode admissible for stream shape — they are
structurally zero and mean nothing. The pooler no longer reads them; an open reader never
blocks, so `censored_frac` is its distress signal. **Open question for the owner:** T3 asks for
reader lateness beside every row, and in open mode nothing reports it. Either the open reader
gains the instrumentation or that reporting line goes.

## Open questions the runner can answer cheaply

Answer in `RUN.md` if the cell happens to show it; do not add a run for them.

* Does Chromium ever block `open_uni` on the server in the per-frame arm (T3 step 3)?
* Does `pool:k` change `rcvbuf_drops` against `shared` at the same loss?
