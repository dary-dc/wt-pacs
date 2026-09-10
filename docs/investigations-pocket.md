# Investigation report — pocket (candidates only)

Tables from [`investigations.md`](investigations.md). Latest results. Two tables per campaign:
measured, then analysed without a metric.

---

## 1 · Disk access

### Measured

| Candidate | What it is | Latest result | Verdict |
| --- | --- | --- | --- |
| **`SeqReader` (`product_fill`)** | Probe, pool on miss, one frame named | Ties every serious arm on a contiguous sweep; **0 rings**. On the tile shape: **+62 % wall / +133 % CPU, 6/6 RESOLVED worse** at 16 KiB | **Accepted** for fill |
| **`TileReader` (`product_tile`)** | Probe, lazy ring, `slots` frames named | 1st or tied on the tile shape; beats every pool arm **RESOLVED** on wall **and** CPU at 16 KiB cold; ties every ring arm. Builds a ring for a 0.4 %-miss fill | **Accepted** for tiles |
| `hybrid_lazyring` | The lab arm the tile reader implements | Tie with `product_tile` on 16 KiB. At 250 kB cold on the workstation, `hybrid_lazyring` vs `pool` is a **tie at every depth**; the shipped `ReadCtx` **trailed** it — that penalty was serial window round trips (`read_path.rs:221`), not the ring | Lab model; product now splits the two readers |
| `pool` (`RWF_NOWAIT` + `spawn_blocking`) | Fallback, and the 2026-09-04 default | 16 KiB misses: shipped reader **−45.4 % CPU, RESOLVED**. 250 kB cold: **pool can beat the ring** (workstation depth 1: `product` vs `pool` **+38.5 % p50, RESOLVED**). Threads: 125–135 at 64 readers, 512 cap | **Kept as fallback**; P0 decides if it becomes the default |
| `uring` (every read through the ring) | One path | Hits **+164.8 % CPU at depth 1, RESOLVED** (`--monitors 0`). Misses tie at depth 1; residual 5–15 % only in a deep miss-dominated regime. Hit penalty scales with frame size (20.4 vs 1.6 µs at 16 KiB; **262 vs 39.6 µs at 250 kB**) | **Rejected as default**; lab flag |
| `pooled_pread` | Every read on the pool | Warm 16 KiB fill vs `SeqReader`: **+484 % wall / +1734 % CPU, 6/6** | Rejected |
| `tokio::fs::File` | Standard sequential reader | **+514 % wall / +1872 % CPU** vs `SeqReader` at 16 KiB fill, 6/6. Same on tokio's io_uring driver: 141 µs–**2.1 ms** per 16 KiB at 64 sessions | Rejected |
| mmap, naive | Mapping, fault in place | Faster p50 and cheaper CPU (no copy). **p99 3 276–3 914 µs at 250 kB cold** vs ~1 036; `gap_max` **3 991–4 158 µs** — freezes co-tenants | Rejected |
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

### Without a metric

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

---

## 2 · Transport

### Measured

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
| Equalise `stream_receive_window` across S and P/Q | Lab symmetry | Peak queued ≈ `D × frame` (e.g. 224 KiB) sits well below 1.25 MB. H7 should not bind | **Do not equalise** |
| `aws-lc-rs`, ACK frequency, socket buffers, initial MTU | Stack knobs | ≤ 3 % or nil on the transport rig | Not applied |
| Prefault (`--prefault true`) | Fault pages off the executor | Per-frame prefault hop, warm cache: −10 % throughput, +14–34 % CPU/byte if done wrong. On as a named hop | Shipped |

### Without a metric

| Candidate | Point of analysis | Why discarded / deferred |
| --- | --- | --- |
| **Fixed-N pool** (N streams between 1 and per-frame) | Server-side change; R6 mechanism | **Untested.** Less promising after R6: retransmit-deferral cost grows with N and the winning endpoint is N = 1 |
| **`--ask-priority` as a product flag** | Lab knob for Q | Campaign variable, not a shipping decision. Deleted from `server/` with `copy` / `split` |
| **MTU / GSO / socket knobs as server flags** | Sweep surface | A campaign needs a knob per variable; a server needs one only where a decision is open. GSO cap lives in quinn. Rejected arms are git history, not `--features lab` |
| **Progressive delivery** (HTJ2K prefix) | Above this layer | A truncated prefix is a viewable image. Dominates absolute milliseconds; not a QUIC knob |
| **Cache size / eviction** | 64-frame cap on a 500-frame series | +65 % offered load for +2.8 pp of misses. Client/cache, not transport |
| **Equalising S vs P/Q windows to isolate “pure HOL”** | Lab-only symmetry | Answers a different question than “ship defaults.” Revisit only if a **lossless** S–Q gap appears that might be flow-control capacity |

---

## 3 · L2 ask policy

### Measured

| Candidate | What it is | Latest result | Verdict |
| --- | --- | --- | --- |
| **control** | On-screen frame only | Scroll median lateness **~63 ms** (one path delay). Jump stranded **0** | Mechanism: no prefetch → late when the link can keep up |
| **window** | Forward prefetch `D−1`, no cap | Scroll **0 ms** lateness. Jump stranded **96 KB** | Mechanism: prefetch covers one path delay |
| **adr** | Formula `D = 4` + same prefetch | Tied with `window` on both primaries (`D=4` does not bind on this emulator) | **Not shown to help or hurt** vs uncapped prefetch |
| **bulk** | Ask the whole study | Jump stranded **768 KB**; jump median 24 ms vs 0 | Do not bulk-ask if the reader might jump |
| **dynfb** | Live `D` from ask→first-byte | Moved 4 → 3; **did not** ratchet to 16. Primaries matched `adr` | **Not shown to win or lose** |
| **dynclean** | Hold-D control | Held 4–4 every run | Sanity pass |

### Without a metric

| Candidate | Point of analysis | Why not a default |
| --- | --- | --- |
| **Live adaptivity from ask→first-byte on a busy pipe** | Unit test + loopback | That interval includes the client's **own queue** (HOL-contaminated). It is the input that made v1's dynamic arm ratchet to D=16 |
| **Clean transport RTT in the browser** | Chromium 141 | The page has **no** transport RTT. No input is both clean and available in the regime where a cap would matter |
| **“Lab implements fixed D” / “do not adapt”** | Design preference after the missing RTT | Not a bake-off result. The close-out supersedes the 2026-09-06 design note as a lock |

---

## 4 · Telemetry

### Measured

| Candidate | What it is | Latest result | Verdict |
| --- | --- | --- | --- |
| Global lock per emit (`64e2c0a`) | Pre-S2 | 7–12 µs busy at 16–64 producers; +11–14 % serving CPU | Replaced |
| Own sender, one `try_send` per row | Head `78537c5` | Lock gone; remaining cost is the **drain wake** (12–35 µs) | Replaced by batching |
| **Batches of 64 on an owned sender** | T1/T2/T4 | Busy 16 producers: **23 ns**. Paced 150 k rows/s: 0.24–0.5 µs. Serving CPU **+0.3–2.1 %**; throughput inside spread | **Shipped** |
| In-memory drain, pretty JSON at exit | Current-at-review | 1 M rows: 75 MB RSS, 0.98 s exit, 327 MB JSON | Replaced |
| **Streaming rows + histograms** | Fixed-width file | 1 M rows: 3.8 MB RSS, 0.12 s; 100 M: 3.7 MB / 8.5 s. Exact rebuild offline under the inline cap | **Shipped** |
| **`ack_us`** (server-observed delivery) | Stamp `finish().await` | Built, measured, **withdrawn**: every shape puts a telemetry token in product code | Suggestion only; delivery from the client report |
| Client Proxy on `globalThis.WebTransport` | A4 | Both arms, one shell. Recorder own cost measured later (improvements P3): 25–30 µs main-thread/frame in the interactive cell | **Shipped** |
| FoD length cap | `MAX_FOD_LEN` 4 MiB | Unbounded `read_fod_msg` could allocate 4 GB | **Shipped** |

### Without a metric

| Candidate | Point of analysis | Why discarded |
| --- | --- | --- |
| **uprobes / eBPF** | External, no product tokens | Needs root and symbols; **no frame index**; does not run where lab work runs |
| **`tracing` layer as the first seam** | Alternative to the wrapper pipeline | Credible upgrade if production observability is wanted (100–300 ns/event), but worse absence proof and per-session state that must be found from the layer. Wrapper keeps the default build constructing only `ProductPipeline` |
| **Client surface compression (C5)** | Trim Proxy boilerplate | Does not improve measurements or the product boundary; can hide which method is tapped |
| **Joining client and server reports** | One file | Two independent files on purpose. Schema unification deferred |

---

## 5 · N6 WASM vs TypeScript

### Measured

| Candidate | What it is | Latest result | Verdict |
| --- | --- | --- | --- |
| **`transport-ts`** | Native JS `Uint8Array` | Smaller first load (**8.8 KB** vs 270 KB); smaller bulk heap. Loses 29/80 frames on a 20 MB batch / 10 Mbit cell (deadline armed at ask) | Not a ship decision from this campaign |
| **`transport-wasm`** | Linear memory + copy out | Delivers **80/80** in that same cell (deadline armed at await). First load ~30× the bytes; bulk footprint 1.9–2.3× | Not a ship decision from this campaign |
| Extra full-frame copy (pre-registered mechanism) | WASM moves each frame twice | Penalty **falls** as frames grow 32 KB → 250 KB (+57.5 → +34.2 µs). A byte-proportional cost cannot do that | **Mechanism not confirmed** — fixed per-frame boundary cost |

### Without a metric

| Candidate | Point of analysis | Why not this campaign |
| --- | --- | --- |
| **A different transport stack** | Cross-stack comparison | Deliberately out of repo and out of the plan — this is the lab's own two arms |
| **BYOB `getReader({ mode: "byob" })`** | Delete the accumulator copy | Improvements lab probe, not N6. Chromium 141 supports it; rewrite of both frame loops; parked |

---

## 6 · Improvements lab

### Measured

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
| **`aws-lc-rs`** for ring (same run as P1) | Crypto crate | +3–5 % CPU at 32 KB, tie at 250 KB, +10–18 % peak RSS | **Not taken** |
| **BYOB reader** | `getReader({ mode: "byob" })` | Probe: 80 × 250 KB in 610 vs 541 reads, 191 vs 200 ms. Saving bounded by `take` ≈ 8–10 % of client self time in a fill cell | Parked — rewrites both frame loops |
| Defects D1–D5, D2/D3 waiters, D4 key leak | Correctness | Reproduced on the runner; not coded on the second pass | Open queue on [`improvements/README.md`](improvements/README.md) |

### Without a metric

| Candidate | Point of analysis | Why not now |
| --- | --- | --- |
| **M1** slimmer product `timing` | `firstChunkMs === lastChunkMs` and `chunks: 1` by construction | Changes the client API. Product call |
| **F1b** WASM: arm the 15 s timeout at ask time (as TS does) | With F1 in place it only shows if the server never answers | API semantics |
| **C2b** load the TLS identity once | Three loads on the dual-stack fallback | Touches `build_endpoint`, which L1 was editing |
| **`pack-study` streams with `io::copy`** | Avoid buffering each frame | Fine at today's sizes; not worth a commit |
| Overlap prefault(k+1) with send(k) | `prepare_us` 60–120 µs/frame | Disk lane |

---

## 7 · Product-policy ADRs

### Measured / standing

| Candidate | What it is | Latest result | Verdict |
| --- | --- | --- | --- |
| **Client window depth C** | `D_min = ceil(U × (1 + RTT / Tf))` | Any depth past saturation buys no throughput and costs latency on every miss. `U = 0.95` is a starting policy. E4 ran in a **dead cell** and is void | **Accepted** |
| **Stride** (skip during fast motion) | Bandwidth conservation | Settle is never strided. Alternative to skipping is showing a **stale** frame | **Accepted** (argument, not a bake-off) |
| **FIFO ask order** | Server serves in ask order | Saving from reordering is bounded by `(D−1)·Tf`. Shared makes ordering less useful, not more | **Accepted** (reject server ordering) |
| **`CancelFrames`** | Drop stale asks in a deque | Sweep: 0 of 100 points. **Not a strong null** (`D ≈ 1`, `frame_modulo: 3`). Rejection is analytic: bytes already in QUIC | **Rejected** |
| Frame framing A/B/C | Shared uni vs per-frame `drop` vs `finish` on a `JoinSet` | Early “per-frame loses” was a misplaced `finish().await`. Settled later by transport R6 / X3L | Deferred here; shared is the transport default |
| Resolution rungs for frames larger than the viewport | Fit, then tiles for zoom | Tiles are a crop; a rung is a downsample | **Accepted**, blocked on a codec outside this repo |

### Without a metric

| Candidate | Point of analysis | Why discarded |
| --- | --- | --- |
| **Server `CancelFrames`** | Undo stale asks in a deque | In this stack cancel arrives too late: the sender has already handed bytes to QUIC. Stronger on a shared stream (stricter commit order) |
| **Server last-ask-wins / generation ordering** | Newest first so a moving reader is not stuck | Inverts a client that emits `cursor, near-fill, far-fill`. FIFO **is** the priority scheme. A server that cannot see the cursor cannot order correctly |
| **Fixed D = 1** (maximum responsiveness) | Window ADR option A | Link idles a full RTT between frames |
| **Fixed deep window** (maximum fill) | Option B | Cache coverage is a function of **time and link rate**, not of `D`. Extra depth only lengthens the miss queue |
| **Deep window + server reorder** | Option D | Ordering rejected; see above |
| **Drop a resolution rung instead of stride** | Stride option C | Reduced-resolution delivery does not reach the render path in the current integration target |
| **Clinical gate on stride** | “Hiding slices” | Nothing skipped would have been displayed; repeated passes re-ask. Bandwidth, not fidelity |
