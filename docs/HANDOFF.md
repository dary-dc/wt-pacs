# Handoff — transport optimisation, branch `cursor/l1-loss-run-dbae`

**Written 2026-09-06** so a later session, a different agent, or a person can pick this up
without reading the conversation that produced it.

**Start here:** [`transport-conclusions.md`](transport-conclusions.md) is the answer sheet.
This document is the *state of play* — what is settled, what is running, what is next, and
the traps that have already cost this project four invalidated campaigns.

---

## 1 · Where the branch is

| | |
| --- | --- |
| Branch | `cursor/l1-loss-run-dbae` |
| Relation to `main` | `main` is a **direct ancestor** — merge is conflict-free, nothing from main is lost |
| Contains | the L1 loss-run lane **plus** the R6 stream-shape lane, merged and reconciled |
| Build | `cargo build --release --workspace` clean; 12 server tests pass |
| PR | **not opened yet** |

Verify the "nothing lost" claim yourself:

```bash
git rev-list origin/main --not HEAD          # must print nothing
git diff origin/main..HEAD -- server/ | grep '^-[^-]'   # all 37 deletions; each is a rewrite
```

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
| **Keep one shared stream.** Per-frame is 3.5× worse at 64 KB, **8.5× worse at a realistic 250 KB**, never better anywhere | 3/3 separated, two trace shapes, mechanism source-verified, prediction survived |
| **Mechanism:** `retransmit()` re-queues with `push_pending` — back of the class, *regardless of fairness* (`state.rs:677`). Per-frame therefore **defers** loss recovery behind other frames' backlogs | source + a falsifiable prediction that held |
| **`send_fairness(false)` is mandatory** if per-frame is ever used | worse in all 12 comparisons, 4 cells |
| **Controller depends on loss regime.** Congestive → Cubic (BBR +63 %); exogenous → BBR (Cubic +48 %). **Default Cubic** | both directions separated, regimes verified by queue counters |
| **GSO cap 10 → 32:** +17 % throughput, −21 % CPU/byte. Derive it from **bytes** (`min(platform, 65527/mtu)`), never `max_gso_segments()` — exceeding it disables offload *permanently* (91 % collapse) | externally corroborated |
| **Memory is not the constraint:** ~110 KB/viewer, ~0.5 GB at 5 000 | r² 0.98–0.99 |
| **Initial congestion window is not a lever** (≤ 7 %) | two independent measurements |
| **Loss-regime classifier works**, validated against constructed ground truth both directions | queue-drop witness agreed with each cell |

---

## 3 · What is running elsewhere right now

**A local Claude Code session on the Oracle rig.** Its brief is
[`ORACLE-RIG-AGENT-GUIDE.md`](ORACLE-RIG-AGENT-GUIDE.md); it runs `cloud_preflight.sh`
first and stops if that fails.

**Expect it to commit into `docs/measurements/r6/`.** Anyone else working this branch should
avoid that directory to prevent conflicts.

Its result either confirms or contradicts the simulator's stream-shape finding. **A
contradiction is a finding, not a problem** — the simulator is T2 and the rig is closer to
truth.

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

### 4.2 · Competing-flow fairness — **blocked here, and the reason matters**

BBR's main deployment risk. Never measured anywhere in this project.

**`netsim` cannot do it.** Each client gets its own pacer, hence its own queue and rate
limiter, so two clients get one bottleneck *each* at full rate. Run it there and both flows
get full rate, which reads as perfect fairness when they never competed. Comment is in
`lab/netsim/src/main.rs` at the client map.

**Do it on the Oracle rig**, where `tc netem` on one egress interface is genuinely one
shared queue. The arm that matters is **one Cubic flow against one BBR flow** — quinn's own
docs say BBRv1 can take > 90 % of a shallow buffer.

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
- **The pathological client** — asks then stops reading. The case flow-control ceilings
  exist for; the harness always reads, so it cannot produce it. Needs a `--stall-after-ms`
  flag.

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

---

## 8 · Housekeeping

- **Rotate the Oracle rig SSH key.** It was pasted into a chat transcript. Never entered the
  repository (verified), but it should be treated as compromised regardless of use — the
  same reasoning that retired the previous one. See `cloud-rig-access.md`.
- **Large fixtures are gitignored** (`frames_500x64k`, `frames_500x250k`). Regeneration
  recipes are in each fixture's README.
- **The `telemetry` feature is off by default.** The lab-arms binaries are built without it,
  which is why the sampler sat unexercised until `e0_regime_validate.sh` ran it.
