# Investigation report — pocket

Candidates that were **in contention** or that **shipped**. Dominated alternatives are omitted
(mmap variants, `pooled_pread`, `copy`/`split`, `SQPOLL`, registered buffers, …). Full tables:
[`investigations.md`](investigations.md).

Two tables per campaign: measured, then analysed without a metric.

---

## 1 · Disk access

### Measured

| Candidate | Latest result | Verdict |
| --- | --- | --- |
| **`SeqReader`** — probe, pool on miss, one frame named | Ties every serious arm on a contiguous sweep; **0 rings**. On tiles: **+62 % wall / +133 % CPU, 6/6** worse at 16 KiB | **Accepted** for fill |
| **`TileReader`** — probe, lazy ring on first miss, `slots` frames | 1st or tied on tiles; beats every pool arm **RESOLVED** on wall and CPU at 16 KiB cold; ties other ring arms. A 0.4 %-miss fill would still build a ring — that is why fill is a different reader | **Accepted** for tiles |
| **`pool`** — `RWF_NOWAIT` + `spawn_blocking` | 16 KiB misses: shipped reader **−45.4 % CPU** against it. At 250 kB cold, `hybrid_lazyring` vs pool is a **tie at every depth**; the old unified `ReadCtx` trailed (`product` vs pool **+38.5 % p50** at depth 1) because the probe was capped at `READ_WINDOW`, not because of the ring. Both readers now probe the whole frame. Threads 125–135 at 64 readers | **Fallback**; P0 on the production target can still delete the ring |
| **`uring`** — every read through the ring | Hits **+164.8 % CPU at depth 1, RESOLVED**. Misses tie at depth 1; residual 5–15 % only when deep and miss-dominated. Hit penalty scales with frame size (20.4 vs 1.6 µs at 16 KiB; **262 vs 39.6 µs at 250 kB**) | **Rejected** as default; lab flag |
| **Serving depth 1 → 2** | Cold 16 KiB: **+67.4 %** (lab) / **+73.8 %** (product) asks/s, 12/12; warm a tie. Depth 2 collects 62 % of what 16 offers | **Accepted** (`FILL_AHEAD = 1`, `TILE_SLOTS` default 4) |
| **`max_udp_payload_size` 1472 → 4000 B** | **−35 % CPU, +55 % throughput** — largest effect in this investigation. Peer must advertise the same ceiling | Measured, **not taken** |

### Without a metric

| Candidate | Why discarded |
| --- | --- |
| **`tokio-uring`** | Own **current-thread** runtime. `wtransport` runs on `quinn::TokioRuntime` — a transport rewrite, not a read-path change |
| **`glommio` · `monoio` · `compio`** | Thread-per-core runtimes. Same: cannot sit under quinn’s multi-thread Tokio runtime |
| Other `io-uring` crates (`rio`, `ringbahn`, `nuclei`, …) | Soundness hole, dead, own runtime, cursor+thread, or `LocalSet`-only. None drives a ring on multi-thread tokio with positional reads |

---

## 2 · Transport

### Measured

| Candidate | Latest result | Verdict |
| --- | --- | --- |
| **One shared stream (S)** | Netsim: 3.5× / 8.5× better than per-frame at 64 / 250 KB. Real path 250 KB: **594.7 vs 3426.2 ms (5.76×), 3/3**. Absolute penalty reproduced to **1.6 %** across rigs | **Default** |
| **Per-frame + ask-order priority (Q)** | Ties S lossless. Under loss, retransmit deferral grows with N. No cell on either rig separates in Q’s favour | Flag remains; **not** the default |
| **Cubic vs BBR** | Congestive (queue overflow): Cubic wins, margin at high RTT (**941 vs 1535 ms** at 600 ms / 8 Mbps); BBR drops 30–100× more and starves competing TCP in a shallow buffer. Radio 1 % loss, queue never drops: BBR **−48 % / −44 %** | **Cubic default** until the mix is measured; BBR is the other answer |
| **Chunked send** | −6…−14 % CPU/byte. Stall (ask 25 MB, stop reading): server holds **180 kB** vs **6.8 MB** on the old copy path | **Only send path** |
| **GSO cap 10 → 32** | Loopback n = 1: +17.2 % throughput / −20.9 % CPU/byte at 250 KB. Real path: **−1.0 % / +8.1 %, overlapping**. Zero effect on p95. Cap lives in quinn, not a server flag | **Not applied** |
| **Flow-control windows** | On chunked + shared the stall costs **180 kB** — ~57× below quinn’s 10 MB `send_window`, which it never approaches | Left at quinn defaults |
| **Prefault** | Fault pages off the executor. A hop on every warm ask costs ~10 % throughput | **Shipped** (`--prefault true`) |

### Without a metric

| Candidate | Why discarded / deferred |
| --- | --- |
| **Fixed-N pool** (N streams between 1 and per-frame) | **Untested.** R6 makes it less promising: retransmit-deferral cost grows with N and the winning endpoint is N = 1 |

---

## 3 · L2 ask policy

Emulator only (10 Mbps, `--rtt-ms 60`). Not a product lock. Rank **median lateness** and **stranded bytes**.

### Measured

| Candidate | Latest result | Verdict |
| --- | --- | --- |
| **control** — on-screen frame only | Scroll ~**63 ms** late (one path delay). Jump stranded **0** | No prefetch → late when the link can keep up |
| **window** — forward prefetch, no cap | Scroll **0 ms**. Jump stranded **96 KB** | Prefetch covers one path delay |
| **adr** — formula `D = 4` + same prefetch | Tied with `window` (`D=4` does not bind here) | **Not shown** to help or hurt vs uncapped prefetch |
| **bulk** — ask the whole study | Jump stranded **768 KB**; jump median 24 ms vs 0 | Do not bulk-ask if the reader might jump |
| **dynfb** — live `D` from ask→first-byte | Moved 4 → 3; did **not** ratchet to 16. Primaries matched `adr` | **Not shown** to win or lose |

### Without a metric

| Candidate | Why not a default |
| --- | --- |
| **Live adaptivity from ask→first-byte on a busy pipe** | That interval includes the client’s own queue. It is how v1’s dynamic arm ratcheted to D=16 |
| **Clean transport RTT in the browser** | Chromium 141 exposes none to a page. No input is both clean and available where a cap would matter |

---

## 4 · Telemetry

### Measured

| Candidate | Latest result | Verdict |
| --- | --- | --- |
| **Batches of 64 on an owned sender** | Busy 16 producers: **23 ns**/emit (was 7–12 µs under a global lock, 4–64 producers). Serving CPU **+0.3–2.1 %** with telemetry on | **Shipped** |
| **Streaming rows + histograms** | 1 M rows: 3.8 MB RSS / 0.12 s exit vs 75 MB / 0.98 s for in-memory JSON. Exact rebuild from the file under the inline cap | **Shipped** |
| **`ack_us`** — stamp `finish().await` | Built and measured; every shape puts a telemetry token on the product send path | **Withdrawn** |
| **Client Proxy** on `WebTransport` | Both arms, one shell. Own cost **25–30 µs** main-thread/frame in the interactive cell (improvements P3) | **Shipped** (lab-only builds) |

### Without a metric

| Candidate | Why discarded |
| --- | --- |
| **uprobes / eBPF** | Root, symbols, **no frame index**; does not run where lab work runs |
| **`tracing` as the first seam** | Credible later if production observability is wanted; worse absence proof. Wrapper keeps the default build constructing only `ProductPipeline` |

---

## 5 · N6 WASM vs TypeScript

Same wire, one harness. `deliver_us` is **stale** after W1/W2 — not a ship input.

### Measured

| Candidate | Latest result | Verdict |
| --- | --- | --- |
| **`transport-ts`** | First load **8.8 KB** vs 270 KB; smaller bulk heap. On a 20 MB / 10 Mbit batch: **51/80** (deadline armed at ask) | Not a ship decision from this campaign |
| **`transport-wasm`** | Same cell: **80/80** (deadline armed at await). First load ~30×; bulk footprint ~2× | Not a ship decision from this campaign |

The planned mechanism (one extra full-frame copy) was **not confirmed**: the `deliver` penalty shrank as frames grew 32 → 250 KB.

### Without a metric

| Candidate | Why not this campaign |
| --- | --- |
| **BYOB `getReader({ mode: "byob" })`** | Probe belongs with improvements. Rewrites both frame loops |

---

## 6 · Improvements lab

Outside the two owned lanes. First-pass commits are take-or-drop on #14; P1/P2 are still open.

### Measured

| Candidate | Latest result | Verdict |
| --- | --- | --- |
| **W1/W2** WASM receive path | `decodeText` 10–21 ms → 0; `__rdl_realloc` 37 → 1.4 ms; `push_chunk` 5–11 → 0 | Landed; **invalidates N6 `deliver_us`** |
| **P4** reap per-frame acks as they finish | RSS grew ~0.55 KB/frame (7 → 31 MB over 35 k); after, flat at ~12 MB | Landed |
| **F1** one WASM control buffer across FoD messages | 1 of 4 refusals seen → **64/64 in 9 ms** | Landed |
| **P1** `lto = "fat"`, `codegen-units = 1` | Server CPU/frame **−5–8 %**, `send_us` p50 **−8–20 %**, binary **−26 %**; rebuild 3 s → 37 s | **Candidate**, not taken — changes every binary |
| **P2** WASM `opt-level = "s"` + LTO | gzip **−12 %**; `init()` unchanged | **Candidate**, not taken |
| **Server app code as hotspot** | Callgrind: `exact_server::*` **< 0.3 %** of instructions. Rest is AES-GCM, `memcpy`, quinn. The one avoidable term is the `write_all` copy L1 already removes | **Null** — nothing left outside the two lanes |
| **BYOB reader** | 80 × 250 KB: 610 vs 541 reads, 191 vs 200 ms. Saving bounded by `take` ≈ 8–10 % of fill self time | Parked |

### Without a metric

| Candidate | Why not now |
| --- | --- |
| **M1** slimmer product `timing` | `firstChunkMs === lastChunkMs` and `chunks: 1` by construction. Changes the client API |

---

## 7 · Product-policy ADRs

### Measured / standing

| Candidate | Latest result | Verdict |
| --- | --- | --- |
| **Window depth C** — `D_min = ceil(U × (1 + RTT / Tf))` | Depth past saturation buys no throughput and costs latency on every miss. `U = 0.95` is policy, not a measured result. E4 ran in a dead cell (void) | **Accepted** |
| **Stride** — skip during fast motion; settle never strided | The alternative to skipping is showing a **stale** frame | **Accepted** (argument) |
| **FIFO ask order** | Saving from server reorder is bounded by `(D−1)·Tf`. Shared makes leftover reorderable work smaller | **Accepted** (reject server ordering) |
| **`CancelFrames`** | Sweep 0 of 100 — **not a strong null** (`D ≈ 1`, three unique frames). Rejection is analytic: bytes are already in QUIC | **Rejected** |

### Without a metric

| Candidate | Why discarded |
| --- | --- |
| **Server last-ask-wins / generation ordering** | A client emitting `cursor, near-fill, far-fill` would have far-fill served first. FIFO already *is* the priority scheme |
