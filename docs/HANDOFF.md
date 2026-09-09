# Handoff — transport optimisation, branch `cursor/l1-loss-run-dbae`

**Written 2026-09-06**, amended **2026-09-07** and **2026-09-08**, so a later session, a
different agent, or a person can pick this up without reading the conversation that produced
it.

**Start here:** [`transport-conclusions.md`](transport-conclusions.md) is the answer sheet.
This document is the *state of play* — what is settled, what is next, and the traps that have
already cost this project four invalidated campaigns.

---

## 0 · If you are picking this up cold

The branch is **green, pushed, and not merged**. Nothing is half-applied; there is no
in-flight edit to reconstruct.

```bash
git fetch --unshallow origin            # ancestry is wrong without this — see §1
git checkout cursor/l1-loss-run-dbae
cargo test --workspace && cargo clippy --workspace --all-targets
```

Expect 8 server tests (36 with `--features telemetry` — `main`'s tap/rows/sink suite plus
the path-sampler concurrency test), 7 harness. Clippy on the server is the one warning
`main` left in `server/src/transport/wire.rs` (`items_after_test_module`).

**The one thing to know before touching `server/`:** experiment arms live behind
`--features lab`. A product build has 12 flags and one send path; the lab build has 21 and
three. Lab scripts build with the feature already. See
[`branch-source-audit.md`](branch-source-audit.md).

**The port onto `main`'s `pipeline.rs` is on [`cursor/port-onto-main-d27c`](https://github.com/dary-dc/wt-pacs/pull/20)**
— plan in [`merge-with-main-analysis.md`](merge-with-main-analysis.md). `locate`/`send`
carry `Bytes`; the write paths call the assemblers; `--max-idle-timeout-ms` is applied on
the wtransport builder. The stall campaign (~200 kB/connection on `chunked`) is still the
copy gate and has not been re-run on the merged tree.

### What the 2026-09-08 pass changed

| | |
| --- | --- |
| **Shipped the conclusion** | `--stream-mode` now defaults to `shared`; §2.7's pre-registered rule fired when X3L separated |
| **Separated rig from product** | product `--help` is 12 flags, 8 of them transport (`--stream-mode --bind --receive-window --send-window-bytes` (alias `--send-window`) `--stream-receive-window-bytes` (alias `--stream-receive-window`) `--max-idle-timeout-ms --congestion --prefault`); lab adds 9 more. One send path on a product build; every experiment arm behind `--features lab`, nothing deleted. The two extra product knobs are `main`'s shipped names, kept so the port does not drop them |
| **Leaned the comments** | 157 multi-line blocks → 39, all file headers; every in-body comment is one or two lines, rationale moved to the measurement documents |
| **Closed the review** | all 25 findings transcribed into §4.4a with status — the artifact it lived in can be retired. Nine remain open |
| **Re-measured** | the stalled-client campaign re-run on the cleaned tree: 185.3 / 382.3 kB against a published 180 / 370, ratio 3.48× against 3.46× |
| **Clippy** | 21 → 3 |

**One thing it got wrong, and the correction matters more than the pass.** The audit deleted
five flags and the `split` send path as unreferenced, having counted usage with `grep` over
`lab/scripts/` and `server/src/`. Both readings were wrong for one reason: **arms are not
invoked from inside the scripts** — they arrive through `SRV_FLAGS`, and those command lines
live in the *documents*. All were restored behind `lab`. A repository that keeps its
invocations in prose cannot be audited by grepping its code (§5, trap 6).

---

## 1 · Where the branch is

| | |
| --- | --- |
| Branch | `cursor/l1-loss-run-dbae` (lineage); port is `cursor/port-onto-main-d27c` |
| Relation to `main` | **port in progress** — see §4.0 and the warning below |
| Contains | the L1 loss-run lane **plus** the R6 stream-shape lane, merged and reconciled, plus `main`'s pipeline extraction |
| Build | On the port branch: 8 server tests, 36 with `--features telemetry`, 7 harness — in every combination of `lab` and `telemetry`. Server clippy: `main`'s `wire.rs` warning |
| PR | Lineage [**#5**](https://github.com/dary-dc/wt-pacs/pull/5) (draft). Port [**#20**](https://github.com/dary-dc/wt-pacs/pull/20) (draft, into #5's branch). #12 was an earlier segment of the same lineage and has been closed as absorbed |

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
> **Analysed 2026-09-07:
> [`merge-with-main-analysis.md`](merge-with-main-analysis.md).** It is a *refactor meeting
> features*, not two rewrites of the same code: `main` **extracted** the serving logic into
> `pipeline.rs`/`frame_out.rs`, and its `serve_one` is `prepare → locate → send` — a seam
> exactly where this branch's send paths belong. `main` has zero references to `send_path`,
> `prefault` or `TransportTuning`, and `tuning.rs` does not exist there, so the work is a
> **port onto a known target**, not an adjudication. `frame_store.rs` — the riskiest change
> on this branch — merges clean. Of 823 conflicted lines, 477 are the one real file; 27 are
> both-added trivia. The acceptance gate already exists:
> `all_send_paths_are_the_same_wire`.
>
> Note also that a shallow clone makes this *look* worse than it is — `git merge-base`
> reports no common ancestor at all until you `git fetch --unshallow`. Do that before
> concluding anything about ancestry.

### The three behaviour changes vs main

Every transport knob defaults to `None` = quinn's own value. Three defaults differ:

```rust
mode: StreamMode::Shared,       // 2026-09-08. main still defaults to per-frame.
send_path: SendPath::Chunked,   // main had the copy path only. −6…−14 % CPU/byte.
prefault: true,                 // faults frame pages in off the executor.
```

`--stream-mode per-frame --send-path copy --prefault true` reproduces main's behaviour
exactly — **the middle flag needs `--features lab`**. `all_send_paths_are_the_same_wire`
fails if the three paths ever diverge on the wire. To land the knobs without the default
changes, flip those three lines.

**The one change worth reading carefully** is `frame_store.rs`: `Mmap` → `Bytes` holding the
same mapping, so slices can be refcounted instead of copied. Small, tested, but not
mechanical.

---

## 2 · Settled — do not re-litigate without new evidence

| finding | strength |
| ------- | -------- |
| **Keep one shared stream** — **and since 2026-09-08 the binary defaults to it** (`transport-conclusions.md` §2.7); `main` still defaults to `per-frame`. Per-frame is 3.5× worse at 64 KB, **8.5× worse at a realistic 250 KB**, never better anywhere | 3/3 separated in netsim, two trace shapes, mechanism source-verified, prediction survived — **and now confirmed on the real rig at 250 KB: 5.76×, 3/3, absolute penalty within 1.6 % of netsim** (§3). The 64 KB real-path cell remains an underpowered tie, not a contradiction |
| **Mechanism:** `retransmit()` re-queues with `push_pending` — back of the class, *regardless of fairness* (`state.rs:677`). Per-frame therefore **defers** loss recovery behind other frames' backlogs | source + a falsifiable prediction that held |
| **`send_fairness(false)` is mandatory** if per-frame is ever used | worse in all 12 comparisons, 4 cells |
| **Controller depends on loss regime.** Congestive → Cubic (BBR +63 %); exogenous → BBR (Cubic +48 %). **Default Cubic** | both directions separated, regimes verified by queue counters. **The congestive 600 ms cell is n = 2 for BBR** — one repeat produced no data — and the +63 % is `nz_p95`; separation is clean on both columns, but re-running that repeat is outstanding (`transport-conclusions.md` §1) |
| **GSO cap 10 → 32:** +17 % throughput, −21 % CPU/byte. Derive it from **bytes** (`min(platform, 65527/mtu)`), never `max_gso_segments()` — exceeding it disables offload *permanently* (91 % collapse) | externally corroborated |
| **Memory is not the constraint:** ~110 KB/viewer, ~0.5 GB at 5 000 | r² 0.98–0.99 |
| **The pathological client is bounded by the send path, not the windows.** A client that asks 25 MB and stops reading costs **180 KB/connection on `chunked` + shared** — the withheld bytes queue on the *client* (2.20 MB), not the server. On `copy`/`split` + per-frame the same client costs **6.8 MB, 68 % of the 10 MB `send_window`** | campaign 48 rows / 0 VOID / r² ≥ 0.979, E0-gated; send-path probe 48 rows / 0 VOID / r² ≥ 0.974, anon and total RSS agree within 1.2 %. T2 loopback, N ≤ 16. **Re-run 2026-09-08 on the cleaned tree: 185.3 / 382.3 kB, ratio 3.48× — inside the documented spread** |
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

**The run that would settle it was X3L on the rig** — 250 KB frames, where the mechanism
predicts 8.5×, comfortably above a 4.3× noise floor.

> **Run 2026-09-07. It separated.** `shared` **594.7 ms** vs `perframe_fifo` **3426.2 ms** =
> **5.76×**, 6 rows, 0 VOID, same sign in all three repeats, every gate passing and the path
> stable start to end (28–29.8 → 27.9–29.5 ms RTT). The absolute per-frame penalty — which is
> what the mechanism actually predicts — is **2831.5 ms against netsim's 2786.8 ms, 1.6 %
> apart**. Realisation noise on `shared` is **1.11×** here against 4.32× at 64 KB, which is
> why this cell could resolve what X3 could not.
>
> Data and deviations: [`measurements/r6/x3l-results.md`](measurements/r6/x3l-results.md).
> Pre-registered null, committed before calibration:
> [`measurements/r6/x3l-prereg.md`](measurements/r6/x3l-prereg.md). Reading:
> `transport-conclusions.md` §2.6a.
>
> **The stream-shape recommendation is no longer a simulator result.** §2.7 has
> landed: the binary defaults to `shared` as of 2026-09-08. `main` still defaults
> to `per-frame`.

**Run card: [`measurements/r6/x3l-run-card.md`](measurements/r6/x3l-run-card.md)** — written
2026-09-07 after an audit found three ways this run fails *silently*. The worst: `FIXTURE`
is uploaded once per invocation, so `CELLS="X3L"` alone ran X3L's step-scale against the
**64 KB** fixture and emitted nine admissible-looking rows with the one variable X3L exists
to change left unchanged. `r6_campaign.sh` stated the requirement in a comment;
`r6_campaign_cloud.sh` did not state it at all. Now enforced by
`lab/scripts/r6_cell_inputs.sh`. `SCALE_X3L` also had a default of 16 — netsim's 32 halved
by a rule of thumb measured at 64 KB — which is now removed, so the run cannot start on an
inherited operating point. **Removing it was load-bearing:** the rig calibration landed on
**32**, and 16 would have run a cell delivering 463 of 655 frames while looking admissible.
The halving rule was measured with GSO on, and GSO-off halves the achievable rate.

Three other things came back, and two of them change how future runs must be done:

- **`sch_netem` draws loss once per GSO batch, not per datagram**, and the batch size
  **differs by arm** — reported as 6.87 datagrams for `shared` against ~4.3 for per-frame,
  so the shared arm absorbs ~1.5× fewer congestion events at equal bytes. **Those per-arm
  numbers have no committed data file** (`r6cloud_gso_batch.tsv` is keyed by segment cap, not
  by arm); the rule stands on the measured GSO-on/off difference, 3.37 vs 0.99 datagrams per
  batch. Adversarial review, 2026-09-07 (D3). Any netem loss experiment
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

### 4.0 · Port onto `main`'s `pipeline.rs` — **landed on PR #20, 2026-09-09**

Applied on `cursor/port-onto-main-d27c`. The plan and the three silent regressions are in
[`merge-with-main-analysis.md`](merge-with-main-analysis.md). What actually landed:

1. **`main`'s structure, this branch's behaviour.** `serve_one` is still
   `prepare → locate → send`. `locate` returns `Bytes` (a view of the mapping); `FrameOut`
   dispatches `chunked` / lab `copy` / lab `split` through the assemblers.
2. **The three silent regressions were avoided.** One flag per quinn setting (`--send-window-bytes`
   aliases `--send-window`; `--stream-receive-window-bytes` aliases `--stream-receive-window`);
   `--max-idle-timeout-ms` is applied on the wtransport builder; `StreamMode` is `main`'s
   module, default `shared`.
3. **Proposal §7** (reap the per-frame ack `JoinSet` as tasks complete) is folded in.
   §2 / §3 / §6 / §8 were not.

**Still owed:** `lab/scripts/stall_client_campaign.sh` on the merged tree (~200 kB/connection
on `chunked`; megabytes means the copy is back). The unit tests cannot see that failure.
`frame_bytes_is_a_view_of_the_mapping` is the cheap fast-fail beside it. Do not merge #20
or #5 onto `main` until that campaign has been run, or the user accepts the unit-test gate
alone.

### 4.1 · Deploy the loss-regime sampler — highest value, smallest change

Settles the biggest open decision (Cubic vs BBR, ~50 % either way). Everything is built and
validated; it needs **deployment, not development**.

> **Do not deploy a build older than 2026-09-07.** The sampler emitted each row as two
> `write` calls onto one append-mode file, so above one connection the rows interleaved and
> the classifier dropped the damage silently — measured at **29 % of rows surviving at 32
> connections**. Fixed (one write per row, a `dropped_since_last` counter in the data, a
> concurrency regression test, and a classifier that refuses a log missing more than 2 %).
> Nothing already concluded is affected, because the sampler had never been run at scale.
> When you do deploy, **check the first log**: `dropped_since_last` should be 0 throughout
> and the classifier's header should report zero unreadable lines.

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

### 4.4a · Fallout from the 2026-09-07 adversarial review

An external review of this branch traced ~40 quantitative claims to the committed TSVs
through the committed analysers; all but a handful reproduce. What it found instead was
paperwork, and the items below are what survived independent re-verification here.

**Already fixed on this branch:**

- `l4_analyse.py` kept VOID rows inside its comparison groups, never printed `n`, and scored
  a different column from the one the documents quote. All three fixed; it now excludes and
  lists void rows, prints `n` per arm, reports both columns, and implements stop condition 4
  as a **declared** two-sided check (`--congestive`), because applying it literally would
  void the entire congestive campaign, where queue drops at 0 % injected loss *are* the
  regime.
- `r6_cell_inputs.sh` was one-directional and let an ordinary cell ride a special
  fixture/trace. Now bidirectional.
- The congestive n = 2, the `n = 3` global claim, and the GSO confidence row are corrected
  in `transport-conclusions.md`. The stream-mode gap is recorded as §2.7.

**Every finding, and where it stands.** The review was an artifact, not a repo document, so
its register is transcribed here — all 25 IDs, so nothing survives only in a link. Severity is
the reviewer's.

| ID | sev | finding | status |
| --- | --- | --- | --- |
| G1 | blocking | PR unmergeable: 11 conflicts, `server.rs` rewritten by `main`, stale description | **analysed, not landed** — [`merge-with-main-analysis.md`](merge-with-main-analysis.md). Deliberate: the merge is not this session's to do |
| D1 | material | Congestive 600 ms: BBR n = 2, undisclosed, on a column the analyser voids | **disclosed, probably permanent** — the L4 rig was an ephemeral sandbox (item 1 below) |
| G2 | material | Product default is per-frame; the answer sheet says shared | **fixed** — X3L fired §2.7's rule; default is now `shared` |
| P1 | material | Sampler writes two syscalls per JSONL row; rows interleave | **fixed** — one write, drop counter, regression test |
| D2 | material | GSO +17 %/−21 % quoted without the real-hardware null | **fixed** — §3 and §2 now carry the null |
| S1 | material | `l4_analyse.py` averages its own VOID rows; stop condition 4 absent | **fixed** — excludes and lists VOID, prints `n`, both columns, `--congestive` |
| S2 | material | Fairness: TCP and QUIC timed over different windows | **open** — needs the harness to emit its measured fill span, [`proposals`](proposals/product-code-changes.md) §2 |
| S3 | minor | Cell-input guard checks one direction only | **fixed** bidirectionally. **Second half open:** `ARMS` still accepts arbitrary per-arm flags and no column records them, so a row cannot prove which flags produced it |
| S4 | minor | `vals[n//2]` is not a median; N0 campaign-void rule unenforced | **fixed** — `st.median`, `CONTROL_EXEMPT`, campaign exits 2 |
| S5 | minor | Memory r² fitted over five means; peak-of-20 is a max statistic; two campaigns ran different binaries | **binary disclosed. Open:** the r²-over-means and peak-of-20 caveats are not written into `mem/README.md` |
| S6 | note | Black-hole count never applied; rig data unseeded but paired by run | **fixed, and one half inverted** — applying the exclusion as documented would have voided the project's own congestive validation cell (42 black holes). quinn increments it from PLPMTUD. The claim was withdrawn, not implemented |
| P2 | minor | `WT_SERVE_TIMING` read per frame on the measured path | **fixed** — `OnceLock`, and absent entirely from a product build |
| P3 | minor | Hand-built socket omits `set_only_v6(false)` | **moot** — the socket existed only for `--socket-*-buffer`, which nothing used; both are deleted |
| H1 | minor | Open-loop want time stamped after ask emission | **open** — [`proposals`](proposals/product-code-changes.md) §3 |
| H2 | minor | `asks_sent == requested` cannot establish server commitment | **fixed** — the gate is worded down to what it proves |
| D3 | minor | Per-arm GSO batch figures have no data file | **open** — the caveat is in §2.6; the rows are still uncommitted |
| D4 | minor | "No repeat favours per-frame" is false for the fair arm | **fixed** — and it is larger than reported: 8 of 12 real-path paired comparisons favour per-frame at 64 KB |
| P4 | note | Chunked path may re-fault pages inside the connection driver | **open, an investigation** — [`proposals`](proposals/product-code-changes.md) §8 |
| P5 | note | Sampler keeps emitting rows after the session loop ends | **open** — rows with a zero sent-packet delta *should* be neutral to the classifier; unconfirmed |
| P6 | note | Crypto features are not mutually exclusive | **open** — [`proposals`](proposals/product-code-changes.md) §6 |
| P7 | note | Per-frame retains one finished ack task per frame | **open** — a confound in this branch's own per-frame memory figure, [`proposals`](proposals/product-code-changes.md) §7 |
| H3 | note | The measured stall client keep-alives; a silent one is reaped at 30 s | **fixed** — §3.1 and `stall.rs` say which client this is |
| D5 | note | Small drifts: stranding, "within 1 %", "may not modify server/", PR status, stale key doc | **all five fixed** — the last two (`1.2 %`, `cloud-rig-access.md`'s key fallback) closed 2026-09-08 |
| D6 | note | Serve-timing log has a 576-byte NUL hole | **fixed** — the truncate now precedes `deploy_s`, which restarts the server |
| G3 | note | Rig key rotation left as a to-do in a public repo | **fixed** — rotated at `bebf358`, denial proven, backups deleted |
| G4 | note | Clippy warnings; dead `parse_length_prefixed` | **fixed** — 21 → 3, and the 3 are in files this branch never touched |

**Nine remain open.** Five code proposals
([`proposals/product-code-changes.md`](proposals/product-code-changes.md) §2, §3, §6, §7, §8)
plus P5; three recording gaps — S3's `ARMS` column, S5's two statistical caveats, D3's
per-arm GSO rows (the committed `r6cloud_gso_batch.tsv` is keyed by segment cap, not arm).
None of them moves a published number in a direction the documents do not already admit.

**The one that cannot be closed here, in priority order:**

1. **Re-run BBR run 2 in the congestive 600 ms cell.** One run. It must be on the rig that
   produced runs 1 and 3 — a replacement on different hardware is not comparable, which is
   why it was not done from the cloud session that found it.

   > **2026-09-07: checked, and the local workstation is NOT that rig.** Establishing this
   > cost twenty minutes, so it is recorded rather than left for the next session to redo.
   > The branch first reached this machine at `2026-09-06 18:09 -0300`, about 15 h *after*
   > `6640ff4` committed `r5a_congestive.tsv` at `2026-09-06 05:43 +0000`; the reflog has no
   > entry creating that commit locally, so it arrived by fetch. The R-series commits are
   > timestamped `+0000` while this host is `-0300`. (An author rewrite later set those
   > commits to `dary-dc`; authorship is no longer a distinguishing signal.) And
   > `measurements/l4/README.md` records the L4 rig as a kernel *without* `sch_netem`,
   > where this one has it.
   >
   > **This may not be satisfiable at all.** `lanes/L4-preregistration.md` §5.5 justifies
   > interleaving with *"this host has already been replaced twice mid-session"* — the L4
   > rig was an ephemeral agent sandbox, so the machine that produced runs 1 and 3 probably
   > no longer exists. If so the choice is not "one run" but: re-run the **whole** Sc cell,
   > all arms, n = 3, in one sitting on one machine — or leave the n = 2 disclosure
   > standing, which is honest and already written. Nobody should quietly append a fourth
   > row from a fourth machine.

### 4.5 · Cheap and unattended

- ~~**More repeats on X1** (n = 10)~~ — **done 2026-09-07, and the answer is no.** X1 is
  still a tie at n = 10 under the pre-registered rule, because the obstacle was never the
  repeat count: `shared`'s own spread across loss realisations is **5.09×** against a
  median arm difference of **4.1 %**, and min/max non-overlap cannot resolve that at any n.
  The paired view (8/10, +8.8 % ± 13.2 %, p = 0.109, would need n ≈ 18) is reported in
  [`measurements/r6/x1-n10.md`](measurements/r6/x1-n10.md) and **explicitly refused as
  evidence**, because adopting a more powerful statistic after the blunt one returned a tie
  is §5's own failure mode. **Recommendation: stop working on X1** — X3 carries the same
  finding with a +220 % paired effect at n = 3, and 8.8 % at 0.1 % loss moves no decision.
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

## 5 · Traps

### Five instances of one failure: a guard checked once and assumed to hold

Every invalidated campaign in this project was this, in a new costume:

1. **L4** — the path was never congested, so every loss was exogenous
2. **L4** — p95 computed over cache-hit structural zeros
3. **L4** — the queue *arithmetically could not drop* at the chosen depth
4. **L1 + R6** — the reader could not fall behind, so head-of-line blocking could not occur
5. **R6** — the operating point was calibrated on one seed, then voided 4 of 9 rows

L1's own review named it independently: *"v2 retuned the workload until the metric's
admission rule passed; Phase C retuned the admission rule until the workload passed."*

### And a sixth, which is a different failure

6. **2026-09-08** — an audit counted flag usage by grepping `lab/scripts/` and `server/src/`,
   found five flags and `SendPath::Split` unreferenced, and deleted them. **Arms are not
   invoked from inside the scripts.** They arrive through `SRV_FLAGS`, and the command lines
   that supply them live in `quic-transport-optimization.md` §5 and `lab/README.md`. `split`
   had three committed TSVs the whole time. Caught before it was pushed, restored behind
   `--features lab`.

   The practice this adds: **a usage count is only as wide as the places you looked.** In
   this repository, invocations are documentation. Grep the docs too, or grep the TSVs for
   the arm label.

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
| [`why-these-changes.md`](why-these-changes.md) | **why each decision on this branch exists** — seventeen entries, one per decision, and the place rationale belongs instead of in source comments |
| [`code-style-and-comments.md`](code-style-and-comments.md) | what the code says and what the register says; the measured comment-to-code ratios that prompted it |
| [`proposals/product-code-changes.md`](proposals/product-code-changes.md) | nine proposed code changes. **Four applied 2026-09-08** (1, 4, 5, 9), each marked with what landed and what re-measurement it still owes; five remain proposals |
| [`merge-with-main-analysis.md`](merge-with-main-analysis.md) | what actually collides with `main`, why it is a port rather than an adjudication, the acceptance gate, and three silent regressions a naive merge introduces |
| [`branch-source-audit.md`](branch-source-audit.md) | **what this branch put in `server/` and what belongs there** — every flag and send path classified with its usage evidence, and the correction that came of auditing prose-invoked arms by grepping code |
| [`measurements/r6/step-scale-calibration.md`](measurements/r6/step-scale-calibration.md) | every cell's operating point, the admissible band, and the multi-seed guard |
| [`measurements/r6/fairness-instrument.md`](measurements/r6/fairness-instrument.md) | what the Oracle rig's two open ports let the fairness experiment pose, the four traps, and the known denominator bias |

### Key scripts

| script | purpose |
| ------ | ------- |
| `lab/scripts/cloud_preflight.sh` | **run first** on any rig work; fails fast if the environment cannot reach it |
| `lab/scripts/e0_r6_reader_validate.sh` | proves the rig can produce head-of-line blocking |
| `lab/scripts/e0_r6_calibrate.sh` | finds the admissible operating point; takes `SEED=` |
| `lab/scripts/e0_r6_calibrate_cloud.sh` | the rig variant; takes `REPS=` for E0-R6c and **`SRV_EXTRA=`**, so the operating point is calibrated in the condition the campaign actually runs |
| `lab/scripts/e0_regime_validate.sh` | proves the loss-regime classifier on known ground truth |
| `lab/scripts/r6_campaign.sh` | the stream-shape campaign |
| `lab/scripts/r6_analyse.py` | applies the pre-registered decision rules |
| `lab/scripts/mem_per_connection.sh` | memory per viewer; takes `READ_BPS=` for the stress case |
| `lab/scripts/classify_loss_regime.py` | offline regime classification |
| `lab/scripts/r6_cell_inputs.sh` | refuses a campaign whose cells and fixture/trace disagree — X3L and X3S are *defined* by varying those |
| `lab/scripts/e0_stall_validate.sh` | proves `--mode stall` really stops reading; gates the campaign below |
| `lab/scripts/stall_client_campaign.sh` | the pathological-client campaign; samples **both** ends |
| `lab/scripts/stall_analyse.py` | per-connection slopes, server and client |
| `lab/scripts/stall_send_path_probe.sh` | rules out the chunked-send-path/`RssAnon` confound |
| `lab/scripts/stall_wide_window_probe.sh` | the hostile variant: client widens its own window first |

---

## 8 · Housekeeping

- ~~**Rotate the Oracle rig SSH key.**~~ **Done 2026-09-07.** The exposed cloud-agent key
  `SHA256:CAD0bvPh…` is replaced by `SHA256:qz/LiOLq…`, installed and verified before the old
  one was removed, denial proven on `ubuntu`, and the `authorized_keys.bak.*` copies deleted
  so it does not linger beside the live file. `root` and `opc` were re-checked and are still
  empty. Record and scope: `cloud-rig-access.md`.
- **Large fixtures are gitignored** (`frames_500x64k`, `frames_500x250k`). Regeneration
  recipes are in each fixture's README.
- **The `telemetry` feature is off by default.** The lab-arms binaries are built without it,
  which is why the sampler sat unexercised until `e0_regime_validate.sh` ran it.
- **The `lab` feature is off by default too, and every experiment arm is behind it** —
  `--send-path`, `--send-fairness`, `--segmentation-offload`, `--ask-priority`, the MTU / ACK
  / socket-buffer knobs, `WT_SERVE_TIMING`. Lab scripts already pass
  `--features lab`; a bare `cargo build` produces a server that cannot select an arm by
  accident. If a campaign suddenly reports "unexpected argument", that is the cause.
