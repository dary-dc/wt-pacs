# Improvements outside the transport and disk lanes — evidence for review

**Date:** 2026-09-06 · **Branch:** `claude/project-improvements-lab-pmohec` · **Status:** every
item below is a candidate; nothing is accepted until reviewed. One commit per candidate so each
can be taken or dropped alone.

**Scope rule.** Transport policy (stream mode, QUIC knobs, the session loop shape, the shaped rig)
is lane L1 (`cursor/l1-loss-run-dbae`); disk access (prefault, `pread`, the read path) is
`claude/disk-access-adr-validation-saz6m8`. Neither branch touches the files changed here
(they add workspace members in `Cargo.toml`; that merge is trivial). One candidate (P0) turned out to be already
implemented on L1 and was withdrawn; two items sit next to a lane and say so.

**Evidence tier.** Everything measured here is **T2-local**: one 4-core VM, localhost, no
shaping, both sides sharing the CPU. Relative comparisons only; A/B runs interleave the two
binaries in every cell so drift lands on both. Raw rows and the scripts are in
[`measurements/improvements-2026-09-06/`](measurements/improvements-2026-09-06/).

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

---

## P0 · Zero-copy send path — withdrawn, already on L1

The first version of this branch carried a zero-copy send path (`Bytes::from_owner` over the
mapping + `quinn::SendStream::write_all_chunks`). It was measured here at −27 % / −55 %
`send_us` p50 (32 KB / 250 KB frames, shared mode, localhost A/B) and then **found to be
already implemented on `cursor/l1-loss-run-dbae`** as `SendPath::Chunked`, the default there
(`server/src/transport/tuning.rs`, `docs/send-path-copy-costs.md` on that branch). The commit was
dropped from this branch to avoid a duplicate and a merge conflict; the independent measurement
agrees with L1's direction and is recorded here only as corroboration. `sendpath_bench.sh` stays
in `measurements/` because it is the generic A/B harness the other server items use.

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

Raw: `wasm_control_coalescing_e2e.txt`; driver: `refusals_e2e.mjs`.

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

**Proof.** `rss_timeline.sh` samples the server's VmRSS once a second during a 20 s saturate
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

## Also observed, not changed

- `docs/telemetry/adr-server-pipeline.md` said the report schema is `server-pipeline-v1`; the code
  and `telemetry/README.md` say v2. Corrected in the doc with this report.
- `window-harness` carries three clippy warnings (`too_many_arguments`, an unused
  `parse_length_prefixed`, a no-op `saturating_sub(1).max(0)`); L1 owns that crate right now.
- `pack-study` reads every frame into memory before writing it; fine for the sizes in play,
  `io::copy` would stream. Not worth a commit on its own.

## How to re-run

```bash
cargo build --release -p window-harness
cargo build --release -p exact-server --features telemetry && cp target/release/exact-server /tmp/a
git checkout <candidate> && cargo build --release -p exact-server --features telemetry && cp target/release/exact-server /tmp/b
docs/measurements/improvements-2026-09-06/sendpath_bench.sh out.jsonl base /tmp/a cand /tmp/b   # any server A/B
docs/measurements/improvements-2026-09-06/rss_timeline.sh before /tmp/a rss.jsonl
# browser: server + server/dev-server.py, then
node docs/measurements/improvements-2026-09-06/refusals_e2e.mjs http://127.0.0.1:8765 wasm 64 https://127.0.0.1:4433/ <cert-sha256>
```
