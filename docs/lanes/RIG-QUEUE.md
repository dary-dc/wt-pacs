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
| 1c | `t3-250k-ge` | Gilbert–Elliott, the target's bursty loss | **next** — the cell that speaks to a radio link |
| 1d | `t3-250k-l2` | the stress cell | after `-ge`; expect the reader model to fail here, and read goodput rather than latency |
| 2 | `t3-32k-l0`, `-l0.5`, `-l2` | T3 at 32 KB, `DEPTH=4`, `ARMS="shared pool:2 pool:4 per-frame"` | **released**, after run 1 |
| 3 | `t2-*` | Controller, Cubic vs BBR — **step 1 is the source review and comes first**, [`T2`](T2-controller.md) | held |
| 4 | `t9-*` | Segment cap, seg45 vs seg10 plus the LAN control, [`T9`](T9-segment-cap.md) | held |

Runs 3 and 4 are held so the first result can correct the method before more rig time is spent
on it. Ask in PR #30 to have one released.

**Say which commit to be on, in every comment.** Three cells were run on superseded scripts
because fixes landed mid-campaign. Fixes now wait for a cell boundary.

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
