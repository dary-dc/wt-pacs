# Lane L1 v3 — work order

**Read this top to bottom and do it in order.** Every step has an acceptance gate. A gate that
fails is a **STOP**: fix the step, re-run the gate, do not proceed on a failed gate and do not
collect data past one.

**Governing plan (2026-09-05):** [`L1-v3-complete-plan.md`](L1-v3-complete-plan.md) —
behavior-first (null + dose-like response + regimes); short phases allowed, skipping scientific
gates is not. Execute Phases A→F there; this work order remains the detailed S0–S12 checklist.

Supersedes `L1-loss-run.md` (v2). v2's grid is void — see
`docs/measurements/r2/L1_V2_ADVERSARIAL_REVIEW.md`, and
[`L1-v3-second-review.md`](L1-v3-second-review.md) for an independent confirmation, one
correction to that review's §8 (`peak_outstanding` was vacuous, and S1/S2 invert what it
means), and the open items N1–N12.

Nothing in v2's TSV may be reused, resumed, or appended to. **Steps 1–7 land and pass their
gates before a single v3 row is collected.**

---

## S0 · Void the v2 data first

```bash
git mv docs/measurements/r2/l1_s_vs_q_loss_v2.tsv \
       docs/measurements/r2/l1_s_vs_q_loss_v2.VOID.tsv
```

Then put this as the first line of the VOID file:

```
# VOID — methodology defects, see docs/measurements/r2/L1_V2_ADVERSARIAL_REVIEW.md. Do not decide from this file.
```

v3 writes to a **new** file, `docs/measurements/r2/l1_s_vs_q_loss_v3.tsv`. The v3 runner must
never open the v2 path.

**Gate S0.** `git status` shows the rename; `l1_s_vs_q_loss_v2.tsv` no longer exists.

---

## S1 · Stop re-asking frames the client already holds

**File:** `lab/window-harness/src/client.rs`, `emit_window` (currently line 454).

Add a `metrics` parameter and skip any frame already in the display cache.

```rust
async fn emit_window(
    control_send: &mut wtransport::stream::SendStream,
    outstanding: &Arc<Mutex<HashSet<u32>>>,
    metrics: &SharedMetrics,
    center: u32,
    d: u32,
    n: u32,
    rtt_ms: u64,
) -> Result<u32> {
    let frames = window_frames(center, d, n); // S2 adds the `shape` argument here
    let mut sent = 0u32;
    for frame in frames {
        // Already displayable: re-asking re-sends a frame the client holds. On the shared arm
        // those bytes queue ahead of frames the reader is waiting for — which is the exact
        // head-of-line cost this lane exists to measure. Never manufacture it here.
        //
        // LOCK ORDER: take `metrics`, drop it, THEN take `outstanding`. Never hold both:
        // `on_frame_arrived` takes them in the opposite order and would deadlock.
        {
            let m = metrics.lock().expect("metrics lock");
            if m.cache.contains(&frame) {
                continue;
            }
        }
        {
            let mut o = outstanding.lock().expect("outstanding");
            if o.len() as u32 >= d && !o.contains(&frame) {
                continue;
            }
            o.insert(frame);
            note_outstanding(o.len() as u32);
        }
        ask_frame(control_send, frame, rtt_ms).await?;
        sent += 1;
    }
    Ok(sent)
}
```

Update all three call sites in `run_windowed` (currently lines 382, 403, 414) to pass `metrics`.

**Gate S1.** `cargo test -p window-harness` passes and `cargo clippy -p window-harness` is clean.
No deadlock: the two locks are in separate scopes.

---

## S2 · Make the window shape match the trace direction

The window is symmetric — `(c, c+1, c−1, c+2, c−2, c+3, c−3)` — but `l1_one_way_80.json` only
goes forward. At D=7 three of seven asks are for frames already behind the reader.

Do **not** change the symmetric shape globally: other lanes' traces reverse and their baselines
depend on it. Add a shape and select it.

**File:** `lab/window-harness/src/metrics.rs` — add the enum and a `RunConfig` field:

```rust
#[derive(Clone, Copy, Debug, PartialEq, Eq, clap::ValueEnum)]
pub enum WindowShape {
    /// (c, c+1, c-1, c+2, c-2, …) — for traces that reverse.
    Symmetric,
    /// (c, c+1, c+2, …) — for strictly forward traces.
    Forward,
}
```

```rust
pub struct RunConfig {
    // …existing fields…
    /// Window shape around the cursor. `Forward` for one-way traces.
    pub window_shape: WindowShape,
}
```

**File:** `lab/window-harness/src/client.rs` — `window_frames` (currently line 427) takes the shape:

```rust
fn window_frames(center: u32, d: u32, n: u32, shape: WindowShape) -> Vec<u32> {
    let mut out = Vec::with_capacity(d as usize);
    if d == 0 || n == 0 {
        return out;
    }
    if shape == WindowShape::Forward {
        for r in 0..d.min(n) {
            out.push(center.wrapping_add(r) % n);
        }
        return out;
    }
    // …existing symmetric body, unchanged…
}
```

`emit_window` gains the same parameter and forwards it — add `shape: WindowShape` to its
signature (after `metrics`), pass `cfg.window_shape` from all three `run_windowed` call sites,
and change its body's call to `window_frames(center, d, n, shape)`.

**File:** `lab/window-harness/src/main.rs` — add the flag, defaulting to the old behaviour:

```rust
/// Window shape around the cursor. Use `forward` for one-way traces.
#[arg(long, value_enum, default_value_t = WindowShape::Symmetric)]
window_shape: WindowShape,
```

**Add these two tests** to `lab/window-harness/src/client.rs`:

```rust
#[test]
fn forward_window_never_looks_back() {
    assert_eq!(
        window_frames(40, 7, 80, WindowShape::Forward),
        vec![40, 41, 42, 43, 44, 45, 46]
    );
}

#[test]
fn symmetric_window_is_unchanged() {
    assert_eq!(
        window_frames(40, 7, 80, WindowShape::Symmetric),
        vec![40, 41, 39, 42, 38, 43, 37]
    );
}
```

The v3 runner passes `--window-shape forward`.

**Gate S2.** Both tests pass. The symmetric test proves no other lane's baseline moved.

---

## S3 · Prove S1 and S2 worked — the redundancy gate

v2 sent **~534 asks for 80 unique frames** at D=7 (6.7×). After S1+S2 the harness should ask
for the initial window once and then one new frame per step.

Run one lossless cell locally and read `asks_sent`:

```
expected asks_sent ≈ frame_count + D  (≈ 87 at D=7, ≈ 84 at D=4)
```

**Gate S3 — hard.** `asks_sent <= 100` for an 80-frame trace at any depth.
**STOP if `asks_sent > 100`.** S1 or S2 is not working, and every number from a run above this
line is measuring self-inflicted congestion, not the transport.

Add this as a permanent runner gate — same treatment as the `cache_misses` gate:

```bash
MAX_ASK_RATIO="${MAX_ASK_RATIO:-1.25}"   # asks_sent / frame_count
```

Void any row that exceeds it.

---

## S4 · Put the harness on the shaped path

v2 ran the harness locally and reached São Paulo over an uncontrolled WAN. Backing that path
out of v2's own D=1 control gives ~210 ms of unmodelled RTT: **"RTT 60" was really ~240 ms and
"RTT 150" ~300 ms.**

Run **both** processes on the rig, separated by a shaped veth pair. On the rig, once:

```bash
sudo ip netns add wt-cli
sudo ip link add veth-srv type veth peer name veth-cli
sudo ip link set veth-cli netns wt-cli
sudo ip addr add 10.77.0.1/24 dev veth-srv
sudo ip link set veth-srv mtu 1500 up
sudo ip netns exec wt-cli ip addr add 10.77.0.2/24 dev veth-cli
sudo ip netns exec wt-cli ip link set veth-cli mtu 1500 up
sudo ip netns exec wt-cli ip link set lo up
```

**MTU 1500 is not optional.** On loopback the MTU is 65536, so "0.5 % loss" would drop 0.5 % of
64 KB super-packets — a completely different experiment from 0.5 % of 1500-byte packets.

Shaping, per cell. Forward path (server → client) carries the loss, exactly as v2 intended;
the return path carries delay only:

```bash
# server -> client : egress of veth-srv in the root namespace
sudo tc qdisc replace dev veth-srv root netem delay $((RTT/2))ms rate 10mbit loss ${LOSS}%
# client -> server : egress of veth-cli inside the namespace
sudo ip netns exec wt-cli tc qdisc replace dev veth-cli root netem delay $((RTT/2))ms rate 10mbit
```

Server in the root namespace on `10.77.0.1:4435`; harness inside the namespace:

```bash
sudo ip netns exec wt-cli /home/ubuntu/wt-pacs/bin/window-harness --url https://10.77.0.1:4435/ …
```

The harness uses `with_no_cert_validation()`, so the dev cert's SANs do not matter.

**Gate S4a — the path is what the label says.**

```bash
sudo ip netns exec wt-cli ping -c 20 10.77.0.1
```

Mean RTT must be within **±5 %** of nominal (57–63 ms for the 60 cell; 142.5–157.5 ms for the
150 cell). **STOP otherwise.**

**Gate S4b — the D=1 control proves it end to end.** At D=1 a wait is one RTT plus one frame's
serialisation. Tf = 32000 B × 8 / 10 Mbit = **25.6 ms**.

| cell | expected D=1 `miss_p95_wait_ms` | accept |
| --- | --- | --- |
| RTT 60 | 60 + 25.6 = **85.6 ms** | 71–101 ms |
| RTT 150 | 150 + 25.6 = **175.6 ms** | 156–196 ms |

**STOP if outside the accept band.** v2 measured 265.0 and 325.7 ms here. That gap *was* the
uncontrolled WAN, and this gate is the check that would have caught it on day one.

Record the measured ping RTT in every row (column `rtt_measured_ms`).

---

## S5 · Depth — no change needed, but assert it

`D = ceil(0.95 × (1 + RTT/Tf))`, Tf = 25.6 ms:

- RTT 60 → ceil(0.95 × 3.344) = **4**
- RTT 150 → ceil(0.95 × 6.859) = **7**

D=4 and D=7 were always right *for the path the labels describe*. They were wrong only because
v2 ran on a ~240/~300 ms path, where the same formula asks for D≈10 and D≈13. Once S4 passes,
keep D=4 and D=7.

**Gate S5.** The runner recomputes D from `rtt_measured_ms`, not from the label, and STOPs if
the result differs from the configured depth.

---

## S6 · Interleave the arms

v2 ran all ten S, then all ten Q, per cell. Ten minutes of drift sat perfectly aligned with the
treatment. Swap the loop nesting in the v3 runner:

```bash
# WRONG (v2):  for arm; do for run; done; done
# RIGHT (v3):
for run in $(seq 1 "$repeats"); do
  for arm in S P Q; do
    deploy_arm "$arm" "${ARM_MODE[$arm]}"
    run_cell "$arm" "$rtt" "$loss" "$d_op" "$run" || exit 2
  done
done
```

This costs one server redeploy per run instead of per block (~5 s each). Pay it.

Add `ts_iso` (run start, `date -Iseconds`) as a TSV column so drift is visible after the fact.

**Gate S6.** In the finished TSV, consecutive rows within a cell alternate arms. Check:

```bash
awk -F'\t' 'NR>1 && $3==RTT && $4==LOSS {print $1}' l1_s_vs_q_loss_v3.tsv | uniq -c
```

Every count must be **1**. A count > 1 means the arms were blocked; the cell is void.

---

## S7 · Take the rig exclusively, and check netem after every run

**S7a — stop displacing other lanes.** In the runner's `acquire_rig_lock`, the branch that
currently warns and takes the lock must refuse instead:

```bash
*)
  echo "STOP: rig held by $cur — L1 v3 requires exclusive netem. Wait or coordinate." >&2
  exit 1
  ;;
```

**S7b — assert netem after the harness returns, not only before.** v2's `assert_netem` ran
pre-cell only, so a steal *during* a cell was invisible — and one happened
(`9e45f59`, foreign `delay 10ms` mid-campaign). In `run_cell`, after the harness exits 0 and
**before** `append_row`:

```bash
if ! assert_netem "$rtt" "$loss"; then
  write_void_row "$arm" "$rtt" "$loss" "$depth" "$run" "netem_changed_during_run"
  cloud_set_netem "$rtt" "$loss"
  continue
fi
```

Do not retry the row into a state you have just proven was contaminated — void it, restore the
shaping, and move on.

**S7c — capture the evidence.** Write `tc qdisc show dev veth-srv` output to
`<raw>/<tag>.tc.txt` before and after every run.

**Gate S7.** Deliberately change netem from a second shell mid-run once. The row must come back
`VOID netem_changed_during_run`. If it comes back with numbers, S7b is not wired in.

---

## S8 · Commit the raw data

v2's per-run JSON went to `.local/`, which is gitignored, so nothing can be re-derived or
audited. Change the runner:

```bash
RAW_DIR="${RAW_DIR:-$ROOT/docs/measurements/r2/raw/l1v3}"
LOG="${LOG:-$ROOT/docs/measurements/r2/raw/l1v3/RUN.log}"
```

Commit `raw/l1v3/` — the JSON, the `.tc.txt` files and `RUN.log`. Each run's JSON already
carries the full `wait_ms` array; roughly 4 KB per run, so a 500-run campaign is about 2 MB.

**Gate S8.** From the committed raw files alone, and without the TSV, recompute
`miss_p95_wait_ms` for three randomly chosen rows and match the TSV to 0.01 ms.

---

## S9 · Run enough repeats

At v2's observed spread, 10 runs per arm had a **0.27** (RTT 60) and **0.16** (RTT 150) chance
of confirming a >15 % win *even if the effect is entirely real*. The campaign could not have
succeeded.

| cell | repeats per arm | why |
| --- | --- | --- |
| RTT 60 · 0.5 % · D=4 | **40** | ≈ 0.79 power at the observed spread |
| RTT 150 · 0.5 % · D=7 | **80** | ≈ 0.92 power at the observed spread |
| RTT 60 · **0 %** · D=4 | **40** | the null control must be as tight as the decision cell |
| RTT 150 · **0 %** · D=7 | **80** | same |
| both · 2 % · D | 10 | diagnostic only, not a decision cell |
| both · 0 % · D=1 | 10 | path validation (Gate S4b) |

Arms are **S, P, Q** (see S10). Budget ≈ 900 runs ≈ 8 h wall clock with redeploys. That is the
price of a decidable answer; a cheaper campaign is not a cheaper answer, it is no answer.

**Gate S9.** Every decision cell has its full repeat count in non-VOID rows before analysis begins.

---

## S10 · Restore the P arm — it is free

Q changes two things at once: per-frame streams **and** FIFO `set_priority`. P (per-frame, no
priority) was dropped on the strength of campaign v2, which was entirely lossless — the one
regime the hypothesis calls uninformative. Without P, a Q win cannot be attributed.

P needs **no new binary**: `main`'s server already accepts `--stream-mode per-frame` and that is
its default. Add to the runner:

```bash
declare -A ARM_MODE=([S]=shared [P]=per-frame [Q]=per-frame)
declare -A ARM_BIN=([S]=$BIN_MAIN [P]=$BIN_MAIN [Q]=$BIN_Q)
```

Run P in the 0 % and 0.5 % cells at operating depth. It costs run time and nothing else.

---

## S11 · Freeze the protocol before the first row

v2 changed `step_interval_ms` from 185 → 50 **nineteen rows in**, and deleted nine collected
rows, because the integrity gate was failing. The trace file says so in its own `_design.notes`.
That is choosing the operating point that produces the measurement.

At the top of the v3 runner, before any cell:

```bash
if [[ -n "$(git status --porcelain lab/ docs/lanes/)" ]]; then
  echo "STOP: protocol tree dirty — commit or stash before collecting" >&2
  exit 1
fi
PROTOCOL_SHA="$(git rev-parse HEAD)"
echo "protocol_sha=$PROTOCOL_SHA"
```

Write `protocol_sha` as a TSV column on every row.

**Gate S11 — the rule, stated once and not renegotiated.** If any of `lab/window-harness/`,
`lab/traces/l1_one_way_80.json`, `lab/scripts/l1_loss_run_v3_cloud.sh` or `docs/lanes/` changes
mid-campaign: **void every row collected under the old SHA, including the D=1 controls, and
restart.** Not "keep the controls". Not "keep the cells that already passed."

---

## S12 · The decision test — write it down before you look at the data

v2's rule ("Q beats S by > 15 % on miss p95 at 0.5 % loss") was evaluated on medians alone, and
had no falsification clause. Replace it with this, in full:

Let `gain(cell) = (median_S − median_Q) / median_S × 100`, and let `CI(cell)` be the
**bootstrap 95 % CI on that gain, 20 000 resamples**.

**Q wins if and only if all three hold, at the same RTT and depth:**

1. **Null control passes.** `CI(0 % loss)` **contains 0.**
   If the arms differ at zero loss, the rig is not measuring loss — the cell is void, whatever
   the 0.5 % number says. *v2 failed this: Q "won" by 26 % at RTT 150 with a clean link.*
2. **Effect clears the bar.** The **lower bound** of `CI(0.5 % loss)` **exceeds 15.**
   Not the point estimate. *v2's point estimates were 35.5 % and 29.2 %; its lower bounds were
   +3.3 % and −6.3 %.*
3. **The effect responds to the dose.** `gain(2 %) ≥ gain(0.5 %)`.
   Head-of-line blocking gets worse with more loss. *v2 went 35.5 % → −1.4 % and 29.2 % → 3.6 %.*

Failing 1 or 3 means the measurement is broken, not that Q lost. Failing only 2 means Q lost.

Report `gain` and `CI` for **S vs Q** and for **S vs P** so the win, if there is one, is
attributable.

**Gate S12.** The analysis script is committed *before* the first v3 row is collected, and runs
unmodified afterwards.

---

## Checklist

```
[ ] S0   v2 TSV renamed .VOID.tsv, banner added, v3 writes a new file
[ ] S1   emit_window skips cached frames; locks in separate scopes
[ ] S2   WindowShape::Forward added; both window tests pass
[ ] S3   asks_sent <= 100 on an 80-frame trace   ← HARD STOP
[ ] S4   veth pair up, MTU 1500; ping within 5%; D=1 in band   ← HARD STOP
[ ] S5   D recomputed from rtt_measured_ms, matches 4 / 7
[ ] S6   arms interleaved run-by-run; uniq -c shows all 1s
[ ] S7   lock refuses foreign holders; netem asserted after each run; tc captured
[ ] S8   raw JSON + tc + RUN.log committed under docs/measurements/r2/raw/l1v3/
[ ] S9   40 / 80 repeats per arm in the decision and null cells
[ ] S10  P arm restored in the 0% and 0.5% cells
[ ] S11  tree clean, protocol_sha stamped on every row
[ ] S12  three-clause decision test committed before collection starts
```
