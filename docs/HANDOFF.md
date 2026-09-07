# Handoff — transport optimisation, branch `cursor/l1-loss-run-dbae`

**Written 2026-09-06**, **amended 2026-09-07**, so a later session, a different agent, or a
person can pick this up without reading the conversation that produced it.

The 2026-09-07 pass closed §4.5's pathological client (§2, and
[`measurements/mem/stall-client.md`](measurements/mem/stall-client.md)) and **corrected §1**,
whose claim that `main` is a direct ancestor had gone stale.

**Start here:** [`transport-conclusions.md`](transport-conclusions.md) is the answer sheet.
This document is the *state of play* — what is settled, what is running, what is next, and
the traps that have already cost this project four invalidated campaigns.

---

## 1 · Where the branch is

| | |
| --- | --- |
| Branch | `cursor/l1-loss-run-dbae` |
| Relation to `main` | **no longer a fast-forward — see the warning below** |
| Contains | the L1 loss-run lane **plus** the R6 stream-shape lane, merged and reconciled |
| Build | `cargo build --release --workspace` clean; 12 server tests + 8 harness tests pass |
| PR | **not opened yet** |

> **Corrected 2026-09-07.** This table used to claim `main` was a direct ancestor and that
> `git rev-list origin/main --not HEAD` printed nothing. **That is no longer true.** The
> fork point is `be78860` (2026-09-04) and **72 commits have since landed on `main`**,
> including the client-frame-pipeline-telemetry PR, which rewrites
> `server/src/transport/server.rs` and adds `server/src/transport/pipeline.rs`.
>
> A dry-run merge conflicts in **11 files**:
>
> ```bash
> git merge-tree --write-tree origin/main HEAD      # exits 1; conflicts listed below
> ```
>
> `.gitignore`, `Cargo.toml`, `docs/send-path-copy-costs.md`, `lab/README.md`,
> `lab/window-harness/src/{client,main,metrics}.rs`, `server/src/main.rs`,
> `server/src/record/mod.rs`, `server/src/transport/{mod,server}.rs`.
>
> **Reconciling this is a decision, not a chore** — `server.rs` is the file both sides
> rewrote, and this branch's measurements were all taken against its version. Nobody has
> made that call yet; it is deliberately left open rather than resolved in passing.
>
> Note also that a shallow clone makes this *look* worse than it is — `git merge-base`
> reports no common ancestor at all until you `git fetch --unshallow`. Do that before
> concluding anything about ancestry.

### The only two behaviour changes vs main

Every transport knob defaults to `None` = quinn's own value. Two defaults differ:

```rust
send_path: SendPath::Chunked,   // main had the copy path only. −6…−14 % CPU/byte.
prefault: true,                 // faults frame pages in off the executor.
```

`--send-path copy --prefault true` reproduces main's behaviour exactly, and the test
`all_send_paths_are_the_same_wire` (server.rs:613) fails if the three paths ever diverge on
the wire. To land the knobs without the default changes, flip those two lines.

**The one change worth reading carefully** is `frame_store.rs`: `Mmap` → `Bytes` holding the
same mapping, so slices can be refcounted instead of copied. Small, tested, but not
mechanical.

---

## 2 · Settled — do not re-litigate without new evidence

| finding | strength |
| ------- | -------- |
| **Keep one shared stream.** Per-frame is 3.5× worse at 64 KB, **8.5× worse at a realistic 250 KB**, never better anywhere | 3/3 separated, two trace shapes, mechanism source-verified, prediction survived — **all of it in netsim.** On the real rig the 64 KB cell does not separate, and §3 explains why that is an underpowered test rather than a contradiction |
| **Mechanism:** `retransmit()` re-queues with `push_pending` — back of the class, *regardless of fairness* (`state.rs:677`). Per-frame therefore **defers** loss recovery behind other frames' backlogs | source + a falsifiable prediction that held |
| **`send_fairness(false)` is mandatory** if per-frame is ever used | worse in all 12 comparisons, 4 cells |
| **Controller depends on loss regime.** Congestive → Cubic (BBR +63 %); exogenous → BBR (Cubic +48 %). **Default Cubic** | both directions separated, regimes verified by queue counters |
| **GSO cap 10 → 32:** +17 % throughput, −21 % CPU/byte. Derive it from **bytes** (`min(platform, 65527/mtu)`), never `max_gso_segments()` — exceeding it disables offload *permanently* (91 % collapse) | externally corroborated |
| **Memory is not the constraint:** ~110 KB/viewer, ~0.5 GB at 5 000 | r² 0.98–0.99 |
| **The pathological client is bounded by the send path, not the windows.** A client that asks 25 MB and stops reading costs **180 KB/connection on `chunked` + shared** — the withheld bytes queue on the *client* (2.20 MB), not the server. On `copy`/`split` + per-frame the same client costs **6.8 MB, 68 % of the 10 MB `send_window`** | campaign 48 rows / 0 VOID / r² ≥ 0.979, E0-gated; send-path probe 48 rows / 0 VOID / r² ≥ 0.974, anon and total RSS agree within 1 %. T2 loopback, N ≤ 16 |
| **`chunked` is a memory-containment property, not only a CPU one** — 6.5× cheaper than `copy` in shared, **18.6×** in per-frame, because the queue holds refcounted slices of one mapping instead of a private copy per connection. `main` has the copy path only | same probe |
| **Initial congestion window is not a lever** (≤ 7 %) | two independent measurements |
| **Loss-regime classifier works**, validated against constructed ground truth both directions | queue-drop witness agreed with each cell |

---

## 3 · The Oracle rig session — **it ran.** Read this before quoting a stream-shape number

Results: [`measurements/r6/r6cloud-results.md`](measurements/r6/r6cloud-results.md).
Instrument: [`measurements/r6/real-path-notes.md`](measurements/r6/real-path-notes.md).
36 rows, 0 VOID, all gates applied.

**It neither confirmed nor contradicted the stream-shape finding. It could not.**

| cell | netsim | rig |
| --- | --- | --- |
| N0 (control) | tie | **tie +0.8 % — the gate passes** |
| X2, X1 | tie | tie |
| **X3, 1 % loss, 64 KB** | shared wins **+250 %**, 3/3 | **+266 %, +38 %, −52 %** — sign flips, not a result |

The reason is arithmetic, not disagreement: the effect sought is 3.5×, and the loss
realisation alone moves `shared` by **4.32×**. **The cell could not have detected netsim's
own effect at n = 3 even if the mechanism is exactly right.** Do not cite this as evidence
against the mechanism.

**The run that would settle it is X3L on the rig** — 250 KB frames, where the mechanism
predicts 8.5×, comfortably above a 4.3× noise floor. Not run: the residential path degraded
51 → 9 Mbps mid-session and the comparison needs one sitting on a stable path. ~1 hour for
two arms at n = 3, plus calibration. **This is now the highest-value run on the rig.**

Three other things came back, and two of them change how future runs must be done:

- **`sch_netem` draws loss once per GSO batch, not per datagram**, and the batch size
  **differs by arm** — 6.87 datagrams for `shared` against ~4.3 for per-frame, so the shared
  arm absorbs ~1.5× fewer congestion events at equal bytes. Any netem loss experiment
  comparing stream shapes must run `--segmentation-offload false`. The bias favours the
  incumbent, which still failed to separate.
- **The committed R6 scripts are localhost + netsim only.** `r6_campaign.sh`,
  `e0_r6_calibrate.sh` and `e0_r6_reader_validate.sh` start the server on `127.0.0.1` and
  shape with `target/release/netsim`; running them on a laptop measures the simulator and
  reports it as a real-path result. Use the `*_cloud.sh` variants. The runbook's
  `cloud_netem.sh 25 20 0.1` never parsed — that script takes a named profile and shapes
  whatever host runs it.
- **The real path is one step-scale easier than netsim.** Recalibrate; never carry a
  step-scale across rigs.

---

## 4 · Next, in priority order

### 4.1 · Deploy the loss-regime sampler — highest value, smallest change

Settles the biggest open decision (Cubic vs BBR, ~50 % either way). Everything is built and
validated; it needs **deployment, not development**.

```bash
cargo build --release -p exact-server --features telemetry    # sampler is compiled out otherwise
WTPACS_PATH_TELEMETRY=1 WTPACS_PATH_TELEMETRY_PATH=/var/log/wtpacs/path.jsonl exact-server ...
python3 lab/scripts/classify_loss_regime.py /var/log/wtpacs/path.jsonl --per-session
```

Read the **per-session** output. The aggregate hides the thing that matters: whether the mix
differs by access type. "Wired viewers congestive, mobile exogenous" is far more useful than
one verdict over both.

Volume: ~200 bytes per connection per second. A 1 000-viewer hour is ~700 MB uncompressed —
rotate it or raise `WTPACS_PATH_TELEMETRY_MS`.

### 4.2 · Competing-flow fairness — **done, and the risk is real**

Measured on the rig, two flows through one shared `tc netem` band. Data:
[`measurements/r6/r6cloud_fairness.tsv`](measurements/r6/r6cloud_fairness.tsv); method,
controls and limits: [`measurements/r6/r6cloud-results.md`](measurements/r6/r6cloud-results.md) §4.1.

| bottleneck buffer | our flow | competing TCP Cubic | our share |
| --- | --- | --- | --- |
| **shallow, ≈48 ms** | **QUIC BBR** | **0.03 Mbps** | **99.4 %** |
| shallow | QUIC Cubic | 1.46 Mbps | 70.0 % |
| deep, ≈1.2 s | QUIC BBR | 2.12 Mbps | 55.1 % |
| deep | QUIC Cubic | 1.07 Mbps | 76.8 % |

The same TCP flow takes **4.5 Mbps alone** at the same shallow bottleneck, so that is
starvation — 150× — not a weak competitor. **`transport-conclusions.md` §1.1 now carries a
measured number instead of a citation, and "default to Cubic" is stronger for it.** Note
also that QUIC-with-Cubic still takes 70–77 %: some of the unfairness is ours regardless of
controller.

**One arm remains impossible on this rig:** QUIC-Cubic against QUIC-BBR. The congestion
controller is a server-wide flag, so two QUIC flows with different controllers need two
listeners, and the Oracle VCN admits exactly one UDP port (4435) plus TCP 22 — verified by a
QUIC handshake that times out against a server confirmed listening on 4436. Opening a second
UDP port at the VCN would unblock it.

### 4.3 · Progressive delivery — biggest potential win, biggest effort

HTJ2K can display a rough image from a truncated prefix. If it works, first-display becomes
one RTT regardless of frame size, and the frame-size and stream-shape questions dissolve.
Do it **after** 4.1, because real traces tell you whether it is worth it.

### 4.4 · Cache size and prefetch depth

64 frames and depth 8 were **chosen, not measured**. The cache is probably the single
largest determinant of every millisecond figure in this project. Needs real device memory
budgets.

### 4.5 · Cheap and unattended

- **More repeats on X1** (n = 10). Variance is what stopped it separating. Pure machine time.
- ~~**The pathological client**~~ — **done 2026-09-07.** `window-harness --mode stall`,
  gated by `e0_stall_validate.sh`, measured in
  [`measurements/mem/stall-client.md`](measurements/mem/stall-client.md). The answer is that
  the ceiling is *not* approached: 180 KB per stalled connection against a 10 MB
  `send_window`, and the withheld bytes queue on the client instead. `transport-conclusions.md`
  §3.1 carries it. The recommendation is now **conditional on the send path**: hygiene on
  `chunked` + shared, worth it for the original reason on `copy`/`split` + per-frame, where
  the same client costs 6.8 MB — 68 % of the ceiling.
  **What it opens:** the stalled client here uses stack-default windows. A client that
  *widens* its own receive window first is a different threat model, and on this rig it does
  not survive to be measured — the client's own quinn kills the connection with
  `FLOW_CONTROL_ERROR "too many gaps in stream buffer"` before the server's `send_window`
  can bind. `lab/scripts/stall_wide_window_probe.sh` sweeps it. Whether that holds on a
  high-BDP path, where the in-flight window rather than the peer's credit bounds the server,
  is unmeasured.

---

## 5 · Traps — five instances of the same failure

**A guard checked once and assumed to hold.** Every invalidated campaign in this project was
this, in a new costume:

1. **L4** — the path was never congested, so every loss was exogenous
2. **L4** — p95 computed over cache-hit structural zeros
3. **L4** — the queue *arithmetically could not drop* at the chosen depth
4. **L1 + R6** — the reader could not fall behind, so head-of-line blocking could not occur
5. **R6** — the operating point was calibrated on one seed, then voided 4 of 9 rows

L1's own review named it independently: *"v2 retuned the workload until the metric's
admission rule passed; Phase C retuned the admission rule until the workload passed."*

### The practices that catch it

- **Before trusting a comparison, check the rig can still produce the effect being
  compared** — across the whole range the campaign uses, not one point. R6 makes this a
  gate: `stranded_bytes == 0` voids a row.
- **Validate an instrument against an answer you already know** before using it. The
  loss-regime classifier was tested against two constructed regimes with an independent
  witness; the open-loop reader against a cell where the closed-loop reader strands exactly
  0.00 MB.
- **Write down the prediction that would embarrass you.** R6 pre-registered P5 — that
  fairness-on would *beat* FIFO — the opposite of what the project had published. It was
  falsified. Recording it in advance is what made it impossible to quietly drop.
- **Keep VOID rows.** Failures are systematically the slowest runs; deleting them flatters
  whichever arm fails. This project biased one result exactly that way.
- **Calibrate on the incumbent arm, then freeze across arms**, and re-check the chosen point
  at *every seed the campaign will use*.

---

## 6 · Structural limits on everything above

- **T2 throughout.** One host, a userspace simulator, no real network. The Oracle run (§3)
  is the first thing that changes this.
- **Handovers, variable bandwidth, variable RTT are unmodelled.** For a mobile radiologist
  these plausibly dominate everything measured. Neither the simulator nor the Oracle rig has
  them — they live at the *client's* radio edge and need a real device on a real mobile link.
- **No real data anywhere.** Fixtures are one repeated byte; every trace is synthetic.
- **Fixed-N stream pool untested.** R6 makes it less promising (deferral cost grows with N,
  winning endpoint is N = 1) but it is inference, not measurement.

---

## 7 · Map of the documents

| document | what it is |
| -------- | ---------- |
| [`transport-conclusions.md`](transport-conclusions.md) | **the answer sheet** — findings with their confidence and what would overturn each |
| [`transport-optimization-spec.md`](transport-optimization-spec.md) | architecture-independent spec, written to outlive the server it was measured on |
| [`transport-assumption-audit.md`](transport-assumption-audit.md) | A1–A16, the assumptions and which are untested |
| [`lanes/R6-preregistration.md`](lanes/R6-preregistration.md) | hypotheses and decision rules, fixed before the campaign ran |
| [`lanes/L1-R6-convergence.md`](lanes/L1-R6-convergence.md) | how the two lanes on this branch relate |
| [`measurements/r6/`](measurements/r6/) | stream shape: data, instrument validation, adversarial review |
| [`measurements/regime/`](measurements/regime/) | loss-regime classifier and its ground-truth test |
| [`measurements/mem/`](measurements/mem/) | memory per viewer, and the flow-control window question |
| [`ORACLE-RIG-AGENT-GUIDE.md`](ORACLE-RIG-AGENT-GUIDE.md) | running campaigns on the real rig, gates first |

### Key scripts

| script | purpose |
| ------ | ------- |
| `lab/scripts/cloud_preflight.sh` | **run first** on any rig work; fails fast if the environment cannot reach it |
| `lab/scripts/e0_r6_reader_validate.sh` | proves the rig can produce head-of-line blocking |
| `lab/scripts/e0_r6_calibrate.sh` | finds the admissible operating point; takes `SEED=` |
| `lab/scripts/e0_regime_validate.sh` | proves the loss-regime classifier on known ground truth |
| `lab/scripts/r6_campaign.sh` | the stream-shape campaign |
| `lab/scripts/r6_analyse.py` | applies the pre-registered decision rules |
| `lab/scripts/mem_per_connection.sh` | memory per viewer; takes `READ_BPS=` for the stress case |
| `lab/scripts/classify_loss_regime.py` | offline regime classification |
| `lab/scripts/e0_stall_validate.sh` | proves `--mode stall` really stops reading; gates the campaign below |
| `lab/scripts/stall_client_campaign.sh` | the pathological-client campaign; samples **both** ends |
| `lab/scripts/stall_analyse.py` | per-connection slopes, server and client |
| `lab/scripts/stall_send_path_probe.sh` | rules out the chunked-send-path/`RssAnon` confound |
| `lab/scripts/stall_wide_window_probe.sh` | the hostile variant: client widens its own window first |

---

## 8 · Housekeeping

- **Rotate the Oracle rig SSH key.** It was pasted into a chat transcript. Never entered the
  repository (verified), but it should be treated as compromised regardless of use — the
  same reasoning that retired the previous one. See `cloud-rig-access.md`.
- **Large fixtures are gitignored** (`frames_500x64k`, `frames_500x250k`). Regeneration
  recipes are in each fixture's README.
- **The `telemetry` feature is off by default.** The lab-arms binaries are built without it,
  which is why the sampler sat unexercised until `e0_regime_validate.sh` ran it.
