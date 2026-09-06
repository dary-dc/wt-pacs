# Improvements outside the transport and disk lanes — evidence for review

**Date:** 2026-09-06 · **Branch:** `claude/project-improvements-lab-pmohec` · **Status:** every
item below is a candidate; nothing is accepted until reviewed. One commit per candidate so each
can be taken or dropped alone. The complete inventory of the session — landed, withdrawn,
measured-null, proposed-not-taken, decisions open — is
[`session-ledger-2026-09-06.md`](session-ledger-2026-09-06.md); this file is the evidence.

**Scope rule.** Transport policy (stream mode, QUIC knobs, the session loop shape, the shaped rig)
is lane L1 (`cursor/l1-loss-run-dbae`); disk access (prefault, `pread`, the read path) is
`claude/disk-access-adr-validation-saz6m8`. Neither branch touches the files changed here
(they add workspace members in `Cargo.toml`; that merge is trivial). One candidate (P0) turned out to be already
implemented on L1 and was withdrawn; two items sit next to a lane and say so.

**Evidence tier.** Everything measured here is **T2-local**: one 4-core VM, localhost, no
shaping, both sides sharing the CPU. Relative comparisons only; A/B runs interleave the two
binaries in every cell so drift lands on both. Raw rows and the scripts are in
[`measurements/improvements-2026-09-06/`](measurements/improvements-2026-09-06/); the drivers that
produced them live in `lab/scripts/` and `lab/bench/` (see `lab/README.md`).

| # | Kind | Commit | Claim | Proof |
| - | - | - | - | - |
| F1 | fix | `f12a16c` | WASM client lost control messages that shared a read | 1 of 4 refusals seen → 64 of 64 |
| F2 | fix | `f82c4bb` | corrupt frame table now refused at open, not per frame | failing test → passing |
| P4 | fix | `663ace8` | per-frame mode grew ≈ 0.55 KB of RSS per frame for the whole session | 30.8 MB → 12.5 MB after 35 k frames |
| C1 | code | `40789b5` | dead crate `client/flight-registry` removed | zero references; workspace green |
| C2 | code | `1e10c8e` | hand-rolled TLS module removed, four deps gone | banner hash identical; 186 → 175 crates |
| C3 | code | `9144a0a` | FoD read path decodes without re-framing | tests + clippy clean |
| C6/C7 | code | `a3b63e3` | client duplication removed; two small behaviour fixes | type-check, unit tests, e2e both arms |
| M1 | metrics | — (proposal) | product `timing` object reports a transfer term that is structurally zero | source |
| W1/W2 | performance | `20214f4` | WASM client: per-read string decoding, per-frame key encoding, buffer zero-fill and doubling removed | `decodeText` 10–21 ms → 0, `__rdl_realloc` 37 → 1.4 ms, `push_chunk` 5–11 → 0 ms (same-host A/B profile) |
| H1 | lab fix | `0337e38` | harness read `performance.memory` after every frame; 3–11 % of every client harvest's main-thread time | 31–126 ms per run → < 1 ms |
| T1 | code (null) | `2b007a8` | TS FoD codec tidied; the per-call TextEncoder was measured and found free | micro-benchmark, Chromium + Node |
| — | analysis | — | server: app code < 0.3 % of instructions; 11.7 % is the copy L1 removes; the rest is QUIC + crypto | callgrind, three cells |
| — | analysis | — | client: BYOB reader is supported and would delete the one accumulator copy; bounded, not taken | probe, 80 × 250 KB |

---

## P0 · Zero-copy send path — withdrawn, already on L1

The first version of this branch carried a zero-copy send path (`Bytes::from_owner` over the
mapping + `quinn::SendStream::write_all_chunks`). It was measured here at −27 % / −55 %
`send_us` p50 (32 KB / 250 KB frames, shared mode, localhost A/B) and then **found to be
already implemented on `cursor/l1-loss-run-dbae`** as `SendPath::Chunked`, the default there
(`server/src/transport/tuning.rs`, `docs/send-path-copy-costs.md` on that branch). The commit was
dropped from this branch to avoid a duplicate and a merge conflict; the independent measurement
agrees with L1's direction and is recorded here only as corroboration. The A/B harness that
measured it (`lab/scripts/sendpath_ab_bench.sh`) stays, as the generic server A/B driver.

---

## F1 · WASM client dropped control messages that shared a browser read

**Defect.** `client/transport-wasm/src/session.rs` `read_fod_msg` built a fresh `RecvBuf` for
each control message. When one `ReadableStream` read carried more than one message — which is what
happens when the server writes several `FrameError`s back to back — the bytes after the first
message were dropped with the buffer. The TypeScript client keeps one accumulator across messages
and does not have the defect.

**Proof.** `client/harness/refusals.html` (kept as the regression harness) sends one
`RequestFrames` whose every index is out of range, so the server answers with *n* refusals in a
row. Chromium 141, product builds, base server:

| arm | n | refused with reason | timed out | wall |
| - | - | - | - | - |
| ts | 64 | 64 | 0 | 10 ms |
| wasm | 4 | **1** | **3** | 45 s (15 s each, in sequence) |
| wasm | 64 | did not finish inside 70 s | | |

After the fix (control loop owns the buffer; each message consumes exactly itself):

| arm | n | refused with reason | timed out | wall |
| - | - | - | - | - |
| wasm | 64 | 64 | 0 | 9 ms |
| ts | 64 | 64 | 0 | 6 ms |

Raw: `wasm_control_coalescing_e2e.txt`; driver: `lab/scripts/refusals_e2e.mjs`.

**Second observation from the same run, not fixed here.** In the WASM arm the 15 s frame timeout
starts when `waitExactFrame` is *called*, so a batch whose messages are lost times out one waiter
after another (45 s for 4); the TypeScript arm arms all timers at ask time. With F1 in place this
only matters for a server that genuinely never answers. Recorded, not changed: it is an API
semantics choice.

---

## F2 · Corrupt frame table refused when the bundle is opened

**Defect.** `study_bundle::parse_layout` checked that the header and metadata fit the file, but
not the frame table. A bundle whose index pointed past the end of the file, or into the header,
opened cleanly; the corruption surfaced per frame as `FrameError`s while serving.

**Proof.** Two new unit tests (`index_entry_past_file_end_is_refused_at_parse`,
`index_entry_before_data_base_is_refused_at_parse`) fail on the old parser and pass on the new
one; the well-formed case is pinned alongside. `FrameStore::open` now fails with the offending
entry named.

**Decision to make.** This turns "serve the good frames, refuse the bad ones" into "refuse the
bundle". For a store that promises exactness that is the safer default; if partial service is
wanted instead, the check can log rather than fail.

---

## P4 · Per-frame mode kept one finished ack task per frame until the session ended

**Defect.** Every per-frame send spawned `finish().await` into a `JoinSet` that was drained only
in `drain_acks` at session end. A finished task is not freed until it is joined.

**Proof.** `lab/scripts/rss_timeline.sh` samples the server's VmRSS once a second during a 20 s saturate
session (telemetry build, `frames_32k`, D = 4):

| mode | frames served | VmRSS start → end | VmHWM |
| - | - | - | - |
| per-frame, before | 35 044 | 7.2 → **30.8 MB** (linear, ≈ 0.55 KB/frame) | 33.5 MB |
| shared, before (control) | 36 225 | 7.2 → 12.8 MB (flat) | 15.4 MB |
| per-frame, after | 35 474 | 6.7 → 12.5 MB (flat) | 15.3 MB |

Rows: `perframe_ack_reaping_rss.jsonl`. Fix: `try_join_next` after each spawn (one line).

**Near the transport lane?** Only per-frame mode is affected, and L1's own result favours the
shared stream. If per-frame mode is deleted, this goes with it; until then it is a real leak on
the product default (`--stream-mode` defaults to `per-frame`).

---

## C1 · `client/flight-registry` deleted

Zero references outside its own directory (grep over `*.rs`, `*.toml`, `*.ts`, `*.js`, `*.md`).
Both clients keep their own waiter maps. Its `cancel` method is the client-local cancel that
`cleanup-plan-2026-08.md` §2 removed from the clients. Workspace builds and tests green without
it; one `futures` edge fewer in the lock file.

## C2 · `server/src/transport/tls.rs` deleted

`generate_localhost_cert` had no caller (dev certs come from `gen_dev_cert.sh`, which uses
`openssl`). `load_pem_cert` parsed the PEM a second time only to print `cert_sha256`, while
`wtransport::Identity::load_pemfiles` already loads the same two files and
`Certificate::hash` is the same SHA-256 over the DER. The banner now comes from there, through a
nine-line helper. Gone with it: `rcgen`, `time`, `sha2`, `rustls-pemfile`.

| | before | after |
| - | - | - |
| `cargo tree -p exact-server` unique crates | 186 | 175 |
| default release binary | 6 929 192 B | 6 906 944 B |
| `cert_sha256` banner vs `openssl x509 -outform DER \| dgst -sha256` | equal | equal |

Left alone on purpose: `build_endpoint` still loads the identity once per bind attempt. Folding
that into the one load above touches the dual-stack fallback, which L1 is editing.

## C3 · FoD read path decodes the body it already has

`read_fod_msg` read the body, then copied prefix + body into a second `Vec` so `decode_fod_msg`
could re-parse a length it had already checked. `fod::decode_fod_body` decodes the JSON alone; the
framed decoder calls it. `read_exact` moved above the test module (the one clippy warning the
server had). Behaviour unchanged; tests and clippy clean.

## C6 / C7 · Client tidy (small, behaviour-preserving except where stated)

WASM: `Uint32Array::to_vec()` replaces two hand-written copy loops; `request_frame` and
`wait_frame` shared an identical 12-line error-mapping block, now one `settle` method;
`hex.len() % 2 != 0` → `is_multiple_of` (clippy). TypeScript: `requestExactFrame` and
`waitExactFrame` shared the same try/catch, now one `settle` method. Two small behaviour fixes in
the TypeScript client, called out because they are not pure refactors:

- the `errors` map is cleared when a refusal is consumed (it only ever grew);
- `startExactFrames` no longer discards a rejected control write; every bulk waiter fails at
  once instead of at the 15 s timeout.

Checks: `tsc` on product and recorder, `node client/record/test/run.mjs`, the client absence
check, clippy on `transport-wasm`, and the two browser e2e drivers on both arms.

---

## M1 · Product `timing` object — proposal, no code

Both clients return `timing: { askMs, firstChunkMs, lastChunkMs, chunks: 1, serveUs: null }`
where `firstChunkMs === lastChunkMs` by construction (one stamp taken after the whole envelope was
parsed, written to two fields; `session.ts` `toResult`, `session.rs` `result_to_js`). The
transfer term a consumer would compute from it is always zero, and `chunks` is always 1. The
telemetry track already noted this (`followups-later.md` §4) and left it as a product call.

Options, in order of preference:

1. **Reduce to `timing: { askMs, receivedMs }`** — the two stamps that are real. One-line change
   in each client and in `client/harness/shell.js` if it ever reads them (today it does not).
2. Drop `timing` entirely; the external recorder is the measurement path.
3. Keep as is (and document that the transfer fields are placeholders).

Not done here because it changes the client API surface.

---

## Deeper pass — where the CPU actually goes

Asked after the first round: is that really all? Two profiles answer it, one per side.

### Server: instruction profile under callgrind

`exact-server` (release + debug info, HEAD `fb26f7d`, default features) ran under
`valgrind --tool=callgrind` while one `window-harness --mode saturate --depth 4` session drove
it for 6 s; three cells. Instruction counts, so CPU contention does not distort them
(`lab/scripts/callgrind_run.sh`; annotated output in `measurements/…/callgrind_*.txt`).

| share of all instructions | frames_32k / shared | frames_250k / shared | frames_32k / per-frame |
| - | - | - | - |
| ring AES-GCM (`_aesni_ctr32_ghash_6x` + helpers) | ≈ 32 % | ≈ 36 % | ≈ 31 % |
| `memcpy` | 14.0 % | 15.3 % | 13.4 % |
| quinn packet building, stream state, BTree bookkeeping | ≈ 10 % | ≈ 11 % | ≈ 10 % |
| malloc / free | ≈ 1.5 % | ≈ 1 % | ≈ 2 % |
| `exact_server::*` (session loop, pipeline, wire, frame store) | < 0.3 % | < 0.3 % | < 0.3 % |
| serde_json (FoD asks) | 0.06 % | — | — |

`memcpy` attributed to its callers (250 KB cell, `callgrind_memcpy_callers.txt`):

| caller | share of all instructions |
| - | - |
| `quinn_proto … ByteSlice::pop_chunk` — the `write_all(&[u8])` copy into the send buffer | **11.7 %** |
| `StreamsState::write_stream_frames` — send buffer → packet | 1.3 % |
| BTree node moves (quinn range sets) | 1.1 % |

**Reading it.** The server's own code is noise: 99.7 % of the instructions are the QUIC stack
and its crypto, and the one large avoidable term — the copy `write_all` makes — is exactly what
L1's `SendPath::Chunked` removes. This is instruction-level corroboration for L1's default and
the reason P0 was withdrawn rather than kept. Nothing outside the transport lane (packetisation,
GSO, MTU, crypto provider) and the disk lane (prefault) is left on the server worth a commit;
the honest result of the deeper pass on the server is a null.

### Client: Chromium CPU profile, both arms

`lab/scripts/client_profile.mjs` drives a harness cell under the DevTools sampling profiler (200 µs
interval) and ranks self time per function. Three cells: 250 KB fill (shared), 32 KB on-demand
D = 4 (shared), 250 KB fill (per-frame). Product builds; the WASM package is built with
`wasm-pack --profiling` so Rust names survive. First reading (one run per cell, pre-change):

| arm / cell | biggest product-code self time | harness self time |
| - | - | - |
| TS, 250 KB fill | `ByteAccumulator.take` 7 %, `readLengthPrefixed` 6 % — the one receive copy | `heapBytes` 4 % |
| WASM, 250 KB fill | `reader.read` glue 6 %, `Uint8Array.set` (chunk → WASM, WASM → JS) 5 %, `decodeText` 1.6 % | `heapBytes` 3.5 % |
| TS, 32 KB on-demand | `take` + `readLengthPrefixed` 14 %, `sendFod` 5 %, `encodeFodMsg` 5 % | **`heapBytes` 11 %** |
| WASM, 32 KB on-demand | control `write` glue 8 %, `set` 7 %, `read` 5 %, `decodeText` 2 % | **`heapBytes` 9 %** |
| WASM, 250 KB per-frame | `read` 14 %, `set` 5 %, `makeMutClosure` 2.7 %, **`__rdl_realloc` 2.6 %**, `decodeText` 1.9 % | `heapBytes` 1.6 % |

Four things came out of it, each then measured before/after on the same host with the two
builds interleaved (`lab/scripts/client_ab_profile.sh`, summary by
`lab/scripts/client_ab_summarize.py`):

- **H1 (harness).** `performance.memory` was read after every delivered frame to track the
  JS-heap peak; each read walks the heap. Now sampled on a 100 ms timer. Lab code, but it sat on
  the main thread of every client harvest, in both arms.
- **W1 (WASM).** Every `reader.read()` result was unpacked with `Reflect::get(obj, "done")` /
  `"value"`, which encodes those two strings across the boundary per chunk — the `decodeText`
  line. Replaced with the typed `ReadableStreamReadResult` getters.
- **W2 (WASM).** `RecvBuf::push_chunk` zero-filled then copied every chunk, and a fresh buffer
  (every stream in per-frame mode) grew by doubling — the `__rdl_realloc` line. Now reserves once
  the length prefix is known and copies into spare capacity (`copy_to_uninit`).
- **T1 (TS) — null result, kept as tidiness only.** `encodeFodMsg` built a `TextEncoder` per
  ask. Measured in isolation (`lab/bench/textencoder.html`, Chromium 141: 8–11 µs per encode either
  way; Node 22: 1.8 µs either way) the constructor costs nothing observable. The shared codec
  stays because it reads better and gives the TS client the same `decodeFodBody` shape the
  server got in C3, but no speed is claimed for it.

**Result** (same host; the "before" artifacts rebuilt from `fb26f7d` into a side directory,
the two builds swapped in per run; medians of two runs; ms of main-thread self time;
`client_ab_summary.txt`, raw profiles in `client_profiles/`):

| cell / arm | term | before | after |
| - | - | - | - |
| 250 KB fill / TS | harness `heapBytes` | 31.6 | 0.7 |
| 250 KB fill / WASM | `decodeText` · `push_chunk` · harness `heapBytes` | 10.6 · 5.5 · 37.6 | 0.0 · 0.0 · 0.0 |
| 32 KB on-demand / TS | harness `heapBytes` | 126.3 | 0.6 |
| 32 KB on-demand / WASM | `decodeText` · `push_chunk` · harness `heapBytes` | 21.3 · 5.3 · 97.4 | 0.0 · 0.0 · 0.9 |
| 250 KB fill, per-frame / TS | harness `heapBytes` | 21.0 | 1.4 |
| 250 KB fill, per-frame / WASM | `decodeText` · `__rdl_realloc` · `push_chunk` · harness `heapBytes` | 19.3 · 37.4 · 11.4 · 21.9 | 0.0 · 1.4 · 0.0 · 0.0 |

Wall time on localhost is dominated by transfer and moves inside its own noise in the fill
cells (±50 ms on ~650); the on-demand cell, where the harness term was largest, ran
90 ms / 60 ms faster (TS / WASM) in the interleaved pass. The terms above are the proof; the
wall figures are consistent with them and nothing more.

**What is left on the client, with numbers.** After these, the receive path is the browser's
own `reader.read()` glue and the two `Uint8Array.set` copies (chunk → WASM memory, WASM → JS
heap; the TS arm's `ByteAccumulator.take` is its one copy), then `(program)` — Chromium
internals. One more lever exists and is recorded, not taken: a **BYOB reader** on the receive
stream would let the browser fill the frame's final buffer directly and delete the
accumulator copy. Probed (`lab/bench/byob_probe.html`, `byob_probe_result.txt`): Chromium 141
accepts `getReader({ mode: "byob" })` on a WebTransport receive stream; 80 × 250 KB frames took
610 reads (≈ 32 KB each) against 541 with the default reader, 191 ms vs 200 ms. The saving is
bounded by `take` (≈ 8–10 % of client self time in a fill cell, less on demand), it rewrites the
frame loop in both arms, and it has to be checked against the telemetry Proxy, which attributes
bytes per `read()`. A candidate for a later round if client CPU per frame becomes the metric
that matters; not started here.

---

## Also observed, not changed

- `docs/telemetry/adr-server-pipeline.md` said the report schema is `server-pipeline-v1`; the code
  and `telemetry/README.md` say v2. Corrected in the doc with this report.
- `window-harness` carries three clippy warnings (`too_many_arguments`, an unused
  `parse_length_prefixed`, a no-op `saturating_sub(1).max(0)`); L1 owns that crate right now.
- `pack-study` reads every frame into memory before writing it; fine for the sizes in play,
  `io::copy` would stream. Not worth a commit on its own.

## How to re-run

All drivers are in the lab; nothing under `docs/` executes.

```bash
cargo build --release -p window-harness -p exact-server
cargo build --release -p exact-server --features telemetry && cp target/release/exact-server /tmp/a
git checkout <candidate> && cargo build --release -p exact-server --features telemetry && cp target/release/exact-server /tmp/b
lab/scripts/sendpath_ab_bench.sh out.jsonl base /tmp/a cand /tmp/b   # any server A/B (telemetry builds)
lab/scripts/rss_timeline.sh before /tmp/a rss.jsonl                  # server RSS over one session
# browser (server + server/dev-server.py running):
node lab/scripts/refusals_e2e.mjs http://127.0.0.1:8765 wasm 64 https://127.0.0.1:4433/ <cert-sha256>
node lab/scripts/frame0_e2e.mjs http://127.0.0.1:8765 ts
# server instruction profile (build with CARGO_PROFILE_RELEASE_DEBUG=1; needs valgrind)
lab/scripts/callgrind_run.sh head <exact-server-with-symbols> frames_250k shared
# client CPU profile of one arm / cell (WASM: `wasm-pack build --profiling` so names survive)
node lab/scripts/client_profile.mjs http://127.0.0.1:8765 wasm "cell=fill&stream_mode=shared&frames=320" out.json
lab/scripts/client_ab_profile.sh <artifacts-dir> [out-dir]           # before/after, both arms, three cells
python3 lab/scripts/client_ab_summarize.py <out-dir>
# micro-benchmarks / probes (any static host over lab/bench/):
node lab/bench/run_page.mjs http://127.0.0.1:8799/textencoder.html
```

Playwright and Chromium locations default to the Claude Code runner's; override with
`PLAYWRIGHT_MODULE` and `CHROME_BIN`.
