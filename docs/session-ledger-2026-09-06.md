# Session ledger — 2026-09-06, branch `claude/project-improvements-lab-pmohec`

The complete state of one working session: everything that was changed, everything that was
proposed and not taken, everything that was measured and turned out to be nothing, and what is
still waiting on a decision. The evidence behind each line is in
[`improvements-2026-09-06.md`](improvements-2026-09-06.md); the raw rows are in
[`measurements/improvements-2026-09-06/`](measurements/improvements-2026-09-06/); the drivers that
produced them are in `lab/scripts/` and `lab/bench/` (`lab/README.md`). Nothing here is merged.

**Brief.** Improve the project outside two lanes owned elsewhere — transport
(`cursor/l1-loss-run-dbae`) and disk access (`claude/disk-access-adr-validation-saz6m8`) — and
prove every performance or metrics claim before it is accepted; code changes wait for approval
because readability is a requirement.

**Where the files sit.** Neither lane branch touches the files changed here (each adds a
workspace member in `Cargo.toml`). Two merge notes for whoever lands L1 after this branch: L1 does
not reap per-frame ack tasks, so P4 applies to it too; L1 still calls the TLS module C2 deletes,
so its banner needs the nine-line `cert_sha256_hex` helper.

---

## 1 · Landed on the branch (12 commits, one per item)

| # | Commit | Kind | What changed | Proof | Decision open |
| - | - | - | - | - | - |
| F1 | `f12a16c` | fix, product | WASM client: one receive buffer across control messages; a coalesced browser read no longer drops the messages after the first | Chromium e2e: 1 of 4 refusals seen → 64 of 64, 9 ms | — |
| F2 | `f82c4bb` | fix, product | `study_bundle::parse_layout` refuses frame-table entries outside the data region at open | two failing tests → passing | policy: refuse the bundle (now) vs serve the good frames (before) |
| P4 | `663ace8` | fix, product | per-frame mode reaps finished ack tasks per send instead of at session end | server RSS 7 → 31 MB over 35 k frames before; flat at 12 MB after | goes away with per-frame mode if L1 deletes it |
| C1 | `40789b5` | code | `client/flight-registry` crate deleted (no consumer; carried the rejected cancel) | grep; workspace green | approve |
| C2 | `1e10c8e` | code | `server/src/transport/tls.rs` deleted; banner hash from `wtransport::Identity`; `rcgen`, `time`, `sha2`, `rustls-pemfile` gone | hash byte-identical to `openssl`; 186 → 175 crates; 22 KB smaller binary | approve; L1 merge note above |
| C3 | `9144a0a` | code | `fod::decode_fod_body`; server FoD reader no longer re-frames a body it already has; server clippy-clean | tests, clippy | approve |
| C6/C7 | `a3b63e3` | code (+2 small behaviour fixes) | WASM: `Uint32Array::to_vec`, one `settle` path; TS: one `settle` path, refusal map no longer grows, failed bulk control write fails waiters at once instead of at 15 s | tsc, unit tests, absence check, e2e both arms | approve; the two behaviour changes are named in the commit |
| W1/W2 | `20214f4` | performance, product (WASM) | typed `ReadableStreamReadResult` instead of `Reflect::get` with fresh key strings per read; JS key strings encoded once per thread; receive buffer reserved once the length is known, chunks copied into spare capacity (no zero-fill, no doubling) | same-host A/B profile: `decodeText` 10–21 ms → 0; `__rdl_realloc` 37 → 1.4 ms; `push_chunk` 5–11 → 0 ms | approve |
| H1 | `0337e38` | fix, lab harness | `client/harness/shell.js` samples the JS-heap peak on a 100 ms timer instead of after every frame | `heapBytes` 31–126 ms per run → < 1 ms; it was 3–11 % of every client harvest's main-thread time, both arms | approve (lab code) |
| T1 | `2b007a8` | code, null result | TS FoD codec: module-level encoder/decoder, `decodeFodBody` parity with C3 | measured: per-call `TextEncoder` costs nothing in Chromium 141 or Node 22 — **no speed claimed** | approve as tidiness or drop |
| — | `fb26f7d` | docs | evidence report, first round; withdrawal of P0; ADR schema name v1 → v2; follow-ups table | — | — |
| — | `e274c26` | docs | evidence report, deeper pass; measurements | — | — |
| — | this commit | docs / lab | drivers moved out of `docs/` into `lab/`; this ledger | — | — |

Also added with F1: `client/harness/refusals.html`, the regression page that reproduces it.

## 2 · Withdrawn

| # | What | Why | Where it lives now |
| - | - | - | - |
| P0 | zero-copy send path: `Bytes::from_owner` over the mapping + `quinn::SendStream::write_all_chunks`; `locate(frame) -> Bytes` seam | built and measured here (`send_us` p50 −27 % at 32 KB, −55 % at 250 KB, shared mode), then found already implemented on L1 as `SendPath::Chunked`, the default there | L1 (`server/src/transport/tuning.rs`, `docs/send-path-copy-costs.md` on that branch); the commit was rebased out of this branch and the branch force-pushed once |
| P3 | one 8-byte header write instead of two 4-byte awaits | subsumed by the chunked path (the header is one chunk) | L1 |

## 3 · Measured and found to be nothing (kept so nobody re-derives it)

| What | Method | Result |
| - | - | - |
| Server app code as a hotspot | callgrind, three cells (32 KB shared, 250 KB shared, 32 KB per-frame), `lab/scripts/callgrind_run.sh` | `exact_server::*` < 0.3 % of instructions; `serde_json` 0.06 %; ring AES-GCM ≈ 31–36 %, `memcpy` 13–15 %, quinn ≈ 10 %. The one avoidable term, 11.7 %, is the `write_all` copy L1 removes. Nothing outside the two lanes is left on the server |
| `new TextEncoder()` per FoD ask (T1) | `lab/bench/textencoder.html` in Chromium 141; Node micro-benchmark | 8–11 µs per encode either way in Chromium, 1.8 µs either way in Node; the constructor is free |
| Zero-fill of WASM receive chunks in shared mode | Chromium profile | `push_chunk` 5.5 ms per 320 × 250 KB frames — real but small; it mattered in per-frame mode (11 ms + 37 ms of realloc), which W2 fixed |

## 4 · Proposed, not taken (each with the number that bounds it)

| # | Proposal | Bound / evidence | Why not now | Owner |
| - | - | - | - | - |
| M1 | product `timing` object: reduce to `{ askMs, receivedMs }` (preferred), drop it, or document the placeholder fields | `firstChunkMs === lastChunkMs` and `chunks: 1` by construction in both clients; the transfer term is structurally zero | changes the client API surface | product call |
| BYOB | read media streams with `getReader({ mode: "byob" })` straight into the frame's final buffer; deletes the accumulator copy in both arms | probe (`lab/bench/byob_probe.html`): Chromium 141 supports it on WebTransport receive streams; 80 × 250 KB in 610 reads vs 541, 191 vs 200 ms; saving bounded by `take` ≈ 8–10 % of client self time in a fill cell, less on demand | rewrites the frame loop in both arms; must be checked against the telemetry Proxy, which attributes bytes per `read()`; per-frame-mode probe timed out (probe's stream hand-over, not investigated) | later round, if client CPU per frame becomes the metric |
| F1b | WASM: arm the 15 s frame timeout at ask time (as TS does) rather than when `waitExactFrame` is called | with F1 in place it only shows for a server that never answers: waiters time out one after another (45 s for 4) | API semantics choice | product call |
| C2b | load the TLS identity once and pass it to `build_endpoint` instead of once per bind attempt | three loads on the dual-stack fallback path; startup only | touches `build_endpoint`, which L1 is editing | after L1 lands |
| P2 / P1 | batch prefault for `RequestFrames`; overlap prefault(k+1) with send(k) | `prepare_us` 60–120 µs per frame (telemetry review §4.3) | disk lane | disk track |
| — | `pack-study` streams frames with `io::copy` instead of reading each into memory | fine at today's sizes | not worth a commit | — |
| — | three clippy warnings in `lab/window-harness` (`too_many_arguments`, unused `parse_length_prefixed`, no-op `saturating_sub(1).max(0)`) | — | L1 owns that crate right now | L1 |
| — | after this round the client's remaining main-thread cost is the browser's own `reader.read()` glue and the two `Uint8Array.set` copies (chunk → WASM memory, WASM → JS heap; the TS arm has one), then Chromium internals | profile tables in the report | inherent to the WASM/JS boundary unless the API hands out views of linear memory | client-runtime experiment (N6) |

## 5 · Method notes that a reader of the numbers needs

- **Tier.** Everything is T2-local: one 4-core VM, localhost, no shaping, both sides on the same
  CPU. Relative comparisons only.
- **A/B discipline.** Server A/B runs interleave the two binaries per cell (3 repeats). The client
  A/B rebuilt the pre-change artifacts from git into a side directory and swapped builds per run
  on the same host, because the VM rebooted between the first profile and the A/B and the first
  numbers were not comparable. Proof is the named term going to zero, not wall time; wall time on
  localhost is transfer-bound and moves inside its own noise in fill cells.
- **Callgrind counts instructions**, so CPU contention cannot distort it; the trade is that it
  says nothing about latency (the prefault hand-off, the blind period), which the telemetry stages
  cover.
- **Chromium profiles** use the DevTools sampling profiler at 200 µs; WASM packages built with
  `wasm-pack --profiling` so Rust names survive. `wasm-opt` could not be downloaded on the runner,
  so every WASM build here is `--no-opt`; relative comparisons are unaffected, absolute WASM
  sizes and speeds are not the shipped ones.
- **What was verified on the final tree.** `scripts/gate.sh --quick`, workspace clippy (only
  L1's three harness warnings remain), the server absence check, and the refusals + frame0/bulk
  browser e2e on both arms.

## 6 · Decisions requested

1. Take or drop each commit in §1; F2's refuse-vs-serve policy; T1 as tidiness or drop.
2. M1: which of the three shapes for `timing`.
3. Whether the BYOB reader is worth a round when client CPU per frame becomes the metric.
