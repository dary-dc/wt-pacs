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

**Rebase before every push** — `git pull --rebase origin claude/clever-curie-flm0wi`. This
branch has moved under a session three times.

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
| 1 | `t3-250k-l0`, `-l0.5`, `-l2`, `-ge` | T3 at 250 KB, `DEPTH=2`, `ARMS="shared pool:2 per-frame"`, the four loss cells of [`RIG-RUNBOOK.md`](RIG-RUNBOOK.md) §1 | **released** |
| 2 | `t3-32k-l0`, `-l0.5`, `-l2` | T3 at 32 KB, `DEPTH=4`, `ARMS="shared pool:2 pool:4 per-frame"` | **released**, after run 1 |
| 3 | `t2-*` | Controller, Cubic vs BBR — **step 1 is the source review and comes first**, [`T2`](T2-controller.md) | held |
| 4 | `t9-*` | Segment cap, seg45 vs seg10 plus the LAN control, [`T9`](T9-segment-cap.md) | held |

Runs 3 and 4 are held so the first result can correct the method before more rig time is spent
on it. Ask in PR #30 to have one released.

## Open questions the runner can answer cheaply

Answer in `RUN.md` if the cell happens to show it; do not add a run for them.

* Does Chromium ever block `open_uni` on the server in the per-frame arm (T3 step 3)?
* Does `pool:k` change `rcvbuf_drops` against `shared` at the same loss?
