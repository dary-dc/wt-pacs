# Parallel work plan — four lanes, one shared resource

**2026-08-29** · companion: [`measurements/r2/CAMPAIGN_V2_ANALYSIS.md`](measurements/r2/CAMPAIGN_V2_ANALYSIS.md)
(why lane A exists). Lanes C and D land in the viewer repo; its own docs carry the goals.

## The constraint that shapes everything

**The São Paulo rig is one VM with one `netem` qdisc.** Two agents shaping it at the same time
silently corrupt each other's numbers — the second `tc qdisc replace` wins and the first agent keeps
measuring, unaware. There is no lock and no warning.

> **Exactly one agent may hold the rig at a time. Every other lane must not run a shaped-link
> experiment.** If a lane needs one, it queues behind lane A.

Everything else parallelises cleanly, because the lanes touch disjoint files.

## The four lanes

| lane | work | repo / files | rig? |
| - | ---- | --- | --- |
| **A** | **S vs Q under loss** — the run that can actually decide the stream mode | `lab/scripts/`, `docs/measurements/` | **YES — exclusive** |
| **B** | **Client telemetry** for the wt-pacs browser clients (P3) | `client/transport-ts/`, `client/transport-wasm/` | no |
| **C** | **Bound the client ask depth** in the viewer | viewer `client/` only | no |
| **D** | **DBT fixture** — pack it, prove it lossless | viewer `fixtures/`, `tools/` | no |

**B, C and D are not new experiments.** They are the code work that experiments are currently blocked
on, plus the highest-impact product change. Adding more measurement lanes would queue on the rig and
gain nothing; unblocking is where parallelism actually pays.

---

## Lane A — the deciding run

Campaign v2 could not evaluate its own decision rule: **no loss dimension, and `--mode saturate`
produces no p95** (all 144 cells were `p95_wait_ms = 0`). This closes both gaps, and it is small
because **P is now known to lose** — only S and Q remain.

| | |
| --- | --- |
| Arms | **S** (shared, `main`) and **Q** (per-frame + priority, `feat/set-priority-per-frame`). **Drop P** |
| **Loss** | **0 / 0.5 / 2 %** — the missing dimension, and the only regime where per-frame can win |
| **Mode** | **`--mode trace`** — saturate yields no wait times. This is the whole point |
| Metric | **p95 time-to-displayable** |
| RTT | 60 and 150 ms |
| Depth | each arm at **its own `D_min`** from campaign v2, never a shared constant |
| Fixture | `frames_32k`. If a 250 KB cell is wanted use **`frames_250k_live`** (320 frames) — the 80-frame fixture is too small for a real trace |
| Repeats | 3, all rows reported |

**Control, corrected:** compare arms at **D = 1**, not D = 16. At D = 16 the arms genuinely differ
because concurrency is the effect under test; at D = 1 they agreed to within 0.13 Mbps. A spread at
D = 1 is a real stop condition.

**Decision rule, unchanged:** Q must beat S by **> 15 % on p95 at 0.5 % loss**. Lossless it only ties,
and a tie does not justify out-of-order handling in the client.

---

## Lane B — client telemetry

[`client-runtime-experiment-plan.md`](client-runtime-experiment-plan.md) §3 P3. Nothing named `record`, `tap` or `telemetry` exists under
`client/`. The TS client has `timing.firstChunkMs` / `lastChunkMs`, but one `performance.now()` after
`readStreamToEnd` makes them always equal, so the transfer term is degenerate.

One schema, both clients, written once — different fields or different stamp points make the
comparison unmeasurable. Feature-gated and provably absent from a default build, mirroring
`server/scripts/check_telemetry_absent.sh`.

Unblocks the WASM-vs-TS experiment, which then queues behind lane A only if it needs shaping.

---

## Lane C — bound the client ask depth

The viewer's `populateCache` pushes an ask for **every frame in the series** then `Promise.all`s them;
its own telemetry labels this `T3-unshaped`. The window design — `D = ceil(U × (1 + RTT/Tf))`, ≈ 2 at
250 KB / 60 ms — exists to replace exactly this and was never implemented.

**The design is decided; only the code is missing.** Highest-impact item in the loop.

> Viewer repo: **nothing is committed without approval.** Work on a branch and stop for review.

---

## Lane D — DBT fixture

Only US cine and lung CT exist. The modality the delivery design turns on cannot be served.

**Check the packer's HTJ2K rate setting is lossless before encoding 195 native mammography frames** —
otherwise the cost is paid twice, and a lossy fixture would silently invalidate every exactness claim
made against it.

---

## Rules for concurrent agents

- **One branch per lane**, named for the lane. Never push to `main` directly
- **Stay in your lane's files.** The lanes were chosen to be disjoint; if you need a file outside
  yours, stop and say so rather than editing it
- **Only lane A touches the rig.** If another lane needs a shaped link, it waits
- **Do not merge `feat/set-priority-per-frame`.** Lane A builds from it for arm Q; whether it lands
  depends on lane A's result
- Report raw numbers, not conclusions. Evidence tier on everything; nothing is above T2
