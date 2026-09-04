# L1 v3 — action plan against the current implementation

**2026-09-02** · companion to [`L1-v3-work-order.md`](L1-v3-work-order.md), which stays the
authority on *what* v3 must fix. This plan says **what the code actually looks like today**, which
work-order steps land as written, which need correcting, and what neither document currently covers.

Inputs: [`../measurements/r2/L1_V2_ADVERSARIAL_REVIEW.md`](../measurements/r2/L1_V2_ADVERSARIAL_REVIEW.md)
(why v2 is void) · [`../l1-loss-literature-review.md`](../l1-loss-literature-review.md) (what the
mechanism requires, and the loss-model finding).

Everything below was checked against the tree at `d5bb193`: `lab/window-harness/src/{client,metrics,main,trace}.rs`,
`lab/scripts/{l1_loss_run_v2_cloud.sh,l1_build_bins.sh,cloud_netem.sh,cloud_common.sh,gen_tf_fixtures.sh}`,
`server/src/transport/server.rs`, and the pinned `quinn-proto 0.11.17` / `wtransport 0.7.2` sources.

---

## 0 · Verdict on the work order, step by step

| Step | Lands as written? | Note |
| --- | --- | --- |
| S0 void v2 | ✅ | Pure `git mv` |
| S1 skip cached frames | ✅ **with a signature fix** | `emit_window` today is `(control_send, outstanding, center, d, n, rtt_ms)` — no `metrics`. Three call sites (`client.rs:382, 403, 414`). The lock-order warning is **correct and load-bearing**: `on_frame_arrived` (`client.rs:573`) takes `outstanding` → `in_flight` → `metrics`, so holding `metrics` across an `outstanding` acquire can deadlock |
| S2 forward window shape | ✅ **with a wider blast radius than stated** | `window_frames` is `client.rs:427`, `emit_window` `client.rs:454`; `RunConfig` (`metrics.rs:32`) is constructed in exactly one place (`main.rs:70`), so adding a field is a 2-file change. Needs a CLI flag too |
| S3 redundancy gate | ✅ | `asks_sent` is already a `HarnessMetrics` field and already a TSV column |
| S4 harness on a shaped veth | ✅ **and it is the most important step** | The MTU-1500 point is right: on loopback the MTU is 65536. `with_no_cert_validation()` confirmed at `client.rs:97` |
| S5 assert depth from measured RTT | ✅ | Runner-side only |
| S6 interleave arms | ⚠️ **costly as implied** | Per-run arm switch means a per-run redeploy in today's runner. **C4** replaces it with three servers on three ports |
| S7 exclusive rig + netem check after each run | ✅ | `assert_netem` exists in the v2 runner and is reusable |
| S8 commit raw JSON | ✅ | `HarnessMetrics.wait_ms` already serialises (`metrics.rs:83`); only `RAW_DIR` moves |
| S9 repeat counts | ✅ | See **A7** for what the additions do to the budget |
| S10 restore P | ✅ | Confirmed: `server/src/main.rs:19` defaults `--stream-mode` to `per-frame`, and `main`'s binary serves both modes |
| S11 freeze the protocol | ✅ **but insufficient alone** | Freezing does not solve *why* v2 retuned the trace. See **A1/A2** |
| S12 decision test | ⚠️ **clause 3 needs conditioning** | RFC 9002 and the prioritization literature both predict the differential shrinking once the connection is cwnd-limited. As written, clause 3 would void a real effect |
| §7 "Q is a clean 10-line diff over `main`" | ❌ **wrong today** | See **C1** |

---

## 1 · Corrections (C) — things that are wrong or will not work as written

### C1 · The Q arm binary is not a clean diff over `main`

`l1_build_bins.sh` builds arm Q from a detached worktree at `origin/feat/set-priority-per-frame`.
That branch is **behind** `main`:

```
$ git diff --stat origin/main origin/feat/set-priority-per-frame -- server/
 server/Cargo.toml               |  1 -
 server/src/media/frame_store.rs | 89 ++++-------------------------------------
 server/src/transport/server.rs  | 22 +++++-----
```

The branch **removes `FrameStore::touch_frame_pages` and the `spawn_blocking` page pre-touch** that
`main` carries (lane L3's work), and drops `frame_range`. So v2's arms differed by *stream mode +
priority + page-fault handling*. The direction favours S, so it does not explain Q's v2 win — but v3
must not repeat it.

**Do (done on L1 branch):** `exact-server --ask-priority` wires FIFO `set_priority` on the
per-frame arm (earliest ask → highest priority). Same tree builds S / P / Q:

| Arm | Flags |
| --- | --- |
| S | `--stream-mode shared` |
| P | `--stream-mode per-frame` |
| Q | `--stream-mode per-frame --ask-priority` |

No separate Q worktree. PR #10’s priority-only change is folded here; its disk-access extras are not.

**Gate C1.** Q runs with `--ask-priority`; record `server_sha` in the TSV so arms are auditable.

### C2 · S12 clause 3 — condition the dose–response, do not drop it

Clause 3 (`gain(2 %) ≥ gain(0.5 %)`) assumes the effect is monotone in loss. Two sources say it is
not, once the connection is congestion-limited: RFC 9002 (loss halves the window connection-wide;
CUBIC is quinn's default — `config/transport.rs`), and Sander et al. TMA 2022 (the prioritization
effect "becomes less significant for higher packet loss rates"). A Reno-style ceiling
`BW ≈ MSS/(RTT·√p)` at MSS = 1200 B puts the cells here:

| RTT | 0.5 % | 2 % |
| --- | --- | --- |
| 60 ms | 2.26 Mbit/s — **23 % of the 10 Mbit link** | 1.13 Mbit/s — 11 % |
| 150 ms | 0.91 Mbit/s — 9 % | 0.45 Mbit/s — 4.5 % |

**Do:** keep clauses 1 and 2 exactly as written — clause 1 (null control CI contains 0) is the one
the literature endorses most strongly, since no published mechanism produces a lossless arm gap.
Replace clause 3 with:

> **3. The effect responds to the dose, where the dose is measurable.** `gain` must not *decrease*
> between two loss rates that gate A5 marks **delivery-limited**. A cell marked congestion-limited is
> diagnostic and exempt, and the campaign must then carry at least two delivery-limited loss rates
> (e.g. 0.25 % and 0.5 %) so the clause has something to test.

### C3 · Interleaving needs the arm switch to be cheap — run three servers, not one

S6 asks for `S,P,Q,S,P,Q…`. Today `deploy_arm()` scp's a binary, kills and restarts the server. Doing
that per run adds ~5 s × ~1200 runs ≈ 1.7 h and a restart-shaped confound aligned with the treatment.

**Do:** start all three arms once per cell, on three ports, and switch arms by URL:

```bash
# once per cell, root namespace on the rig
exact-server --port 4435 --stream-mode shared    --study … &   # S  (bin: main)
exact-server --port 4436 --stream-mode per-frame --study … &   # P  (bin: main)
exact-server --port 4437 --stream-mode per-frame --study … &   # Q  (bin: priority-v3)
```

All three sit behind the same `netem` qdisc on `veth-srv` (shaping is per-device, not per-port), and
an idle server costs one mmap of a ≈5 MB fixture — safe on the rig's 954 MB. **Gate C3:** before
each run, `pgrep -c exact-server` is 3 and the arm's port answers; after each run, all three are
still alive (a crashed arm silently turns interleaving back into blocking).

### C4 · The reader is link-paced, so `step_interval_ms` is not the reader's rate

Not covered by the work order. `run_windowed` (`client.rs:377-396`) does, every step:

```rust
asks_sent += emit_window(...).await?;
wait_displayable(metrics, cursor % n, cfg.timeout_ms).await?;
wait_outstanding_below(outstanding, d.saturating_sub(1), cfg.timeout_ms).await?;   // ← this
```

The third line blocks each step until an ask completes, so the trace's 50 ms is a **floor** and the
reader actually advances at link pace (adversarial review §5.2). A radiologist does not scroll slower
because the network is slow — that is the whole reason the wait metric exists.

**Do:** delete the `wait_outstanding_below` call from the **step loop** (keep it in the fill-dwell
loop, where draining is the point). `emit_window` already caps concurrency: it skips a frame when
`o.len() >= d`. Then the reader advances on the trace clock and a miss means what it says.

**Gate C4.** In a lossless local run, wall time of the step loop ≈ `steps × step_interval_ms` ± 10 %.
Add `step_loop_ms` to `HarnessMetrics` and assert it in the runner.

### C5 · `cloud_netem.sh` cannot express a loss model, and v3 needs one

`apply_netem` builds `loss_args=(loss "${loss}%")` — i.i.d. Bernoulli, the only model it can produce.
The literature review's headline is that this is the regime most favourable to the per-frame arm.

**Do:** add an optional third argument:

```bash
LOSS_MODEL="${3:-iid}"          # iid | gemodel
case "$LOSS_MODEL" in
  iid)     loss_args=(loss "${loss}%") ;;
  # ~0.5 % mean, mean burst ≈ 7 packets: steady-state = p/(p+r) = 0.07/14.07 = 0.497 %, 1/r = 7.1
  gemodel) loss_args=(loss gemodel "${GE_P:-0.07}%" "${GE_R:-14}%") ;;
esac
```

and thread `loss_model` through `cloud_set_netem` (`cloud_common.sh:46`) and `assert_netem`, which
today greps for `loss ${loss}%` and would reject a gemodel qdisc. Record `loss_model` as a TSV column.

---

## 2 · Additions (A) — gaps neither document covers

### A1 · The operating point is the experiment, and it is currently unchosen

This is the deepest issue, and it is what actually caused v2's protocol drift (a trace retuned
mid-campaign until the miss gate passed).

- Link supply at 32 KB / 10 Mbit = **39 frames/s**. Reader at 50 ms/step = **20 frames/s**
- v2's cells were *not* link-limited: at D=4 on a real ~240 ms path, the pipeline delivers
  `D × 32 KB / RTT` ≈ **4.3 Mbit/s ≈ 17 f/s**, below the reader — so nearly every step missed and the
  wait was a **backlog**, not a delivery latency
- **After S4 fixes the path this inverts.** At a true 60 ms RTT, D=4 gives ≈ 17 Mbit/s of pipeline,
  so the link (39 f/s) outruns the reader (20 f/s), prefetch stays ahead, and the **0 % cell becomes
  nearly all cache hits** — exactly the condition the `cache_misses ≥ 20` gate rejects. The null
  control that clause 1 depends on would have almost no miss samples

So fixing the path silently moves every cell across the demand/supply line, in a direction that
starves the metric. `cloud_common.sh:31` already has `cloud_precheck_ratio` to compute this and it
was never used to *choose* the cadence.

**Do — calibrate the cadence per cell, by a written rule, before the first row:**

1. Run **three pilot runs on the S arm** in the cell's exact netem state, at D and
   `--step-interval-ms 0` (reader as fast as the window allows). Take `frames_on_wire / step_loop_ms`
   → the cell's **achieved delivery rate** `f_cell`
2. Set the cell's reader cadence to **`step_interval_ms = round(1000 / (0.9 × f_cell))`** — a reader
   marginally faster than delivery, so a miss is one frame's delivery wait, not accumulated backlog
3. **Freeze it, use the identical cadence for all three arms in that cell**, and write it into the row
   (`step_interval_ms`, `f_cell_pilot`). Pilot runs are recorded and excluded from analysis

**This needs a CLI flag rather than an edit to the trace file** — editing `l1_one_way_80.json` per
cell is exactly the tracked-file drift S11 exists to stop. Add `--step-interval-ms <ms>` to override
`TraceSpec.step_interval_ms` (`trace.rs:9`), plumbed via a new `RunConfig` field.

### A2 · A backlog gate, so a cell cannot silently measure queueing

Even calibrated, a cell can drift into backlog. The signature is a wait distribution that grows
across the run.

**Do:** in the harness, record `wait_first_half_median_ms` and `wait_second_half_median_ms` over the
step loop. **Gate A2:** if the second-half median exceeds the first-half median by > 50 %, the run is
backlog-dominated → mark `BACKLOG` in the TSV, exclude from the decision, keep the row.

### A3 · Test H7 — the flow-control asymmetry — before attributing anything to head-of-line blocking

quinn's defaults (`quinn-proto 0.11.17`, `config/transport.rs`): `stream_receive_window` **1.25 MB**,
`send_window` **10 MB** (8×), `receive_window` `VarInt::MAX`. The shared arm gets **one** stream
window; per-frame arms get one **per frame** up to the connection window. That is an arm asymmetry
that exists **at zero loss**, and it is the best available explanation for v2's lossless 26 % gap.

Direction matters: `stream_receive_window` is *"maximum number of bytes the peer may transmit … on
any one stream"* — set by the **receiver**, so for server→client uni streams the knob is on the
**harness**, not the server. `wtransport 0.7.2` exposes
`ClientConfigBuilder::with_custom_transport(QuicTransportConfig)` (`config.rs:1009`).

**Do:** add `--stream-recv-window <bytes>` to the harness (default: unchanged, so the default
campaign is unaffected), and run a **two-run diagnostic** at 0 % loss, D=7, S arm: default vs
`--stream-recv-window` = the connection send window. If the arm gap moves with that knob, the effect
is flow control, not HOL blocking, and the decision rule must equalise it across arms.

### A4 · Vary D inside a cell — the mechanism's most distinctive prediction

Per Marx, the benefit *requires* concurrency: *"if there is only a single stream active at a given
moment, any loss will impact that lonely stream and we will still be HOL blocked, even in QUIC."*
So the effect must grow with D. No v2 cell can test that — D was constant per cell.

**Do:** one extra sweep at RTT 60 / 0.5 %, arms S and Q, **D ∈ {1, 2, 4, 8}**, 10 repeats each.
`run_depth_sweep` already exists (`client.rs:66`, `--depth-sweep 1,2,4,8`), fresh session per depth.
80 runs, ≈ 45 min. A gain that does not grow with D is not head-of-line blocking.

### A5 · Record throughput, and gate on it

Add `link_util_measured = bytes_on_wire × 8 / step_loop_ms` per run.
**Gate A5:** a loss cell sustaining **< 25 % of the shaped rate** is congestion-limited — mark it,
and let C2's conditioned clause 3 exempt it. This turns "is the cell measuring CC or architecture?"
from an argument into a column.

### A6 · The bursty-loss cell

Add, at **RTT 60 / 0.5 % mean loss / D=4**, all three arms, full repeat count, using C5's
`gemodel 0.07% 14%`. If Q's win is present under i.i.d. and absent under bursty loss, **the
stream-mode decision must be scoped to i.i.d. loss and does not transfer to production.** That is the
single highest-value cell in the campaign and it costs ~1.3 h.

### A7 · Sample budget — the fixture, not the cadence, buys samples

At 80 steps, one run yields at most 80 wait samples and (after A1) perhaps 30–50 misses. v2 solved
this by shrinking the step interval mid-campaign. The clean lever is a longer trace.

**Do:** `gen_tf_fixtures.sh` already takes `FRAMES` (`gen_tf_fixtures.sh:6`). Add
`FRAMES=160 gen_one 32000 frames_32k_160`, and a `lab/traces/l1_one_way_160.json` produced by the
same generator as the 80-frame one. Doubles samples per run without touching the cadence.

**Budget with every addition** (~35 s/run including connect and settle):

| block | runs | wall |
| --- | ---: | ---: |
| S9 decision cells (0 %, 0.5 %; 2 RTT; S,P,Q) | 720 | ≈ 7.0 h |
| 2 % diagnostic + D=1 controls | 120 | ≈ 1.2 h |
| A6 bursty cell (RTT 60, 3 arms, 40 each) | 120 | ≈ 1.2 h |
| A4 depth sweep | 80 | ≈ 0.8 h |
| A1 pilots (3 per cell) | ~30 | ≈ 0.3 h |
| **total** | **~1070** | **≈ 10.5 h** |

Two rig sessions, or one overnight. **If the budget must be cut, cut the RTT 150 arm P cells first**
(P is an attribution control, and RTT 150 needs 80 repeats for power) — never cut A6.

---

## 3 · Execution order

Phases are gated: a phase does not start until the previous one's gates pass. Effort is developer
time; wall is rig time.

| # | Phase | Steps | Effort | Blocks |
| - | --- | --- | ---: | --- |
| **0** | **Void v2** | S0 | 10 min | everything |
| **1** | **Harness correctness** — no rig | S1, S2, **C4**, A1's `--step-interval-ms`, A2's half-medians, A5's `step_loop_ms`/util, A3's `--stream-recv-window` | ~4 h | 2 |
| **2** | **Prove it locally** | S3 redundancy gate + `cargo test`/`clippy`; C4's timing gate; one local lossless run | ~1 h | 3 |
| **3** | **Arm parity** | **C1** rebuild Q on `main`; extend `l1_build_bins.sh`; `server_sha` column | ~1 h | 5 |
| **4** | **Rig plumbing** | S4 netns/veth (one-time), **C5** loss models, C3 three-port servers, S7 netem asserts, ping → `rtt_measured_ms` | ~3 h | 5 |
| **5** | **Path validation** | Gate S4a (ping ±5 %), Gate S4b (D=1 band 71–101 / 156–196 ms), Gate S5 (D from measured RTT) | ~1 h + 0.5 h rig | 6 |
| **6** | **Calibration** | A1 pilots per cell; freeze cadences; commit them | ~1 h + 0.3 h rig | 7 |
| **7** | **Analysis script first** | `lab/scripts/l1_v3_analyze.py` with S12 + **C2**; committed **before** any row (Gate S12) | ~2 h | 8 |
| **8** | **Protocol freeze** | S11 dirty-tree check, `protocol_sha` column | 30 min | 9 |
| **9** | **Collect** | S6 interleaved, S8 raw to `docs/measurements/r2/raw/l1v3/`, S9 repeats, A6, A4 | — | 10.5 h rig |
| **10** | **Diagnostics** | A3 flow-control two-run test; A2/A5 cell labelling | ~1 h | — |
| **11** | **Analyse** | Run the frozen script unmodified; report | ~1 h | — |

**Total: ~15 h developer, ~11 h rig.**

---

## 4 · File-by-file change map

| File | Change |
| --- | --- |
| `lab/window-harness/src/client.rs` | S1 (`emit_window` takes `&SharedMetrics`, skips `m.cache`, three call sites); S2 (`window_frames(center, d, n, shape)`); **C4** (drop `wait_outstanding_below` from the step loop); A1 (use `cfg.step_interval_ms` override); A2/A5 (record half-medians, `step_loop_ms`); A3 (`with_custom_transport` when the flag is set) |
| `lab/window-harness/src/metrics.rs` | `WindowShape` enum; `RunConfig{ window_shape, step_interval_ms: Option<u64>, stream_recv_window: Option<u64> }`; `HarnessMetrics{ step_loop_ms, wait_first_half_median_ms, wait_second_half_median_ms, link_util_measured }` |
| `lab/window-harness/src/main.rs` | Flags `--window-shape`, `--step-interval-ms`, `--stream-recv-window`; extend the `RunConfig` literal (`main.rs:70` — the only construction site) |
| `lab/scripts/cloud_netem.sh` | **C5** loss model argument (`iid` \| `gemodel`), `GE_P`/`GE_R` |
| `lab/scripts/cloud_common.sh` | `cloud_set_netem` takes the model; `cloud_precheck_ratio` reused by A1 |
| `lab/scripts/l1_build_bins.sh` | **C1** build Q from `feat/set-priority-per-frame-v3`; emit both server SHAs |
| `lab/scripts/l1_loss_run_v3_cloud.sh` | **New.** netns exec, three-port arms (C3), interleaving (S6), per-run netem assert (S7), pilots (A1), gates S3/S4a/S4b/S5/A2/A5, raw to a tracked dir (S8), `protocol_sha` (S11) |
| `lab/scripts/l1_v3_analyze.py` | **New.** Medians, bootstrap CI (20 000), permutation p, the S12 + C2 decision test, cell labels |
| `lab/scripts/gen_tf_fixtures.sh` | A7 `frames_32k_160` |
| `lab/traces/l1_one_way_160.json` | **New.** Forward 160-step trace; `step_interval_ms` is now an *override* target, not the protocol |
| `server/src/transport/server.rs` (on the new Q branch only) | C1's ~10-line priority patch over current `main` |
| `docs/measurements/r2/l1_s_vs_q_loss_v2.tsv` | S0 → `…v2.VOID.tsv` with the VOID header line |

---

## 5 · TSV schema for v3

```
arm  fixture  trace  rtt_label_ms  rtt_measured_ms  loss_pct  loss_model  depth  step_interval_ms
run  order_index  miss_p95_wait_ms  miss_mean_wait_ms  p95_wait_ms  mean_wait_ms
cache_hit_rate  cache_misses  asks_sent  peak_outstanding  bytes_on_wire  step_loop_ms
link_util_measured  wait_h1_median_ms  wait_h2_median_ms  cell_label  protocol_sha  server_sha  ts_iso
```

New versus v2, and why each exists: `rtt_measured_ms` (S4/S5), `loss_model` (C5/A6),
`step_interval_ms` + pilot provenance (A1), `order_index` + `ts_iso` (S6 — makes interleaving and
drift auditable), `bytes_on_wire`/`step_loop_ms`/`link_util_measured` (A5), the half-medians and
`cell_label ∈ {OK, BACKLOG, CONGESTION_LIMITED, VOID}` (A2/A5), `protocol_sha` (S11), `server_sha`
(C1).

Raw per-run JSON and the `tc` snapshot go to `docs/measurements/r2/raw/l1v3/` — **tracked**, ≈ 2 MB
for the whole campaign (S8).

---

## 6 · Decisions that need a human call

1. **A1's calibrated cadence changes the workload definition.** It is the difference between
   measuring delivery latency and measuring queueing, and it means the reader's rate differs per
   cell. Within-cell S-vs-Q comparison is unaffected; across-cell absolute waits are not comparable.
   **Recommend: adopt.** The alternative — one fixed cadence — puts the 0 % and 2 % cells on opposite
   sides of the demand/supply line, which is what v2 did.
2. **Budget.** ~10.5 h of rig time, exclusive. If that is not available, the minimum decidable
   campaign is RTT 60 only (0 %, 0.5 %, S/P/Q, 40 repeats) **plus A6** — ≈ 4 h — and the RTT axis is
   dropped rather than under-powered.
3. **A3's flow-control diagnostic could become a permanent equalisation.** If the knob moves the gap,
   should v3 equalise flow control across arms (making the comparison purely about delivery order),
   or measure the arms as a product would ship them (defaults, asymmetry included)? These answer
   different questions; the second is the product question.
4. **Whether the 15 % bar still applies** once the harness stops manufacturing head-of-line exposure.
   The bar was set against a client-side cost (out-of-order arrival handling in the viewer). It
   should be re-affirmed or re-derived before collection, not after.

---

## 7 · Definition of done

- [ ] `l1_s_vs_q_loss_v2.tsv` is VOID-renamed and no runner can open it
- [ ] `asks_sent ≤ 1.25 × frame_count` on every row (S3)
- [ ] Ping RTT within ±5 % of label, and the D=1 control inside the S4b band, on every cell
- [ ] Every row carries `rtt_measured_ms`, `loss_model`, `protocol_sha`, `server_sha`, `order_index`
- [ ] Arms interleaved run-by-run; three servers alive before and after each run
- [ ] Raw JSON committed; three random rows recomputed from raw to 0.01 ms (S8)
- [ ] Null control CI contains 0 (S12 clause 1) — **if it does not, the campaign stops here**
- [ ] Decision computed by the frozen script, unmodified since before collection
- [ ] The bursty-loss cell (A6) reported beside the i.i.d. cell, and the claim scoped to whichever
      loss models it survives
- [ ] The write-up states what per-frame framing does **not** buy: loss detection, retransmission and
      the congestion window are connection-wide in quinn, so only delivery gating changes
