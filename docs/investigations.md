# Investigation report

**Status:** first draft for iteration · **2026-09-10** · docs only

A map of what wt-pacs investigated, grouped by **campaign** (a collection of PRs that asked
one product question), not by experiment. Numbers here are the **latest** each campaign still
stands on. Earlier grids that used the wrong metric, the wrong reader, a closed-loop harness,
or a dead cell are named so they are not re-quoted.

**Pocket (candidate tables only):** [`investigations-pocket.md`](investigations-pocket.md).

The ADRs remain the decision records. This file does not reopen them.

## How to read it

- Two tables per campaign: **measured candidates** (metric + latest result) and **analysed
  without a metric** (why discarded before, or instead of, a bake-off).
- **Tie** is a real answer under that campaign's rule, not a missing result. Disk-access
  quotes a difference only if the median beats 28.5 % **and** signs agree on ≥ 80 % of cells.
- Quote **latency or throughput, not both** — one is the other divided by depth.
- Say where the host saturates and claim nothing past it.
- Open PRs are in [In flight](#in-flight), not in the campaign bodies.

## Index

| Campaign | PRs | Question | Latest face |
| --- | --- | --- | --- |
| [Disk access](#1--disk-access--how-the-server-reads-frame-bytes) | [#4](https://github.com/dary-dc/wt-pacs/pull/4) (overturned), [#11](https://github.com/dary-dc/wt-pacs/pull/11), [#18](https://github.com/dary-dc/wt-pacs/pull/18), [#19](https://github.com/dary-dc/wt-pacs/pull/19), [#22](https://github.com/dary-dc/wt-pacs/pull/22) | How to bring SBND bytes off disk without freezing the executor | [`docs/disk-access/`](disk-access/) · evidence tags `read-path-evidence-2026-09-09` / `-10` |
| [Transport](#2--transport--stream-shape-congestion-send-path) | [#5](https://github.com/dary-dc/wt-pacs/pull/5) (carrier); absorbed [#12](https://github.com/dary-dc/wt-pacs/pull/12), [#17](https://github.com/dary-dc/wt-pacs/pull/17), [#20](https://github.com/dary-dc/wt-pacs/pull/20), [#23](https://github.com/dary-dc/wt-pacs/pull/23), [#24](https://github.com/dary-dc/wt-pacs/pull/24). Related closed: [#1](https://github.com/dary-dc/wt-pacs/pull/1), [#2](https://github.com/dary-dc/wt-pacs/pull/2), [#10](https://github.com/dary-dc/wt-pacs/pull/10) | Shared vs per-frame, Cubic vs BBR, send path, windows | [`docs/transport/transport-conclusions.md`](transport/transport-conclusions.md) · tag `archive/transport-lab-2026-09` |
| [L2 ask policy](#3--l2-ask-policy) | Archive [#6](https://github.com/dary-dc/wt-pacs/pull/6), [#7](https://github.com/dary-dc/wt-pacs/pull/7), [#8](https://github.com/dary-dc/wt-pacs/pull/8); close-out [#9](https://github.com/dary-dc/wt-pacs/pull/9) (open, do not merge) | Bound in-flight asks? Adapt the bound live? | PR #9 `L2-ask-policy-CLOSED.md` |
| [Telemetry](#4--telemetry) | [#3](https://github.com/dary-dc/wt-pacs/pull/3) | Instrument clients and server without touching the product path | [`docs/telemetry/`](telemetry/) |
| [N6 client runtime](#5--n6-wasm-vs-typescript) | [#13](https://github.com/dary-dc/wt-pacs/pull/13) archived by [#25](https://github.com/dary-dc/wt-pacs/pull/25) | What the WASM/JS boundary costs on the receive path | [`docs/measurements/n6/ARCHIVE.md`](measurements/n6/ARCHIVE.md) · tag `archive/n6-wasm-vs-ts-2026-09` |
| [Improvements lab](#6--improvements-lab) | [#14](https://github.com/dary-dc/wt-pacs/pull/14), [#21](https://github.com/dary-dc/wt-pacs/pull/21) | Work outside the two owned lanes | [`docs/improvements/`](improvements/) · tag `archive/improvements-lab-2026-09` |
| [Product-policy ADRs](#7--product-policy-adrs) | On `main` with the extract (no numbered campaign PR) | Window depth, stride, cancel, ordering, framing, resolution rungs | `docs/adr-*.md` |

---

## 1 · Disk access — how the server reads frame bytes

**Shipped:** a page-cache hit is `preadv2(RWF_NOWAIT)` on the executor. A fill (`SeqReader`)
names one frame ahead and stays on the blocking pool — no ring. A tile ask (`TileReader`)
keeps `TILE_SLOTS` frames and builds a per-session io_uring on its first miss.

PR #4 shipped mmap + always-touch (2026-08-31). That decision is **overturned**: its harness
ran a current-thread runtime while the product is multi-thread, and `RWF_NOWAIT` was never in
its table. PR #11 is the path that ships. PR #22 only reports planner reach on the session
line (`peak_named` / `peak_in_flight`).

### Metrics of interest

| Metric | Use |
| --- | --- |
| p50 / p99 **per ask** (wall) | Latency. Never compared across arms whose `peak_in_flight` differs |
| CPU per ask | The ring's remaining claim on a device-bound miss |
| `gap_max` | Longest a co-tenant task waited — the column mmap is rejected on |
| OS threads, fds, memlock | Scale at thousands of sessions |
| Miss rate (forced, not page-cache eviction) | Regime label. An 80 MB study is not a miss fixture |
| asks/s | Throughput. Do not quote it **and** latency for the same cell |

Rule: a difference counts only if **\|median\| ≥ 28.5 %** (measured p90 drift) **and** sign
agreement **≥ 0.8n**, and it keeps its sign across independent runs. Everything else is a
**tie**.

### Measured candidates — latest

Latest arm sweep: 2026-09-10, agent container, direction and shape **not magnitude** (noise
floor up to 24 %). Workstation magnitudes: 2026-09-09 / 2026-09-10, with the depth-was-session-count
harness defect corrected. Full tables: [`disk-access/EVIDENCE.md`](disk-access/EVIDENCE.md).

| Candidate | What it is | Latest result | Verdict |
| --- | --- | --- | --- |
| **`SeqReader` (`product_fill`)** | Probe, pool on miss, one frame named | Ties every serious arm on a contiguous sweep; **0 rings**. On the tile shape: **+62 % wall / +133 % CPU, 6/6 RESOLVED worse** at 16 KiB | **Accepted** for fill |
| **`TileReader` (`product_tile`)** | Probe, lazy ring, `slots` frames named | 1st or tied on the tile shape; beats every pool arm **RESOLVED** on wall **and** CPU at 16 KiB cold; ties every ring arm. Builds a ring for a 0.4 %-miss fill | **Accepted** for tiles |
| `hybrid_lazyring` | The lab arm the tile reader implements | Tie with `product_tile` on 16 KiB. At 250 kB cold on the workstation, `hybrid_lazyring` vs `pool` is a **tie at every depth**; the shipped `ReadCtx` **trailed** it — that penalty was the probe capped at `READ_WINDOW`, not the ring | Lab model; product now splits the two readers |
| `pool` (`RWF_NOWAIT` + `spawn_blocking`) | Fallback, and the 2026-09-04 default | 16 KiB misses: shipped reader **−45.4 % CPU, RESOLVED**. 250 kB cold, workstation: the old unified `ReadCtx` trailed it (`product` vs `pool` **+38.5 % p50, RESOLVED** at depth 1) — but that was the capped probe, not the ring: `hybrid_lazyring` vs `pool` **ties at every depth** there. Threads: 125–135 at 64 readers, 512 cap | **Kept as fallback**; P0 decides if it becomes the default |
| `uring` (every read through the ring) | One path | Hits **+164.8 % CPU at depth 1, RESOLVED** (`--monitors 0`). Misses tie at depth 1; residual 5–15 % only in a deep miss-dominated regime. Hit penalty scales with frame size (20.4 vs 1.6 µs at 16 KiB; **262 vs 39.6 µs at 250 kB**) | **Rejected as default**; lab flag |
| `pooled_pread` | Every read on the pool | 16 KiB fill sweep vs `SeqReader`: **+484 % wall / +1734 % CPU, 6/6** | Rejected |
| `tokio::fs::File` | Standard sequential reader | **+514 % wall / +1872 % CPU** vs `SeqReader` at 16 KiB fill, 6/6. Same on tokio's io_uring driver: 141 µs–**2.1 ms** per 16 KiB across 8–64 sessions | Rejected |
| mmap, naive | Mapping, fault in place | Faster p50 and cheaper CPU (no copy). **p99 3 276 µs at 250 kB cold** vs ~1 036 — every mmap arm lands in 3 276–3 914; `gap_max` **3 991–4 158 µs** (250 kB / 16 KiB) — freezes co-tenants | Rejected |
| mmap + always-touch (PR #4) | Hop every ask | Warm **60.9 µs vs 152.3 µs** (2.5×) for inline nowait; neighbour p99 166 vs 702 µs | Overturned 2026-09-04 |
| mmap + `mincore` gate | Touch only if resident | Unsafe under pressure **5/5** — residency is not a lease | Rejected |
| mmap + `populate_read` / `blocking_touch` | Fault on the pool | 2–3× slower at 1.5–2× the CPU — the whole mmap saving, paid back | Rejected |
| Escalate only the rest of the window | Window the miss | 2–3 device round trips per 250 KB: ~1 600 f/s vs ~5 000 | Superseded 2026-09-07 (whole rest of the frame) |
| Ring pipelining (read *n+1* during write *n*) | Overlap | ~6 % on a 100 %-miss trace, **−25 % warm** | Rejected |
| `SQPOLL` | Kernel poller per ring | Worse warm on every column; **2.8× CPU**. `COOP_TASKRUN` is refused alongside it, so every completion parks | **Rejected, closed** — structural |
| Registered buffers | `IORING_REGISTER_BUFFERS` | No change | Rejected — measured unnecessary |
| Ahead-N `POSIX_FADV_WILLNEED` | Hint | **4.6–4.9×** on a cold strided read; a **loss** on a sweep | Measured, not landed |
| Park on the ring fd (drop eventfd) | 1 fd instead of 2 | Tie on CPU and latency | Proposed, after P0 keeps the ring |
| One shared ring per runtime (tokio's shape) | One lock across sessions | **1.36–1.45× slower** than a ring per thread on concurrent positional reads (tokio #8367); reproduced on streams | Not now |
| Whole-frame `RWF_NOWAIT`, one read | Best miss throughput | 250 KB uninterrupted executor copy: **4.0 ms** warm `gap_max` | Rejected |
| Larger window (128 / 256 KiB) | Wider executor copy | −12–25 % warm throughput | Rejected |
| Sequential: depth above 2 per stream | More in flight | At 64 sessions × 16 every arm queues on the device, p99 100–190 ms | Rejected as a rule |
| Sequential: wider windows | Less CPU per byte | Escalations climb 1 % → 13.5 % | Rejected |
| Bounded process-private frame cache | Duplicate of page cache | **−20.2 % CPU** at a 0.92 hit rate; +4.2 % where nothing repeats | Lab only — needs a real ask trace |
| `write_chunk` owned windows to quinn | Fresh 64 KiB per window | −3.2 % at one session; **+14.6 / +19.1 % at 16 / 32, RESOLVED** | Rejected, more so at scale |
| `max_udp_payload_size` 1472 → 4000 B | Transport lever, measured here | **−35 % CPU, +55 % throughput** — largest effect in this investigation. Peer must advertise the same ceiling; above 4000 B path discovery failed | Measured, not taken |
| Serving depth 1 → 2 | Look-ahead **is** depth 2 | Cold 16 KiB: **+67.4 % asks/s, 12/12**; product look-ahead **+73.8 %, 12/12**; warm a tie. 2 collects 62 % of what 16 offers | **Accepted** (`FILL_AHEAD = 1`, `TILE_SLOTS` default 4) |

Hosts stop separating arms at ~64 reads in flight (sandbox on CPU, workstation on the device
~840 MB/s at 0.42 of 8 cores). Past that every arm ties by construction.

### Analysed without a metric — discarded

These were scored on the owners' constraints (Tokio multi-thread runtime, never block a
worker, positional reads on one fd per study, shared page cache) and dropped **before** a
campaign cell.

| Candidate | Point of analysis | Why discarded |
| --- | --- | --- |
| **`tokio-uring` 0.5.0** | Own **current-thread** runtime; last release 2024-05, last commit 2025-07 | `wtransport` runs on `quinn::TokioRuntime`. Adopting it is a **transport rewrite**, not a read-path change |
| **`glommio` · `monoio` · `compio`** | Thread-per-core runtimes; `compio-quic` is the rewrite's shape | Same: cannot sit under quinn's multi-thread Tokio runtime |
| **`rio` · `ringbahn` · `nuclei` · `uring-fs` · `luring`** (and ~90 other `io-uring` dependents) | Soundness hole, dead, own runtime, cursor + thread, `LocalSet`-only | None drives a ring on **multi-thread tokio with positional reads** |
| **`sendfile` / `splice`** | Kernel sendfile into a socket | Userspace QUIC copies anyway — the bytes still pass through quinn |
| **`O_DIRECT` + SPDK, whole-study preload** | Bypass page cache / preload the study | Loses the page cache **shared across sessions**. Wrong scale (studies ≫ RAM) |
| **mmap + pre-fault + zero-copy handoff to quinn** | Hand quinn page-cache pages | Reclaim can take them mid-send; the refault lands **inside quinn on the executor**. Also one pool hop per ask. Safety, not a latency bake-off |
| **A static read-path config toggle** | Compile-time or flag choice of arm | `hybrid_lazyring` already chooses per session at runtime; a static flag can only be wrong |
| **Cursor (`lseek` + `read`) APIs** | One file position | Tiles read `(offset, len)` out of order. Needs one open file per session and cannot express reads in flight |

### Do not quote

| Retracted | What is true |
| --- | --- |
| "`uring` has the better p99 at depth 4" | 4-vCPU sandbox artefact; on the workstation misses tie at every depth |
| "`uring` is 47–61 % worse on latency" | A one-reader p50; does not survive crossing depth with readers |
| "`product` tracks `hybrid_lazyring` at 250 kB" | Retracted on the workstation; the 250 kB penalty was the probe capped at `READ_WINDOW`, not the ring |
| "the 250 kB penalty tracks window count" | Retracted in place: `reads_per_ask` is 1.00–1.01 at every size, so a missing frame is **one** `ctx.read()` and window count was never the variable. One short probe, bracketed from both sides; the mechanism is inferred, only the location was measured. The 2026-09-10 reader split removed the cap — both readers now probe the whole frame |
| Depth-4/16 `product` vs `pool` rows first published 2026-09-09 | Harness modelled depth as **session count**, not reads in flight. Depth 1 stands |
| "`v36`'s 250 KB cold cell shows no win for read-ahead" | It reached only 4.7 % misses — no regression, not no win |
| "ring construction costs 82 µs" | That is 1 000 rings at once; one ring is 15.6 µs |

### Still open

P0 — ring vs pool on the **production** instance, volume class, and container image — is the
one measurement that can delete the ring. The two readers have never met the full arm set on
the workstation ([`NEXT.md`](disk-access/NEXT.md) item 10): the table above is the container
run, so its magnitudes are replaced by that re-run, not confirmed by it. Fill overlap
(pool-miss interleave, 4 MiB `WILLNEED`) is an open follow-on:
[PR #28](https://github.com/dary-dc/wt-pacs/pull/28).

---

## 2 · Transport — stream shape, congestion, send path

**Shipped:** `--stream-mode` defaults to `shared`; one **chunked** send path (`Bytes` view +
`write_all_chunks`); `--prefault true`; **Cubic** default; windows at quinn defaults.
`per-frame` stays a product flag.

PR #5 is the carrier. #12 was the optimisation branch (closed, absorbed). #20 ported send
paths onto `main`'s pipeline. #23/#24 slimmed the face; campaign TSVs live on
`archive/transport-lab-2026-09`.

### Metrics of interest

| Metric | Use |
| --- | --- |
| **p95 time-to-displayable** (`nz_p95` / miss-only waits) | Decision. All-sample p95 mixed cache hits (0) with network waits — that is why L1 v1 is void |
| Stranded bytes | Whether the reader can produce head-of-line blocking. **0.00 MB ⇒ the cell is inadmissible** for stream shape |
| Queue-drop counters | Which loss **regime** the cell actually sat in (congestive vs radio). Reading a controller result as general, without this, flipped the answer three times |
| CPU/byte, throughput | Density (GSO, chunked). Not latency. Never through the datagram-by-datagram simulator |
| `RssAnon` / total RSS on stall | Memory of the send path. A client that asks 25 MB and stops reading |

Target: browser on tablets and phones over 5G, satellite, and WiFi. T2, n = 3 except where a
row says otherwise.

### Measured candidates — latest

Cite [`transport/transport-conclusions.md`](transport/transport-conclusions.md). Stream shape
was re-measured in **R6** after review 4 found the closed-loop reader could not produce HOL
(stranded bytes 0.00 MB). X3L on the Oracle rig was the deciding cell, pre-registered.

| Candidate | What it is | Latest result | Verdict |
| --- | --- | --- | --- |
| **One shared stream (S)** | One uni for the session | Netsim: 3.5× better than per-frame at 64 KB, 8.5× at 250 KB. Real path 250 KB: **594.7 vs 3426.2 ms (5.76×), 3/3**. Absolute penalty reproduced to **1.6 %** across rigs (2787 vs 2832 ms) | **Default** |
| Per-frame, no priority (P) | One uni per frame, equal priority | Trails S by 10–25 % lossless (campaign v2). Fair-sharing: concurrent streams all finish late | Not a product candidate |
| Per-frame + ask-order priority (Q) | `set_priority` by ask seq ([#1](https://github.com/dary-dc/wt-pacs/pull/1), [#10](https://github.com/dary-dc/wt-pacs/pull/10)) | Ties S lossless. Under loss, retransmit deferral (`push_pending` behind every queued stream) grows with N. No cell on either rig separates in Q's favour | Flag remains; not the default |
| `send_fairness(true)` | Quinn fairness | Worse than FIFO in every cell tried | Flag gone |
| **Cubic** | Congestion controller | Congestive (queue overflow only): at 600 ms / 8 Mbps **941 vs 1535 ms**; BBR drops 30–100× more at the bottleneck. Neighbour cost: BBR starves competing TCP 150× in a shallow buffer | **Default** until the mix is measured |
| **BBR** | Congestion controller | Exogenous 1 % radio loss, queue never drops: **−48 % / −44 %** at 50 ms and 600 ms | Keep as the other answer; not the default |
| Initial congestion window | Leave vs raise | ≤ 7 %, ranges overlapping | Leave at quinn default |
| GSO cap 10 → 32 | `MAX_TRANSMIT_SEGMENTS` in quinn (patched crate **outside this tree**) | Loopback n = 1: +17.2 % throughput / −20.9 % CPU/byte at 250 KB. Real path: **−1.0 % / +8.1 %, overlapping** | **Not applied.** Density, not latency; cap is not a server flag |
| **Chunked send** | `Bytes` view + `write_all_chunks` | −6…−14 % CPU/byte at every rate. Stall: **180 kB** held vs **6.8 MB** on copy + per-frame (68 % of the 10 MB `send_window`) | **Only send path** |
| `copy` | Full-frame copy into quinn | Stall 6 990 kB; the arithmetic 10 MB × 5 000 viewers was real **for this path** | Deleted from `server/` |
| `split` | Split write | Stall 6 807 kB — same class as copy | Deleted |
| Flow-control windows | Bound `send_window` for memory | On chunked + shared, stall costs **180 kB** (11 % more than a slow reader). Hygiene, not a lever | Left at quinn defaults |
| Equalise `stream_receive_window` across S and P/Q | Lab symmetry | Peak queued ≈ `D × frame` (e.g. 224 KiB) sits well below 1.25 MB. H7 should not bind | **Do not equalise** — [`adr-quic-stream-receive-window-defaults.md`](transport/adr-quic-stream-receive-window-defaults.md) |
| `aws-lc-rs`, ACK frequency, socket buffers, initial MTU | Stack knobs | ≤ 3 % or nil on the transport rig | Not applied |
| Prefault (`--prefault true`) | Fault pages off the executor | Per-frame prefault hop, warm cache: −10 % throughput, +14–34 % CPU/byte if done wrong. On as a named hop | Shipped |

**Controller is two answers.** Every flip in this work happened because a campaign sat in one
loss regime and the result was read as general. Diagnostic: RTT rising before loss →
congestive → Cubic; loss with RTT flat → radio → BBR. Default Cubic: incumbent, safer error
(63 % worse if wrong vs 48 % the other way), and BBRv1's queue-drop excess is inflicted on
neighbours.

### Analysed without a metric — discarded or not a transport change

| Candidate | Point of analysis | Why discarded / deferred |
| --- | --- | --- |
| **Fixed-N pool** (N streams between 1 and per-frame) | Server-side change; R6 mechanism | **Untested.** Less promising after R6: retransmit-deferral cost grows with N and the winning endpoint is N = 1 |
| **`--ask-priority` as a product flag** | Lab knob for Q | Campaign variable, not a shipping decision. Deleted from `server/` with `copy` / `split` |
| **MTU / GSO / socket knobs as server flags** | Sweep surface | A campaign needs a knob per variable; a server needs one only where a decision is open. GSO cap lives in quinn. Rejected arms are git history, not `--features lab` |
| **Progressive delivery** (HTJ2K prefix) | Above this layer | A truncated prefix is a viewable image. Dominates absolute milliseconds; not a QUIC knob |
| **Cache size / eviction** | 64-frame cap on a 500-frame series | +65 % offered load for +2.8 pp of misses. Client/cache, not transport |
| **Equalising S vs P/Q windows to isolate “pure HOL”** | Lab-only symmetry | Answers a different question than “ship defaults.” Revisit only if a **lossless** S–Q gap appears that might be flow-control capacity |

### Do not quote

| Void / retracted | Why |
| --- | --- |
| Stream-mode decision report (2026-08-28) | Retracted 2026-08-29. `finish().await` inside the serial loop measured an ack wait, not per-frame streams. X3: unequal depths, failed lossless control, p95 over ~4 tail samples |
| Campaign v2 (432 lossless saturate rows) | Confirmed priority fixes P's deficit. **No loss dimension**; `--mode saturate` produces **no p95**. Cannot evaluate its own decision rule |
| Lane A / L1 v1 ([#2](https://github.com/dary-dc/wt-pacs/pull/2)) | Incomplete cell (timeout). v1 `p95_wait_ms` mixed cache-hit zeros with misses |
| Any stream-shape result from `--reader-mode closed` | Stranded bytes 0.00 MB — HOL is structurally impossible |
| `--rtt-ms` as a link (early campaigns) | Userspace stand-in, measured inert in shared mode; produced a flat 0.408 that was never a result |
| GSO +17 % as a real-path latency win | Loopback, n = 1, fixture-dependent; real path overlapping. Zero effect on p95 even where density moved |
| BBR 600 ms congestive **+63 %** as a precise magnitude | n = 2 for BBR (one VOID repeat). **Ordering survives** (Cubic's worst beats BBR's best); the percentage does not |

---

## 3 · L2 ask policy

Two questions: does bounding in-flight asks help, and does adapting that bound live beat a
fixed number? Product ask paths were **not** changed.

PRs #6–#8 are compressed archives on `main` (rankings withdrawn). PR #9 is the close-out
(2026-09-09): harness rework, FIFO simulator, local rerun with `dynfb`. **Do not merge #9 onto
`main`.**

### Metrics of interest

| Metric | Use |
| --- | --- |
| **Median lateness** | Primary. On these short traces, p95 is mostly session start |
| **Stranded bytes** | Work on the wire the reader no longer wants |
| `D` trajectory | Whether dynamic actually moved, or was stuck at the clamp |

v1 ranked `p95_wait_ms` after depth-gated asks (rewards late asks). That ranking is void.

### Measured candidates — latest

Latest admissible grid: local v4 rerun on PR #9 (`--rtt-ms 60`, LinkPacer 10 Mbps, 36/36
integrity). **Emulator, not a shaped path. Not a product lock.**

| Candidate | What it is | Latest result | Verdict |
| --- | --- | --- | --- |
| **control** | On-screen frame only | Scroll median lateness **~63 ms** (one path delay). Jump stranded **0** | Mechanism: no prefetch → late when the link can keep up |
| **window** | Forward prefetch `D−1`, no cap | Scroll **0 ms** lateness. Jump stranded **96 KB** | Mechanism: prefetch covers one path delay |
| **adr** | Formula `D = 4` + same prefetch | Tied with `window` on both primaries (`D=4` does not bind on this emulator) | **Not shown to help or hurt** vs uncapped prefetch |
| **bulk** | Ask the whole study | Jump stranded **768 KB**; jump median 24 ms vs 0 | Do not bulk-ask if the reader might jump |
| **dynfb** | Live `D` from ask→first-byte | Moved 4 → 3; **did not** ratchet to 16. Primaries matched `adr` | **Not shown to win or lose** |
| **dynclean** | Hold-D control | Held 4–4 every run | Sanity pass |

When the reader is faster than the link, policy cannot save lateness except by not putting
unwanted frames first. Those cells rank the link, not the policy.

### Analysed without a metric — discarded as a default

| Candidate | Point of analysis | Why not a default |
| --- | --- | --- |
| **Live adaptivity from ask→first-byte on a busy pipe** | Unit test + loopback | That interval includes the client's **own queue** (HOL-contaminated). It is the input that made v1's dynamic arm ratchet to D=16 |
| **Clean transport RTT in the browser** | Chromium 141 | The page has **no** transport RTT. No input is both clean and available in the regime where a cap would matter |
| **“Lab implements fixed D” / “do not adapt”** | Design preference after the missing RTT | Not a bake-off result. The close-out supersedes the 2026-09-06 design note as a lock |

### Do not quote

| Void | Why |
| --- | --- |
| v1–v3 arm rankings ([#6](https://github.com/dary-dc/wt-pacs/pull/6), [#7](https://github.com/dary-dc/wt-pacs/pull/7)) | Wrong primary metric; unequal workloads (byte/ask counts differed by an order of magnitude); HOL-contaminated RTT; mislabelled RTT axis (netem egress-only). Review: [#8](https://github.com/dary-dc/wt-pacs/pull/8) |
| Cloud v4, 182 rows | `cloud_netem.sh stats` **deleted the shaper**. Unshaped WAN bake-off labelled as netem 60 / 0.5 %. No loss conclusion |
| Anything about 0.5 % loss | Never measured with the shaper still on |

A shaped-path `window` vs `adr`, a loss ranking, and a browser cell are a **new** campaign,
not a reopening of this close-out.

---

## 4 · Telemetry

Lab-only frame-pipeline timing. Default product builds contain **no** telemetry code. Seams:
client Proxy from outside `WebTransport` (A4); server wrapper pipeline (Decision C).

### Metrics of interest

| Metric | Use |
| --- | --- |
| Emit cost on the serving thread (ns / µs) | Must stay invisible at thousands of sessions |
| Drain RSS and exit time | Bounded memory; a killed process still leaves rows |
| Serving CPU / throughput, telemetry off vs on | Product path must not move |
| `overhead_us` | Residual after `prepare + locate + send` |
| Integrity (`null` ≠ 0, nearest-rank, pairing fields) | The report is usable offline |

### Measured candidates — latest

Scale review 2026-09-06: [`telemetry/analysis-scale-and-serving-path-2026-09-06.md`](telemetry/analysis-scale-and-serving-path-2026-09-06.md).

| Candidate | What it is | Latest result | Verdict |
| --- | --- | --- | --- |
| Global lock per emit (`64e2c0a`) | Pre-S2 | 7–12 µs busy at 4–64 producers; **+4–14 %** serving CPU (+14 % at one session, +4 % at 32) | Replaced |
| Own sender, one `try_send` per row | Head `78537c5` | Lock gone; remaining cost is the **drain wake** (12–35 µs) | Replaced by batching |
| **Batches of 64 on an owned sender** | T1/T2/T4 | Busy 16 producers: **23 ns**. Paced 150 k rows/s: 0.24–0.5 µs. Serving CPU **+0.3–2.1 %**; throughput inside spread | **Shipped** |
| In-memory drain, pretty JSON at exit | Current-at-review | 1 M rows: 75 MB RSS, 0.98 s exit, 327 MB JSON | Replaced |
| **Streaming rows + histograms** | Fixed-width file | 1 M rows: 3.8 MB RSS, 0.12 s; 100 M: 3.7 MB / 8.5 s. Exact rebuild offline under the inline cap | **Shipped** |
| **`ack_us`** (server-observed delivery) | Stamp `finish().await` | Built, measured, **withdrawn**: every shape puts a telemetry token in product code | Suggestion only; delivery from the client report |
| Client Proxy on `globalThis.WebTransport` | A4 | Both arms, one shell. Recorder own cost measured later (improvements P3): 25–30 µs main-thread/frame in the interactive cell | **Shipped** |
| FoD length cap | `MAX_FOD_LEN` 4 MiB | Unbounded `read_fod_msg` could allocate 4 GB | **Shipped** |

### Analysed without a metric — discarded

| Candidate | Point of analysis | Why discarded |
| --- | --- | --- |
| **uprobes / eBPF** | External, no product tokens | Needs root and symbols; **no frame index**; does not run where lab work runs |
| **`tracing` layer as the first seam** | Alternative to the wrapper pipeline | Credible upgrade if production observability is wanted (100–300 ns/event), but worse absence proof and per-session state that must be found from the layer. Wrapper keeps the default build constructing only `ProductPipeline` |
| **Client surface compression (C5)** | Trim Proxy boilerplate | Does not improve measurements or the product boundary; can hide which method is tapped |
| **Joining client and server reports** | One file | Two independent files on purpose. Schema unification deferred |

Improvements D1 (second sequential session truncates `telemetry-server.rows`) is a **defect**
found after this campaign; it does not void the numbers (every harvest started one server per
cell).

---

## 5 · N6 WASM vs TypeScript

One question: what does the WASM/JS boundary cost on the receive path? Same server, same
wire, one harness shell. Lab and docs only. PR #13 is closed; #25 left a pointer on `main`.

### Metrics of interest

| Metric | Use |
| --- | --- |
| `deliver_us` (last byte → app holds the bytes) | Per-frame receive-path cost. **Stale** after improvements W1/W2 — do not use for a ship decision |
| `ask_to_complete` | End-to-end; on a shaped link the boundary is 0.014–0.024 % of the wait |
| First-load bytes / `connect_ms` | One-time |
| Peak JS heap + WASM linear memory | Bulk footprint |
| Frames delivered vs 15 s timeout | Robustness (same constant, different arming point) |

### Measured candidates — latest

Still citable from tag `archive/n6-wasm-vs-ts-2026-09` (findings that do **not** depend on
W1/W2). `deliver_us` **+25 to +58 µs** was pre–W1/W2.

| Candidate | What it is | Latest result | Verdict |
| --- | --- | --- | --- |
| **`transport-ts`** | Native JS `Uint8Array` | Smaller first load (**8.8 KB** vs 270 KB); smaller bulk heap. Loses 29/80 frames on a 20 MB batch / 10 Mbit cell (deadline armed at ask) | Not a ship decision from this campaign |
| **`transport-wasm`** | Linear memory + copy out | Delivers **80/80** in that same cell (deadline armed at await). First load ~30× the bytes; bulk footprint 1.9–2.3× | Not a ship decision from this campaign |
| Extra full-frame copy (pre-registered mechanism) | WASM moves each frame twice | Penalty **falls** as frames grow 32 KB → 250 KB (+57.5 → +34.2 µs). A byte-proportional cost cannot do that | **Mechanism not confirmed** — fixed per-frame boundary cost |

A new N6 on today's clients (after W1/W2) is a **new** campaign.

### Analysed without a metric

| Candidate | Point of analysis | Why not this campaign |
| --- | --- | --- |
| **A different transport stack** | Cross-stack comparison | Deliberately out of repo and out of the plan — this is the lab's own two arms |
| **BYOB `getReader({ mode: "byob" })`** | Delete the accumulator copy | Improvements lab probe, not N6. Chromium 141 supports it; rewrite of both frame loops; parked |

---

## 6 · Improvements lab

Work **outside** transport (L1) and disk access. PR #14 landed first-pass commits (one per
item) plus evidence. PR #21 isolated the docs folder. Nothing here was a transport or
read-path decision.

### Metrics of interest

| Metric | Use |
| --- | --- |
| Chromium sampling profile (200 µs), named WASM/JS terms | Proof is the named term going to **zero**, not localhost wall time |
| Server `send_us` / CPU per frame, interleaved A/B | Build-profile and send-path claims |
| RSS timeline | Ack-task leak |
| Callgrind instruction share | Whether app code is a hotspot |
| e2e refusals / frame0 | Correctness, not speed |
| Binary / wasm size | P1 / P2 |

Tier: T2-local (4-core VM, localhost, no shaping). Relative comparisons only.

### Measured candidates — latest

First pass (landed on the branch, take-or-drop): [`improvements/2026-09-06.md`](improvements/2026-09-06.md).
Second pass (analysis only): [`improvements/2026-09-08.md`](improvements/2026-09-08.md).

| Candidate | What it is | Latest result | Verdict |
| --- | --- | --- | --- |
| **W1/W2** WASM receive path | Typed reads, cached JS keys, right-sized `RecvBuf` | `decodeText` 10–21 ms → 0; `__rdl_realloc` 37 → 1.4 ms; `push_chunk` 5–11 → 0 | Landed on #14; **invalidates N6 `deliver_us`** |
| **P4** per-frame ack reap | `try_join_next` per send | RSS 7 → 31 MB over 35 k frames **before**; flat at ~12 MB after | Landed |
| **H1** harness heap sample | Timer, not per frame | 31–126 ms → < 1 ms (3–11 % of harvest main-thread time) | Landed (lab) |
| **F1** WASM control buffer | One buffer across FoD messages | 1 of 4 refusals seen → **64/64 in 9 ms** | Landed |
| **P1** `lto = "fat"`, `codegen-units = 1` | Workspace release profile | Server CPU/frame **−5–8 %**, `send_us` p50 **−8–20 %**, binary **−26 %**; rebuild 3 s → 37 s. Also [PR #27](https://github.com/dary-dc/wt-pacs/pull/27) | **Candidate**, not taken — changes every binary |
| **P2** WASM `opt-level = "s"` + LTO | Package size | gzip **−12 %**; `init()` 5–6 ms every variant; no speed change | **Candidate**, not taken |
| **P3** recorder own cost | Telemetry on vs off | Interactive: **25–30 µs** main-thread/frame (~5× the report's `tap_read_cost_us`). Fill: invisible | Observation, no code |
| **P0** zero-copy send | `Bytes::from_owner` + `write_all_chunks` | Measured here (`send_us` p50 −27 % / −55 %), then found **already on L1** | **Withdrawn** |
| Coalesced 8-byte header write | Two 4-byte awaits → one | Subsumed by chunked (header is one chunk) | **Withdrawn** |
| Server app code as hotspot | Callgrind, three cells | `exact_server::*` **< 0.3 %** of instructions; ring AES-GCM 31–36 %, `memcpy` 13–15 %, quinn ~10 %. Avoidable term 11.7 % is the `write_all` copy L1 removes | **Null** — nothing left outside the two lanes |
| Per-call `TextEncoder` (T1) | TS FoD codec | 8–11 µs either way in Chromium; constructor is free | **Null** (tidiness only) |
| **BYOB reader** | `getReader({ mode: "byob" })` | Probe: 80 × 250 KB in 610 vs 541 reads, 191 vs 200 ms. Saving bounded by `take` ≈ 8–10 % of client self time in a fill cell | Parked — rewrites both frame loops |
| Defects D1–D5, D2/D3 waiters, D4 key leak | Correctness | Reproduced on the runner; not coded on the second pass | Open queue on [`improvements/README.md`](improvements/README.md) |

### Analysed without a metric — not taken

| Candidate | Point of analysis | Why not now |
| --- | --- | --- |
| **M1** slimmer product `timing` | `firstChunkMs === lastChunkMs` and `chunks: 1` by construction | Changes the client API. Product call |
| **F1b** WASM: arm the 15 s timeout at ask time (as TS does) | With F1 in place it only shows if the server never answers | API semantics |
| **C2b** load the TLS identity once | Three loads on the dual-stack fallback | Touches `build_endpoint`, which L1 was editing |
| **`pack-study` streams with `io::copy`** | Avoid buffering each frame | Fine at today's sizes; not worth a commit |
| Overlap prefault(k+1) with send(k) | `prepare_us` 60–120 µs/frame | Disk lane |

---

## 7 · Product-policy ADRs

Landed on `main` as docs with the public extract, before the numbered campaign PRs. They are
the client/server **policy** the later campaigns had to respect.

### Metrics of interest (where a sweep existed)

| ADR | Metric | Latest standing |
| --- | --- | --- |
| [Reject cancel](adr-reject-server-cancel.md) | `recovered_ms` (settle → first byte) | Sweep: cancel beat FIFO at **0 of 100** points. **The 0-of-100 is not a strong null** (ran at `D ≈ 1`, trace `frame_modulo: 3`). Rejection now rests on the **analytic** argument in the ordering ADR: bytes are committed to the transport before cancel lands |
| [Reject server ordering](adr-reject-server-ordering.md) | Bound `(D−1)·Tf` | FIFO preserves client ask order. Saving is bounded by ≈ RTT + one frame time, and only on a miss. Measurements were per-frame unis; shared makes ordering **less** useful, not more |
| [Client window depth](adr-client-window-depth.md) | `D_min = ceil(U × (1 + RTT / Tf))` | **Accepted C**: any depth past saturation buys no throughput and costs latency on every miss. `U = 0.95` is a starting policy, not a measured result. E4 (does the formula pick the right `D`?) ran in a **dead cell** and is void |
| [Stride](adr-stride-is-bandwidth-conservation.md) | — (argument) | Skip during fast motion; settle is never strided. Alternative to skipping is showing a **stale** frame. Not a bake-off |
| [Frame framing](adr-frame-framing-and-loop-shape.md) | — | Early “per-frame loses on merit” comparison was a misplaced `finish().await`. Decision **deferred** at the time; later settled by transport R6 / X3L |
| [Resolution fitting](adr-resolution-fitting-for-large-frames.md) | — | Deliver the rung that fits the viewport; tiles for zoom. **Blocked** on a codec dependency outside this repo |

### Analysed without a metric

| Candidate | Point of analysis | Why discarded |
| --- | --- | --- |
| **Server `CancelFrames`** | Undo stale asks in a deque | In this stack cancel arrives too late: the sender has already handed bytes to QUIC. Stronger on a shared stream (stricter commit order) |
| **Server last-ask-wins / generation ordering** | Newest first so a moving reader is not stuck | Inverts a client that emits `cursor, near-fill, far-fill`. FIFO **is** the priority scheme. A server that cannot see the cursor cannot order correctly |
| **Fixed D = 1** (maximum responsiveness) | Window ADR option A | Link idles a full RTT between frames |
| **Fixed deep window** (maximum fill) | Option B | Cache coverage is a function of **time and link rate**, not of `D`. Extra depth only lengthens the miss queue |
| **Deep window + server reorder** | Option D | Ordering rejected; see above |
| **Drop a resolution rung instead of stride** | Stride option C | Reduced-resolution delivery does not reach the render path in the current integration target |
| **Clinical gate on stride** | “Hiding slices” | Nothing skipped would have been displayed; repeated passes re-ask. Bandwidth, not fidelity |

Window-saturation E1/E2/E4 and the copy-cost knee were **not closed** as campaigns: dead
cells (reader slower than the link), `frame_modulo: 3`, and RTT≈0 collapsing `D` to 1. The
precondition now on record: **reader demand must exceed link supply** or the cell is not a
measurement.

---

## In flight

Not in the campaign bodies. Listed so a later revision can fold them in or drop them.

| PR | What | Notes |
| --- | --- | --- |
| [#9](https://github.com/dary-dc/wt-pacs/pull/9) | L2 close-out + harness | Investigation **closed**. Do not merge onto `main` |
| [#26](https://github.com/dary-dc/wt-pacs/pull/26) | Rebase leftover mmap work off `SeqReader`/`TileReader` | Not a new investigation |
| [#27](https://github.com/dary-dc/wt-pacs/pull/27) | Land improvements P1 (fat LTO) | Same numbers as [§6](#6--improvements-lab) |
| [#28](https://github.com/dary-dc/wt-pacs/pull/28) | Fill: overlap pool misses; 4 MiB `WILLNEED` on nowait | Latest claimed: vs settle-first, 16 KiB force-pool **−34.9 % p50, 12/12**; 250 kB cold **−41.3 %, 12/12**; warm **tie**. Naive overlap **retracted**; one-frame WILLNEED **not enough** (250 kB cold +17.9 %, tie). 10 µs max **hit** on warm 16 KiB — not a `send_us` claim |

---

## Pointers

| Want | Where |
| --- | --- |
| Disk decision + every candidate in one table | [`disk-access/adr.md`](disk-access/adr.md) §1 and §5 |
| Disk numbers (including retractions) | [`disk-access/EVIDENCE.md`](disk-access/EVIDENCE.md) |
| Transport answer sheet | [`transport/transport-conclusions.md`](transport/transport-conclusions.md) |
| Transport campaign TSVs / reviews | tag `archive/transport-lab-2026-09` |
| L2 what holds vs what is void | PR #9 `docs/lanes/L2-ask-policy-CLOSED.md` |
| N6 what is still citable | [`measurements/n6/ARCHIVE.md`](measurements/n6/ARCHIVE.md) |
| Improvements open queue | [`improvements/README.md`](improvements/README.md) |
