# Proposed code changes — for review, not applied

**2026-09-07, updated 2026-09-08, §7 applied 2026-09-09 with the port.** Items **1, 4, 5, 7 and 9 have since been applied** — each is
marked below with what actually landed, and none was applied by this document. Everything
still marked *proposed* is a proposal. **No code in `server/` or
`lab/window-harness/` was changed to produce this document**, and none should be until each
item below is agreed. Analysis tooling under `lab/scripts/` and the documentation were
fixed directly, because a wrong analyser silently corrupts results while a wrong proposal
merely wastes a review.

Sources: the adversarial review of 2026-09-07 (IDs `P*`, `H*`, `S*`, `G*`), and the
decision rule in [`../transport-conclusions.md`](../transport-conclusions.md) §2.7.

Each item states **what is true now**, **what to change**, **why it is worth doing**, and
**how you would know it worked**. Ordered by consequence, not by effort.

---

## 1 · Flip the default stream mode to `shared` — **APPLIED 2026-09-08**

**Now.** `server/src/main.rs:19` defaults `--stream-mode` to `PerFrame`. `main` has the
identical default, so this branch regressed nothing; it never landed its own conclusion.

**Change.** `default_value_t = StreamMode::Shared`.

**Why.** §2.7 pre-registered the condition rather than leaving it to judgement: *if X3L
separates in `shared`'s favour with the stranding gate passing, flip the default.* X3L has
now run on the real path and separated — **594.7 ms against 3426.2 ms, +476 %, 3/3, with
stranding non-zero in both arms (46 and 72)**. The ranges are not close: `shared`'s worst
repeat is 653 ms, per-frame's best is 3288 ms.

The condition is met. This is the one item here whose justification is already written down
and already satisfied; it is a proposal only because changing a shipped default is not
something to do inside a documentation pass.

**Landed.** Commit `cce4019`, on its own so a reviewer can read the whole argument in one
`git show`. `all_send_paths_are_the_same_wire` passes. The grep found seven legacy scripts
reading the old default rather than naming it; each now passes `--stream-mode per-frame`, so
no committed measurement changes meaning.

---

## 2 · Emit the harness's measured fill window (`H`/`S2`)

**Now.** `MetricsState::start_fill` records `fill_started_at`; `stop_fill` records nothing,
and the JSON reports only the *configured* `fill_dwell_ms`. So `r6_fairness_cloud.sh`
divides QUIC bytes by a configured window while timing TCP over a measured one, and QUIC
runs unopposed at both ends of its own denominator.

**Change.** Record the stop instant and emit `fill_elapsed_ms` beside `fill_dwell_ms`. Then
`r6_fairness_cloud.sh` can divide both flows by the same measured span.

**Why.** It is the difference between "QUIC-with-Cubic takes 70–77 %" and a number that is
a few points lower. The 99.4 % BBR starvation figure is far too large to be manufactured
this way and is unaffected — but the modest figure beside it is the one a reader will use
to argue that Cubic is also unfair, and it should be right.

**Verify.** `fill_elapsed_ms` within a few ms of `fill_dwell_ms` on an unshaped run; the
two fairness denominators equal in a new TSV row.

---

## 3 · Stamp the open-loop want time at the scheduled step (`H1`)

**Now.** `run_reader_open_loop` wakes at the absolute deadline, emits the ask window, and
*then* stamps `wanted_at = Instant::now()` (`client.rs:623`). The pre-registered quantity is
time from *reader wants* to displayable, and the reader wants at the deadline.

**Change.** `wanted_at = step_loop_start + step_interval * i`, matching what the closed-loop
reader already does (`client.rs:469`).

**Why.** Two things, neither large but both structural. The gap is ask-emission time, so an
arm whose control-stream writes stall longer has that time *forgiven* — asymmetric in
exactly the direction that flatters a struggling arm. And a frame arriving during emission
is currently scored as a 0 ms cache hit rather than its true small wait. Today the two
reader modes define "wait" from different origins, which is not a thing a measurement
harness should do.

**Verify.** Re-run one committed cell; p95 should move by microseconds, not milliseconds. If
it moves more, that itself is the finding.

---

## 4 · Read `WT_SERVE_TIMING` once, not per frame (`P2`) — **APPLIED 2026-09-08**

**Now.** `send_one_frame` (`server.rs:314`) calls `std::env::var_os` on every frame, taking
the process environment lock and scanning it, plus two `Instant::now()` reads.

**Change.** Read it once in `run_server`; pass a `bool`.

**Why.** The branch's own rule is that an arm changing nothing must measure nothing. This is
a small non-zero cost on the measured path, paid by every arm — so it does not bias a
comparison, but it sits inside CPU-per-byte figures that are quoted to a tenth of a percent.
Cheap to remove, and removing it makes the comment above `note_serve_timing` true.

**Landed.** A `OnceLock` in `serve_timing_enabled()`, and the whole mechanism is behind
`--features lab`, so a product build does not read the variable at all. **The re-measurement
in the original Verify line is still owed:** `cpu_s_per_gb` on an interleaved send-path run,
before and after. The change can only make the number smaller, but "can only" is not a
measurement.

---

## 5 · Make the hand-built socket dual-stack explicitly (`P3`) — **APPLIED 2026-09-08**

**Now.** `bind_socket` (`server.rs:130`) binds `[::]:port` and never calls
`set_only_v6(false)`. wtransport's own `with_bind_default` sets it (`config.rs:1186`).

**Change.** Call `set_only_v6(false)` on the hand-built socket.

**Why.** On a host with `net.ipv6.bindv6only=1`, the `--socket-send-buffer` and
`--socket-recv-buffer` arms become IPv6-only while their control stays dual-stack — an arm
that claims one variable moving two. Latent on stock Linux, which is why it has not bitten;
that is an argument for fixing it cheaply now rather than after a confusing result.

**Landed.** `set_only_v6(false)` on the IPv6 socket, which is what wtransport's own bind
does. The socket itself is now behind `--features lab`, since it exists only for the
`--socket-*-buffer` arms. **Verify still owed:** `ss -lun` showing v4-mapped acceptance, and
a socket-buffer arm connecting from an IPv4 client.

---

## 6 · Make the crypto features mutually exclusive (`P6`)

**Now.** `cargo build --features crypto-aws-lc-rs` without `--no-default-features` enables
both providers. `install_crypto_provider` silently picks aws-lc-rs while its comment claims
"exactly one is ever enabled".

**Change.** `compile_error!` when both are on.

**Why.** The comment is currently false, and the failure is silent — a benchmark comparing
providers could measure the same one twice and show a satisfying 0 % difference.

**Verify.** Enabling both fails the build with a message naming the fix.

---

## 7 · Drain the per-frame ack `JoinSet` as it completes (`P7`, pre-existing) — **APPLIED 2026-09-09 with the port**

**Now.** The `acks` `JoinSet` is reaped with `try_join_next` after each per-frame spawn
(`frame_out.rs`); the 2 s `drain_acks` at session end remains. **Verify still owed:**
re-run the stalled-client campaign per-frame arm on the merged tree.

**Change.** Reap completed tasks as they finish.

**Why.** It is a confound in this branch's own numbers, not just an inefficiency:
[`../measurements/mem/stall-client.md`](../measurements/mem/stall-client.md) §4 attributes
"per-frame costs 2.05× shared" to flow-control windows, and up to ~100 retained cells sit in
that slope too. Fixing it makes the attribution honest; measuring before and after quantifies
what the windows actually contribute.

**Verify.** Re-run the stalled-client campaign per-frame arm. The 370 kB/connection figure
should fall by the retained-cell share, and §4's attribution can then be stated exactly.

---

## 8 · Record whether the chunked path re-faults on retransmit (`P4`, investigation)

**Now.** On the copy path quinn's send buffer held a private heap copy, so nothing after
`wrap()` touched file-backed memory. On the chunked path it holds `Bytes` slices of the
mapping, so every packet assembly — including a retransmit seconds later — reads the mapping
**inside the connection driver**. `touch_frame_pages` guarantees residency only at the moment
it returns.

**Change.** None yet. This is a measurement, not a fix: under memory pressure a reclaimed
page now major-faults on the executor, which is exactly what `prefault` exists to prevent.

**Why.** The chunked path is a branch default and the memory campaigns all ran with a warm
cache, so the case is unmeasured rather than ruled out. If it is real, it is a genuine cost
sitting against the −6…−14 % CPU/byte the path was adopted for.

**Verify.** `lab/cold-page-bench` under deliberate pressure, chunked against copy, watching
major faults on the driver thread. Belongs in the assumption audit either way.

---

## 9 · Clippy: 21 warnings, 5 in the server (`G4`) — **APPLIED 2026-09-08**

`cargo clippy --workspace --all-targets` reports 21, of which the server's five are: one
function with 8 arguments, three unit-value let-bindings, and one loop that should be
`while let`. `lab/window-harness` carries the dead `parse_length_prefixed`.

**Change.** Clear them. Three are auto-fixable (`cargo clippy --fix`).

**Why.** Not style for its own sake: the 8-argument function is `send_one_frame`, which is
also the one item 4 touches and the one the merge with `main` has to re-express as
`Pipeline::send`. Clippy is pointing at the same place the architecture is.

**Landed.** 21 → 3. The 8-argument `send_one_frame` lost three arguments to a `Serving`
struct — the shape `main`'s `Pipeline` carries, so the port inherits it. The three that
remain are in `client/flight-registry`, `client/transport-wasm` and
`server/src/transport/wire.rs`; **this branch never touched any of those files**, and `main`
has already rewritten `read_fod_msg`, which is what the server warning is about. Fixing them
here would manufacture a merge conflict to silence a style lint.

---

## Deliberately not proposed

- **Rewriting the send paths before the merge.** `main` has extracted serving into
  `pipeline.rs` with a `prepare → locate → send` seam, and this branch's send paths *are* an
  implementation of `send`. Restructuring them here means doing it twice. See
  [`../merge-with-main-analysis.md`](../merge-with-main-analysis.md).
- **Anything that changes measured behaviour without a campaign to re-run.** Items 4, 5 and 7
  each move a number this branch has published; none should land without the re-measurement
  named in its Verify line.
