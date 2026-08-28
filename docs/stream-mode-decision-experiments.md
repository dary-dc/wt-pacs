# Experiments: decide shared vs per-frame

**For:** wt-pacs implementer · 2026-08-28 ·
**Executes:** §6 of [`adr-frame-framing-and-loop-shape.md`](adr-frame-framing-and-loop-shape.md)

Three runs. **X1 gates X2 and X3** — if the `finish()` fix did not take, the other two measure the old
defect again, which is exactly how the retracted comparison went wrong.

Every prior run in this programme was **lossless**. That is the regime in which the two modes are
indistinguishable by construction, so X3 is the only one that can actually decide.

---

## Preconditions

**Netem without root**, via a private network namespace:

```bash
unshare --user --map-root-user --net -- bash
ip link set lo up
tc qdisc add dev lo root netem delay 30ms rate 10mbit    # one-way; RTT = 60 ms
ping -c3 127.0.0.1                                        # confirm ~60 ms before trusting anything
```

Loopback traverses the qdisc **once per direction**, so set one-way delay = RTT/2.

Do **not** use the harness `--rtt-ms` flag for these runs. It is applied on the return path only and
measured inert in shared mode below the frame time. Real netem or nothing.

Known harness defects that will silently corrupt results — check before, not after:

- `e1_saturation_sweep.sh` redirects to `/dev/null`, so a server bind failure looks like a result.
  Confirm `per_frame_bytes` in the output matches the fixture you intended.
- `--depth-sweep` panics with *"rustls ring provider already installed"* — one process per depth.
- `LinkPacer` is a software pacer competing with `tc`. Set `--read-bps 0` when netem is shaping.

---

## X1 · Did the `finish()` fix take?

Pure verification. ~10 minutes.

| | |
| - | - |
| Mode | `--stream-mode per-frame` |
| Fixture | 250 KB frames |
| Link | 10 Mbit, 60 ms RTT, no loss |
| Depth | `D` = 4 |

**Pass:** link utilisation **≥ 8.0 Mbps**.
**Fail:** ~7.0 Mbps — the old `Tf/(Tf+RTT)` ceiling. `finish()` is still being awaited on the session
loop; stop and fix that before running anything else.

Old measurement for reference: per-frame was flat at 7.00 across `D` = 1, 2, 4, 8 while shared reached
8.50.

---

## X2 · Fair mode comparison, lossless

The honest re-run of the comparison that was retracted.

| | |
| - | - |
| Modes | `shared` and `per-frame` |
| Fixtures | 250 KB and 51 KB frames |
| Link | 10 Mbit; RTT 20, 60, 150 ms; no loss |
| Depth | `D` = 1, 2, 3, 5, 8 |

**Expected:** the two modes land within a few percent of each other. That is the *predicted* result, so
report it as confirmation, not as a win for either.

**If they differ by more than ~10%**, something mode-specific is still wrong — say so and stop; do not
let a difference here be read as the loss result.

Free add-on, same runs: `D_min` per cell against `D = ceil(U × (1 + RTT/Tf))`. The formula has only ever
been validated on the shared stream (6/6). This extends it to per-frame at no extra cost.

---

## X3 · The decider — mode comparison under loss

| | |
| - | - |
| Modes | `shared` and `per-frame` |
| Fixture | 250 KB frames |
| Link | 10 Mbit, 60 ms RTT |
| **Loss** | **0%, 0.1%, 0.5%, 2%** |
| Depth | `D` from X2's `D_min` for this cell |

```bash
tc qdisc change dev lo root netem delay 30ms rate 10mbit loss 0.5%
```

**Metric is p95 time-to-displayable per frame — not throughput.** Head-of-line blocking delays frames
that already arrived; aggregate bandwidth can look fine while the reader waits.

**Hypothesis:** shared degrades faster, because one lost packet delays every later frame on that stream
by ~1 RTT, while per-frame confines the loss to its own frame.

**Decision rule, fixed in advance:**

- per-frame p95 better than shared by **> 15%** at 0.5% loss → **choose per-frame**, and accept the
  client-side cost of out-of-order arrival
- within 15% → **choose shared**, matching the viewer integration target's one-stream-per-endpoint shape

Record the loss rates at which the gap opens. If real-link loss is below that, the question is moot —
and that number may be cheaper to ask for than to measure.

---

## Not in this campaign

- **E4** (oracle vs random ask order) — the earlier run was lost when its scratch directory was
  cleared. Worth redoing, but it does not gate the mode decision.
- **`set_priority`** — only meaningful if X3 chooses per-frame. Design after, not before.
- The reader/sender loop split.

---

## Reporting

Per run: mode, fixture, RTT, loss, `D`, link utilisation, p95 time-to-displayable, `peak_outstanding`,
and the `per_frame_bytes` sanity check. Evidence tier for all of it is **T2 at best** — a harness under
synthetic netem. Nothing here is quotable as a product number.
