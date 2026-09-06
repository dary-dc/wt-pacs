# Server telemetry and serving path — analysis pass

**2026-09-06** · **Status: analysis complete; Decision C settled below; implementation not started.**
Settles Decision C of [`telemetry-seam-decision-brief.md`](telemetry-seam-decision-brief.md) and
supersedes the seam section of [`server-frame-pipeline-telemetry-plan.md`](server-frame-pipeline-telemetry-plan.md).
Companion to [`client-frame-pipeline-telemetry-plan.md`](client-frame-pipeline-telemetry-plan.md);
the client seam (ADR option G) is accepted and not revisited here.

**Product direction recorded 2026-09-06**

1. Scale target is **both** axes: thousands of concurrent viewers on one server, and multi-gigabyte studies.
2. Improve telemetry and the production server where the two do not conflict. **The production path
   cannot know about telemetry** — no code, symbols, or report string literals in the default build.
3. Output must stay **exact**: stream rows, do not sample rows away. Summaries may be approximate if
   they say so and the rows allow exact recomputation.

**Scope.** `server/` only. Disk reading, mmap residency, decoders, and the wire are owned by other
investigations and are not touched here (see §7). Numbers in this document are **T2-local**
(4 vCPU VM, localhost, unshaped) and are quotable only as *relative* comparisons between arms
measured the same way.

---

## 0 · Summary

The server Tap is correct and tested, but it was built for one lab session at a time. Read for
thousands of sessions it has four scaling defects and one schema mismatch, and it discards the one
delivery signal the server can observe without a client clock. The measurements in §5 put numbers on
the defects that have numbers: the process-wide lock costs **microseconds per frame under contention**
instead of nanoseconds; a per-row channel send costs the emitting thread **tens of microseconds** on
this VM because every row wakes the drain thread; and the in-memory drain needs hundreds of megabytes
and multi-second exits at ten million rows where a streamed row file is flat.

**Decision C = C3, evolved from today's `Recorder`, not rewritten.** Domain events at ask / located /
first byte / last byte / refused / acked; clocks inside the recorder; per-session batching with an
owned sender; exact fixed-width rows streamed to disk; log-linear histograms for the summary,
rewritten on a timer; exact offline report from the row file. The default build keeps a zero-sized
recorder and the absence check. A `tracing`-based seam (C4) is viable and is recorded as the upgrade
path if production observability is ever wanted; it is not chosen now (§4).

The serving path itself scales per session (one task, natural QUIC backpressure) and has two
process-wide ceilings that telemetry must measure before anyone changes code: the default **10 MB
send window per connection**, and the **single UDP socket / endpoint driver**. Two robustness gaps are
worth closing now without waiting: an **unbounded allocation from a wire-supplied length** in the FoD
reader, and transport knobs that are not exposed at all (§3).

---

## 1 · Decisions

### 1.1 Seam — Decision C

| Option | Verdict | One-line reason |
| --- | --- | --- |
| C1 keep inline `ask` / `located` / `wrote` | no | Different schema; clocks and `Stamp` type leak into the product loop |
| C2 wrap `write_all` / `frame_slice` like the browser Proxy | no | `RequestFrames` is one message and *N* sends; a wrapper cannot recover the frame index |
| **C3 domain events, zero-sized subscriber** | **yes** | Same absence proof as today, readable loop, per-session state where it belongs |
| C4 `tracing` events + custom `Layer` | later | Right seam if production observability arrives; costlier per event and weaker absence proof today (§4.1) |
| C5 external (uprobes / eBPF) | no | Needs root and symbols, cannot see the frame index, does not run where the rig runs (§4.2) |

### 1.2 Stage contract (server)

| Stage | Interval | Shared mode | Per-frame mode | Replaces |
| --- | --- | --- | --- | --- |
| `locate_us` | ask → frame bytes found | yes | yes | `server_work_us` |
| `serve_us` | ask → length prefix accepted by the send buffer | yes | yes | (part of `server_serve_us`) |
| `send_us` | length prefix → last payload byte accepted by the send buffer | yes | yes | `server_write_us` (which also included the envelope copy and the stream open) |
| `ack_us` | last byte → peer acknowledged all bytes of the stream | **null** | yes | — (new; the `finish().await` the loop already runs) |

Definitions that matter:

- **firstByte** is stamped when the length-prefix `write_all` **returns**, not when it is called. A
  flow-control stall before any byte lands therefore counts as serve time, which is where the client's
  `serve_plus_path` also puts it. In per-frame mode the `open_uni` wait lands in `serve_us` too.
- **`send_us` under congestion measures the flow-control stall.** That is the signal, not a defect.
- **`ack_us`** is real: in the pinned `quinn 0.11.11`, `SendStream::stopped()` resolves `Ok(None)` only
  after the peer acknowledges receipt of all stream data, and `wtransport 0.7.2` `finish()` is a
  thin wrapper that maps that to `Ok(())`. Peer ACK delay applies (quinn's own doc says so), so it
  is *delivery to the peer's transport*, not to the application. It exists only in per-frame mode
  and is exported `null` in shared mode. **It must not be used to argue the open stream-mode
  question**, which is about loss and head-of-line blocking, not observability.
- **`ask_at_us`** (new row field): ask time as an offset from process start. Enables concurrency,
  utilisation, and idle-gap analysis offline without a join. Still a fixed-width duration field.
- **Session row** (new, one per session at close): session id, stream mode, frames, bytes, refusals,
  drops, open / close offsets.
- **Integrity block** in the summary: rows written, rows dropped, drop sessions, acks unmatched,
  ring capacity, batch size, percentile method, schema version.

Null ≠ 0 holds. Percentiles are nearest-rank on both sides; above the exact-row cap the server
summary says `percentile_method: "histogram-loglinear-1024"` and the row file allows exact
recomputation (§2.3).

### 1.3 Pipeline shape

```text
session task (hot path)                  drain thread (telemetry build only)
──────────────────────                   ──────────────────────────────────
rec.ask(idx)      ─┐                     ┌─ append batch to  telemetry-server.rows   (fixed-width)
rec.located(..)    │ push Row into        │  fold into histograms (4 × 188 KB)
rec.first_byte()   │ per-session batch ──►│  every N s: rewrite telemetry-server.json (summary only)
rec.last_byte(..) ─┘ (one channel op      │  on disconnect: final summary + integrity
token.acked()  ◄── JoinSet task   per 64)  └─ never blocks a producer; drops are counted per session
```

Offline: `exact-server --telemetry-report <rows>` (feature-gated) rebuilds the full
`summary → server_frames → run_end` JSON with exact nearest-rank percentiles from the row file.

### 1.4 Output policy at scale

| Property | Choice |
| --- | --- |
| Rows | always exact, always on disk, fixed-width, appended per batch |
| Summary during the run | histograms, rewritten on a timer, exact counts / totals, percentiles within 0.1 % |
| Summary at exit | same, plus integrity |
| Exact percentiles | offline from the row file; inline only when rows ≤ cap (default 1 M) |
| Drops | never block; counted per session and in integrity; a run over a drop threshold is void |
| Sampling | optional `WTPACS_TELEMETRY_SAMPLE=K`: 1 in K **sessions** get a Tap, the rest cost one branch per frame. Rows inside a sampled session stay complete |
| Kill safety | rows survive up to the last unflushed batch; the timer summary survives |

---

## 2 · The current pipeline, read for scale

References are to this branch at the commit that adds this document.

| # | Finding | Where | Consequence at thousands of sessions |
| --- | --- | --- | --- |
| F1 | One process-wide `Mutex<Option<SyncSender>>` locked on **every row** | `server/src/record/tap.rs:104` | Global serialisation point on the serving path; §5.1 measures µs per emit under contention |
| F2 | One channel send per row wakes the drain thread per row | `tap.rs:84`–`118` (`try_emit`) | Tens of µs of wall time on the emitting tokio worker per frame (§5.1 paced runs) |
| F3 | One 4096-row ring for the whole process | `tap.rs:16` | Fills under many sessions; the rows lost are the slow tail |
| F4 | Every row retained in memory until exit; four `Vec<u32>` sorted at exit | `tap.rs:206`, `tap.rs:333` | Memory grows with sessions × frames; exit takes seconds at 10 M rows (§5.2) |
| F5 | Report written only when the **last** Tap drops | `tap.rs:148` | Overlapping sessions never reach zero; a kill loses everything |
| F6 | `server_write_us` spans envelope copy + stream open + both writes | `server/src/transport/server.rs:227`–`230` | Not first byte → last byte; mixes copy, setup, and send-buffer fill |
| F7 | The `finish().await` result is discarded | `server.rs:286`–`288` | The only server-observable delivery signal is thrown away |
| F8 | Schema differs from the client contract | `tap.rs:24`–`36` vs `client/transport-ts/record/types.ts` | Two vocabularies; the plan already wants `serve_us` / `send_us` |

Secondary: `rec.stamp()` and the `Stamp = ()` alias put clock handling in product signatures
(`server.rs:222`, `227`, `248`); `run_server` carries a second `cfg` fork for the startup banner
(`server.rs:88`–`91`); the absence script greps a field name that will be renamed
(`server/scripts/check_telemetry_absent.sh`).

What is **right** and stays: `try_send` never blocks; rows are fixed-width `Copy`; ordinals per
frame index; nearest-rank percentiles; the `recorder_is_zero_sized` test; the absence script; the
feature-gated `tap` module; env-gated activation per session.

---

## 3 · The serving path, read for thousands of users and multi-gigabyte studies

Per-session structure is sound: one tokio task per connection, a serial ask loop, and QUIC flow
control as the only backpressure. Nothing here needs a redesign. The items below are ceilings and
gaps, with what telemetry must show before anyone changes them.

| # | Item | Where | Assessment | Action |
| --- | --- | --- | --- | --- |
| S1 | **Send buffer per connection**: default `send_window` = 8 × 1.25 MB = **10 MB** unacked data per connection | `quinn-proto` `TransportConfig::default`, used unchanged by `wtransport` `ServerConfig::builder` | 1 000 slow clients can pin **10 GB**; 1 000 fast clients pin roughly one frame each | Expose `send_window`, `stream_receive_window`, `max_idle_timeout` on `ServeConfig` (flags, **defaults unchanged**); measure RSS vs *N* throttled sessions (§5.4 P4); pick a production value from link BDP later |
| S2 | **Single UDP socket / endpoint driver**: one receive path for all connections | `Endpoint::server` → one `quinn` endpoint | Receive-side packet processing is one core; `quinn` scales with several endpoints on `SO_REUSEPORT` sockets (`with_bind_socket`) | **T1, unmeasured.** Measure aggregate Mbit/s vs *N* until one thread saturates before touching it |
| S3 | **Unbounded allocation from a wire-supplied length** in the FoD reader | `server/src/transport/wire.rs:10`–`11` (`vec![0u8; len]`) | Any client can make the server allocate up to 4 GB per session | Cap (4 MiB is ample for a `RequestFrames` of ~700 k indices); refuse `len == 0`; unit test. **Hardening, not telemetry; separate commit** |
| S4 | `RequestFrames` serves *N* frames before reading the next control message | `server.rs:181`–`194` | Blind period up to *N* × Tf; bounded by S3 once capped | None now; `ask_at_us` gaps will show it |
| S5 | Blind period under congestion: `write_all` stalls, control stream unread | `server.rs:160`, `write_payload` | Per-session only; no cross-session effect | Deferred per `adr-frame-framing-and-loop-shape.md` §5; `send_us` measures it |
| S6 | Ack tasks accumulate per unfinished stream | `server.rs:286` | Bounded by the peer's uni-stream limit; `open_uni().await` then blocks the loop — natural backpressure | None; `ack_us` and `serve_us` expose it |
| S7 | Idle sessions: 30 s idle timeout, no server keep-alive | defaults | Thousands of idle viewers are reaped, which is right | Expose the timeout with S1 |
| S8 | Cold pages of a multi-GB mapping fault inside the envelope copy | `server.rs:228` (`wrap`) | Lands in `serve_us` as a tail correlated with cold frames | **Disk lane owns the fix.** Stage placement recorded so the number lands somewhere honest; add `envelope_us` only if the tail warrants |
| S9 | No admission control at accept | `server.rs:116`–`117` | Production concern | Out of scope; recorded |

Per-session memory arithmetic (per connection, worst case unless noted):

| Component | Bytes | Note |
| --- | --- | --- |
| Envelope copy (`wrap`) | one frame | transient, freed after `write_all`; see `send-path-copy-costs.md` |
| QUIC send buffer | up to `send_window` (10 MB default) | retained until acked; the number that scales badly |
| Unfinished per-frame streams | ≤ peer limit × stream state | per-frame mode only |
| Recorder (telemetry build, sampled session) | ~64 rows × 36 B + ordinal map | ≈ 3 KB |
| Recorder (default build) | 0 | zero-sized |

**Interaction with other lanes.** No change to the wire, `write_payload`'s two-write copy discipline,
stream-mode selection, or `FrameStore`. S1 knobs default to today's values so lane A's rig numbers are
not perturbed mid-grid. Everything else lands behind `feature = "telemetry"`.

---

## 4 · Alternatives to the separation architecture

The question asked: *is feature flag + zero-sized recorder + absence script the best way to keep
telemetry out of production, and what are its inconveniences?*

### 4.1 `tracing` events with a lab `Layer` (C4)

Mechanism: product code emits `trace!(frame = idx, "ask")` and friends; the default build enables
`tracing/release_max_level_info`, so `trace!` sites compile to nothing; the telemetry build raises the
static level and installs a `Layer` that folds events into per-session batches.

| Criterion | C3 (chosen) | C4 |
| --- | --- | --- |
| Hot-path cost when enabled | Vec push, ≈ 20–50 ns | global `Dispatch` + `enabled()` + field visitor, ≈ 100–300 ns per event, 5 events per frame |
| Per-session state (ordinals, batch) | lives in the per-session `Recorder` | must be found from the `Layer`: a map under a lock, or spans in async code (`Instrument`) — more product code, not less |
| Absence proof in default build | `size_of::<Recorder>() == 0` + symbol / literal scan, already in tree | static max level of a third-party crate, which unifies across the dependency graph; still needs the literal scan |
| Product signatures | one `Recorder` parameter | none — the cleanest surface of any option |
| Production observability later | forward from inside the Tap without touching product code | native: the same events feed OpenTelemetry |
| Frame index under batch asks | explicit `ask(idx)` | explicit `frame = idx` field — same |

Verdict: C4 is the upgrade path if production observability via `tracing` / OpenTelemetry is ever
wanted; today's rule is lab-only, and C3 is cheaper per event, keeps per-session state trivially,
and reuses an absence proof that already exists.

### 4.2 External instrumentation (uprobes / eBPF / `perf`)

The server analogue of the browser Proxy. Rejected: needs root and unstripped symbols (`#[inline(never)]`
anchors are product code in disguise), cannot recover the frame index without DWARF register reads,
and does not run inside the agent containers where lab work happens (`cloud-rig-access.md` exists
because `sch_netem` already needs a VM).

### 4.3 Inconveniences of the chosen architecture, and their mitigations

| Inconvenience | Mitigation |
| --- | --- |
| Two build variants; feature-gated code rots when nothing builds it | One gate script runs default tests, `--features telemetry` tests, the absence script, and a bench smoke. Wire it into whatever CI appears |
| `Stamp = ()` and `rec.stamp()` leak clocks into product signatures | C3 moves clocks inside; the alias is deleted |
| A second `cfg` fork in `run_server` for the banner | `Recorder::build_label()` — one fork at session start, one string at startup, both from the record module |
| The absence script greps names that change | Extend the list with `serve_us`, `send_us`, `ack_us`, `server_frames`, `schema`, `percentile_method` |
| The recorder parameter threads through `send_one_frame` | Accepted; it is one parameter and it is the readable form of the seam |
| Report depends on graceful session end (F5) | Timer summary + row file (§1.3) |

---

## 5 · Numbers

Environment: 4 vCPU, 16 GB, Linux 6.18, `cargo 1.94.1`, release profile, localhost, unshaped. **T2-local:
relative comparisons only.** Raw results: [`measurements/telemetry-pipeline-baseline-2026-09-06.json`](measurements/telemetry-pipeline-baseline-2026-09-06.json).
Tools: `lab/telemetry-bench` (no network, no product crate), `lab/scripts/telemetry_bench_matrix.sh`,
`lab/scripts/telemetry_e2e_baseline.sh` (real `exact-server` + *N* `window-harness` sessions, saturate
mode, depth 4, unpaced reads, `queue_large` fixture of 20 frames at ~50 KB).

Incidental change made in this pass so the baseline could run at all: the analysis container has no
IPv6, and `wtransport`'s default bind is IPv6 dual-stack. `exact-server` gained `--bind <ip>` (default
unchanged) and `window-harness` gained `--ipv4`. Neither touches the serving loop or telemetry.

### 5.1 Emit seam under contention — microbench

Cost of one emit on the emitting thread, `count` sink (drain does no work), ring 4096 rows, batch 64.

**Busy producers** (as fast as possible, 4 M rows total):

| Producers | `global-lock` (today) | `own-sender` | `own-batch` (proposed) |
| --- | --- | --- | --- |
| 1 | 193 ns | 86 ns | 51 ns |
| 4 | 7 120 ns | 358 ns | 17 ns |
| 16 | 10 189 ns | 125 ns | 23 ns |
| 64 | 11 628 ns | 149 ns | 33 ns |

**Paced producers** (realistic rates; per-emit wall time measured around the call):

| Load | `global-lock` (today) | `own-sender` | `own-batch` (proposed) |
| --- | --- | --- | --- |
| 16 sessions, 30 k rows/s total (≈ 1 000 viewers at 30 fps) | 38–42 µs | 34.7 µs | 0.2–0.5 µs |
| 16 sessions, 150 k rows/s total (≈ 5 000 viewers) | 67–78 µs | 33.7 µs | 0.24–0.5 µs |
| 1 session, 10 k rows/s | 12.2 µs | 13.5 µs | 0.37 µs |

Reading:

- **The per-row cost is the drain wake, not the lock.** One uncontended producer pays 12 µs per row
  with or without the global lock, because every `try_send` into an idle bounded channel unparks the
  drain thread (futex wake plus a context switch on this VM). Batching amortises that over 64 rows.
- **The lock adds contention on top.** Under 4 or more busy producers it costs 7–12 µs per emit
  where an owned sender costs 0.1–0.4 µs and a batch 17–33 ns.
- **What 40 µs per frame means for the server.** It is wall time on the tokio worker that runs the
  session: that frame's serve time grows by 40 µs and every other session on the same worker waits.
  Small against a 250 KB frame on a 10 Mbit link, 2 % of the same frame at 1 Gbit, and free to remove.
- **Drops were zero in every paced run**, including the JSON sink at 150 k rows/s: on this box the
  drain keeps up with either sink. Busy-mode drop percentages are not comparable across arms (the
  offered rate differs by 40×) and are not quoted.

### 5.2 Drain shape at scale — microbench

One process, synthetic rows with the same width and field mix as today's `FrameRecord` (36 B).
`current` mirrors `drain_loop` exactly: every row kept as a JSON-ready struct, four `Vec<u32>` sorted
at exit, one pretty-printed report. `streaming` appends fixed-width rows to a file and folds four
log-linear histograms.

| Rows | Shape | RSS peak | Exit (rows → report on disk) | Report | Row file | Exact percentiles |
| --- | --- | --- | --- | --- | --- | --- |
| 1 M | current | 75 MB | 0.98 s | 327 MB JSON | — | inline |
| 1 M | streaming | 3.8 MB | 0.12 s | summary only | 36 MB | offline: 0.06 s, 12 MB peak |
| 10 M | current | 728 MB | 28.5 s (25.6 s writing 3.3 GB JSON) | 3.3 GB JSON | — | inline |
| 10 M | streaming | 3.8 MB | 0.27 s | summary only | 360 MB | offline: 0.63 s, 79 MB peak |
| 100 M | current | *not run; linear projection ≈ 7 GB RSS, 33 GB JSON, minutes* | | | | |
| 100 M | streaming | 3.7 MB | 8.5 s (writing 3.6 GB of rows) | summary only | 3.6 GB | offline: 11.2 s, 766 MB peak |

Histogram against exact sort: p50 / p95 / p99 of the three duration stages were **identical** on this
synthetic distribution, whose percentiles fall below 2 048 µs where the histogram's buckets are 1 µs
wide. The bound above that is 0.1 % by construction and is unit-tested up to `u32::MAX`. Counts,
totals, min and max are exact in both shapes.

Reading: at 10 M rows the in-memory shape needs three quarters of a gigabyte and half a minute to
exit, almost all of it pretty-printing rows nobody reads inline. The streamed shape is flat at under
4 MB, exits in a quarter of a second, and still yields exact percentiles offline in under a second.

### 5.3 End to end — real server, telemetry off vs on, *N* saturating sessions

Real `exact-server` (default binary vs `--features telemetry` with `WTPACS_TELEMETRY=1`), per-frame
stream mode, *N* `window-harness` processes in saturate mode (depth 4, unpaced reads, 5 s dwell),
20-frame fixture of ≈ 50 KB frames. Medians of 3 repeats; server CPU is user + system time over the
whole run (≈ 7 s wall including connect, dwell, and today's report write at exit).

| *N* | Telemetry | Frames/s (median, min–max) | Mbit/s | Server CPU s | ΔCPU | Server peak RSS | Rows | Drops | `serve` p50 / p95 / p99 µs |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | off | 1 816 (1 804–1 823) | 741 | 2.91 | | 17.9 MB | | | |
| 1 | on | 1 779 (1 775–1 792) | 726 | 3.32 | **+14 %** | 18.9 MB | 8 896 | 0 | 33 / 401 / 579 |
| 4 | off | 6 891 (6 841–6 927) | 2 812 | 6.21 | | 31.7 MB | | | |
| 4 | on | 6 829 (6 712–6 919) | 2 787 | 6.92 | **+11 %** | 34.8 MB | 34 147 | 0 | 13 / 189 / 487 |
| 16 | off | 12 357 (11 519–12 473) | 5 042 | 7.62 | | 57.4 MB | | | |
| 16 | on | 11 018 (10 700–11 226) | 4 495 | 8.00 | **+5 %** | 58.3 MB | 55 131 | 0 | 12 / 43 / 288 |
| 32 | off | 9 839 (9 643–10 035) | 4 014 | 7.32 | | 56.9 MB | | | |
| 32 | on | 9 388 (8 995–9 993) | 3 830 | 7.63 | **+4 %** | 59.6 MB | 47 043 | 0 | 14 / 63 / 464 |

Reading:

- **Today's telemetry is not free on the serving path.** Extra server CPU per row falls from 46 µs at
  *N* = 1 to 7 µs at *N* = 16–32: at low concurrency every row finds the drain asleep and pays the
  wake, at high concurrency rows arrive before it sleeps. This is the same effect §5.1 isolates, now
  measured in the real process. The exit-time report write (3–18 MB of pretty JSON here) is inside the
  CPU figure too.
- **Throughput cost is within spread at 1, 4, and 32 sessions and outside it at 16** (−11 %, ranges
  do not overlap). On a 4-core box shared with 16 harness processes, the telemetry thread's CPU
  competes directly with serving; P5's acceptance is that this gap closes.
- **No drops at up to 11 k rows/s** with the 4096-row ring, so drop counting was not exercised here;
  §5.1 shows the drain keeps up to 150 k rows/s on this box.
- **Aggregate throughput falls from 16 to 32 sessions.** That is the harness processes saturating the
  four cores, not a server ceiling; S2 needs a box where the clients are not the bottleneck.
- **`serve` p50 is 33 µs alone and 12–14 µs under load.** An idle core pays wake-up latency on every
  frame; a busy one does not. Serve time on this fixture is scheduling, not work — which is why the
  contract insists on shaped links before quoting `serve_us` at all.
- **Memory** is unremarkable at these sizes: ≈ 1.2 MB per session in the default binary at *N* = 32
  with fast clients, and +1–3 MB for telemetry. The S1 arithmetic only bites with slow clients (P4).

### 5.4 Before / after protocol — what each change must show

| # | Change | Metric | Baseline (this pass) | Acceptance |
| --- | --- | --- | --- | --- |
| P1 | Own sender + per-session batch (F1, F2) | `producer_ns_per_emit` at 16 / 64 producers; paced per-emit cost | §5.1 | Contended cost within 2× of single-producer; paced cost < 2 µs |
| P2 | Streamed rows + histograms (F3, F4) | `rss_peak_kb`, `t_total_ms` at 10 M rows; drop % at 150 k rows/s | §5.2, §5.1 paced | Flat RSS; exit under 1 s; 0 drops at 150 k rows/s with the binary sink |
| P3 | Timer summary (F5) | rows and summary present after `SIGKILL` mid-run | 0 rows today (report never written) | All but the last batch of rows; a summary no older than the timer |
| P4 | Transport knobs exposed (S1) | server `VmHWM` at *N* throttled sessions (`--read-bps` small) | to run with the knobs | RSS vs *N* slope tracks `send_window` |
| P5 | Telemetry overhead on serving | aggregate frames/s and server CPU s, off vs on, same *N* | §5.3 | Within run-to-run noise at every *N* |
| P6 | `ack_us` | present in per-frame rows; corroborated by harness receipt time | n/a | Harness-observed completion within one ACK delay of `ack_us` |
| P7 | FoD length cap (S3) | test: 4 GB length refused without allocating | allocates today | test green |

### 5.5 Improvements without a number

| Improvement | How it is checked |
| --- | --- |
| Schema parity with the client | Field-set diff against `types.ts`; distributions carry the same 11 fields; `schema` key present |
| Readable product loop | `send_one_frame` contains no `Instant`, no `Stamp`, and five recorder calls named for boundaries |
| Absence in the default build | `recorder_is_zero_sized`; `check_telemetry_absent.sh` extended to the new literals |
| Honest nulls | `ack_us: null` in shared mode; `queue_us: null` always (no gesture on the server) |
| Two-file harvest, no join | run folder holds `telemetry-client.json`, `telemetry-server.json`, `telemetry-server.rows` |

---

## 6 · Implementation order

| Phase | Work | Proof |
| --- | --- | --- |
| **S0** | This document; brief and draft plan marked; measurement file committed | done in this pass |
| **S1** | `Recorder` C3 API: `ask`, `located`, `first_byte`, `last_byte`, `refused`, `ack_token`; clocks inside; `Stamp` deleted; `send_one_frame` rewritten to the §1.3 narrative | `recorder_is_zero_sized`; both feature sets build and test; absence script green |
| **S2** | Tap: owned sender, per-session batch, per-process ring in batches, drop counters per session | §5.1 rerun (P1) |
| **S3** | Drain: fixed-width row file, histograms, timer summary, session rows, integrity, `ask_at_us`; feature-gated `--telemetry-report` offline exact | §5.2 rerun (P2), kill test (P3) |
| **S4** | Schema v1: new names, `schema` key, nulls; absence script extended; unit tests incl. nearest-rank on histogram | parity diff, tests |
| **S5** | Server hardening, separate commits, defaults unchanged: FoD length cap; `ServeConfig` transport knobs | P7 test; P4 run |
| **S6** | Harvest: `verify_e2e.py` collects `.rows` beside `.json`; e2e script rerun | §5.3 rerun (P5) |
| **S7** | ADR amendment (server seam = domain events + ZST recorder); brief closed | docs |
| **S8** | Rig run when free: shaped cell, per-frame mode, first `ack_us` distributions | raw artifacts only |

Stop conditions: a default-build absence failure; `send_one_frame` gaining a clock outside the
recorder; any change to the wire or to `write_payload`'s copy discipline.

---

## 7 · Out of scope, and who owns it

| Item | Owner |
| --- | --- |
| Disk reading, mmap residency, readahead, cold-page cost (S8) | disk investigation |
| Stream mode shared vs per-frame | lane A / `stream-mode-remediation.md` |
| Client ask depth | lane C |
| Browser seam and client report | done (ADR G) |
| Decoder / paint stages | none yet; contract already has their slots |
| Admission control, auth (S9) | production hardening, later |
| Multi-endpoint / `SO_REUSEPORT` (S2) | after it is measured to bind |

---

## 8 · Open questions

1. **Timer period for the summary rewrite.** Proposed 5 s; rewriting a few KB is free, the question is
   how stale a mid-run summary may be.
2. **Exact-row cap for the inline `server_frames`.** Proposed 1 M rows (≈ 300 MB pretty JSON); above
   it the JSON carries the summary and points at the row file.
3. **Session sampling default.** Proposed `K = 1` (every session) so lab behaviour is unchanged; the
   thousands-of-sessions cell sets `K` explicitly.
