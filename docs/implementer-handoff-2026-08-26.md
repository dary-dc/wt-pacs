# Implementer handoff — window depth and stream architecture

**Date:** 2026-08-26 (rev 2) · **Supersedes** rev 1 and `queue-and-hol-harness.md` §7

---

## 0. What changed since your last report

**Three harness defects were found and fixed** (`window-harness`, `wire.rs`, `client.rs`). All three
independently prevented the harness from ever having more than one ask in flight, so every "formula not
validated" conclusion was guaranteed before the run started. Details in
[`window-saturation-experiment.md`](window-saturation-experiment.md) §0c.

With them fixed, **E1 passes at 5 of 6 gate points.** The flat `0.408` was the `D`=1 utilisation —
`40.8/100.8` — which is all the harness could produce.

**And a scope problem was found in the results themselves.** Everything was measured on a server that
opens **one uni stream per frame**. The viewer integration target uses **one shared stream**. Three of
the four E1 findings are properties of the stream layout, not the formula. The ADRs are now marked
accordingly.

---

## 1. Already done — do not redo

| | |
| - | - |
| `wire.rs` | `LinkPacer` releases the lock before sleeping. Aggregate rate still enforced by the `next_at` reservation |
| `client.rs` | `ask_frame` no longer sleeps inline; full RTT applied once on the return path, inside the already-spawned per-stream handler |
| `client.rs` / `metrics.rs` | **`peak_outstanding`** — highest concurrent ask count observed, recorded per run |
| ADRs | `adr-client-window-depth`, `adr-reject-server-cancel`, `adr-reject-server-ordering` scoped to the architecture they were measured on |

Uncommitted in the working tree. Review, then commit as one change.

---

## 2. Fix these before measuring anything

### 2.1 · Server lifecycle in `e1_saturation_sweep.sh`

Line ~92 starts the server with `>/dev/null 2>&1`, so a **failed bind is silent** and the harness talks
to whatever is still listening. That is how `frames_250k` cells were served by the `queue_large` server
— observed `per_frame_bytes` was 51,004 against a 250,000-byte fixture.

Fix: capture server output, assert it reports the expected study and frame count, use a **fresh port per
cell**, and fail loudly if the server is not up.

### 2.2 · Replace the in-process pacer with `tc`

`LinkPacer` takes a mutex on every 16 KB chunk, so concurrent readers contend — and that contention
**scales with stream count**, which is the variable E6 tests. Shaping in the harness would penalise the
per-frame-stream arm for a harness property.

Shape bandwidth with `tc` on the cloud host and disable the in-process pacer. This is also required for
loss emulation, which E6 needs.

**Side benefit:** it settles whether the 51 KB / 150 ms shortfall (measured `D_min`=8 vs predicted 5) is
transport behaviour or pacer contention. If it disappears under `tc`, it was the harness — and I should
not have attributed it to per-stream overhead.

### 2.3 · Guards, permanent

| | |
| - | - |
| `peak_outstanding` must reach `D` | else the run is void — the invariant all three defects violated |
| Observed bytes-per-frame must match the fixture | with a **tolerance**, not equality: `queue_large` has variable frame sizes |
| Demand ÷ supply ≥ 1.0 | §0b. Print the ratio; refuse to run below it |
| Never discard server output | a silently failing server looks like a slow one |

---

## 3. Run order

### 3.1 · Shared-stream mode — built, verified for transport, blocked for measurement

**The architecture is decided: single shared stream.** The integration target already works that way and
changing it is expensive, so it is the default. **There is no A/B comparison to run** —
[`window-saturation-experiment.md`](window-saturation-experiment.md) §3e records the decision and the
condition that would reopen it.

**Already built and in the working tree:** `exact-server --shared-stream` and
`window-harness --shared-stream`. Frames go back to back on one uni stream as
`[4B BE envelope_len][envelope]`. Default stays per-frame on both sides. Every run now records
`shared_stream` in its metrics.

Verified end to end: correct frame sizes, `peak_outstanding` tracks `D`. **Transport works.**

> **Blocked for measurement.** `--rtt-ms` is **inert in shared-stream mode** below the frame time —
> utilisation reads 1.000 at RTT 0, 60 and 150 ms alike, and only becomes correct above the frame time
> (§0c defect 4). **Shared-stream depth numbers require `tc netem` on the cloud host.** Do not produce
> them with `--rtt-ms`.

Everything measured so far used per-frame streams. **Do not carry those numbers across** — re-measure on
shared-stream under netem.

### 3.2 · Then, in order

| | | |
| - | - | - |
| **E1** | re-run, shared-stream, netem | confirms `D_min` on the architecture we are keeping |
| **E4** gate | 8 runs, one RTT, depths 1–8 | random arm **derived by pooling raw per-frame waits**, not run separately |
| **E5** sensitivity | RTT and `Tf` fed ±50% wrong | gates whether the estimators need designing at all |
| **E3** treatment arms | independent of all the above | baseline done; report **p99/p999** stall, not the mean |

### 3.3 · A question for the product, not a blocker

wt-pacs keeping per-frame streams as its default while every measurement runs shared-stream leaves two
paths, one unmeasured. Under the essentialist rule that is worth resolving — but it is a wt-pacs product
call and blocks nothing above. Raise it; do not wait on it.

---

## 4. Things not to spend time on

- **E0 is deleted.** It validated local emulation; measurement moved to the cloud, so there is nothing
  to validate. Local runs are development only — never quote a local number
- Do not sweep four RTTs for the E4 gate. At 250 KB / 10 Mbps the formula returns `D`=2 for every RTT
  from 30 to 180 ms, so four RTTs measure one prediction four times
- Do not build server-side ordering, priority, generations, or cancel. Rejected, with ADRs
- Do not implement the window using `RequestFrames` — a batch of `N` forces depth `N`. Real-time path is
  one `RequestFrame` per message (`WIRE.md`)

---

## 5. Reporting

Per experiment: groups run, control values, objective (**mean and p95**), `peak_outstanding`,
demand÷supply ratio, **and the stream architecture it was measured on**. Pass/fail against the criterion
*as written in the spec*, not one adjusted after seeing data.

A null is a result. The three most valuable outcomes available are *"the shared stream is fine"*,
*"`D` does not matter"*, and *"the estimators can be crude"* — all nulls, each deleting work.
