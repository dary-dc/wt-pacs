# Follow-ups (later — do not start now)

Parking lot after landed client C1–C4 and server S1–S5. As-built contract: [`README.md`](README.md).
Seams: [`adr-instrument-clients-from-outside.md`](adr-instrument-clients-from-outside.md) ·
[`adr-server-pipeline.md`](adr-server-pipeline.md).

**Pause:** understand the streaming attributor, report fields, and the
`attribution` / `clock` / `rows` / `report` / `tap` split before picking anything below.

---

## 1 · Client surface compression (was C5)

**Status:** parked — **low value / maybe never**.

Would only trim Proxy/entry boilerplate. Does not improve measurements or the product boundary;
a generic proxy factory can make *which* method is tapped harder to see. Revisit only if already
editing `proxy.ts` for a real bug or new stream shape.

---

## 2 · Product WASM receive buffer (`session.rs` RecvBuf)

Product copy reduction, not telemetry. Later: ask whether a simpler / less-code equivalent keeps
the same win. **Do not redesign now.**

---

## 3 · Product send path (P3 → P4 → measure P2 → maybe P1)

**Deferred.** Not telemetry. Order: small wire/ack wins first, then measure batch prefault, only
then consider overlapping prefault with send (the only item that changes the serial pipeline story
in the server ADR).

| # | Change | Risk | Status |
| --- | --- | --- | --- |
| **P0** | Codestream as a `Bytes` handle over the mapping, one `write_all_chunks` — no full-frame copy | Low | **on `cursor/l1-loss-run-dbae`** as `SendPath::Chunked` (default there); measured independently in [`../improvements/2026-09-06.md`](../improvements/2026-09-06.md) |
| **P3** | One 8-byte header write instead of two 4-byte awaits | Low | covered by L1's chunked path (the header is one chunk) |
| **P4** | Reap acks incrementally each send (`try_join_next`) | Low | **done 2026-09-06**, candidate for review |
| **P2** | Batch prefault for one `RequestFrames` (one `spawn_blocking`) | Low — measure | disk track |
| **P1** | Overlap prefault(k+1) with send(k) | Medium — ADR story change | disk track |

P1 and P2 are alternatives, not a sequence. Full-frame `wrap()` copy is already gone.

---

## 4 · Product `timing` object on both clients

**Status:** parked — product call.

`FrameResult.timing` (`session.ts` `toResult`, `session.rs` `result_to_js`) still reports
`chunks: 1` and `firstChunkMs === lastChunkMs`: a single stamp after the whole envelope was
parsed, written to both chunk fields. With the external recorder it is product code emitting a
measurement that is wrong. Either drop `timing` from the product API or reduce it to
`receivedMs`. Not telemetry; the harness no longer prints it.

## 5 · Build artifacts (reminder)

| Artifact | Source | In git? |
| --- | --- | --- |
| `dist/session.js` | `session.ts` | **No** — gitignored |
| `dist/session.telemetry.js` | `session-telemetry.ts` (+ `client/record/`) | **No** — gitignored |
| `client/record/dist/` | `install.ts`, etc. | **No** — gitignored |

Rebuild: `client/transport-ts/build.sh`.

## 6 · Server telemetry at scale — pending after the 2026-09-06 track

Review and numbers: [`analysis-scale-and-serving-path-2026-09-06.md`](analysis-scale-and-serving-path-2026-09-06.md).
As-built: [`README.md`](README.md). Nothing below blocks a merge.

| # | Item | What is needed | Owner / when |
| --- | --- | --- | --- |
| T7 | Shaped rig run, per-frame mode: `send_us` under real flow control; the only proof still owed | rig key (`cloud-rig-access.md`) | telemetry, when the rig is free |
| S2 | Single UDP socket / endpoint driver ceiling (`build_endpoint`); `quinn` scales with several endpoints on `SO_REUSEPORT` sockets | aggregate Mbit/s vs *N* on a box where the clients are not the bottleneck; **unmeasured, do not change first** | telemetry + server |
| S9 | Per-frame `spawn_blocking` prefault: 60–120 µs of `serve_us` per frame and about a fifth of default server CPU on a resident fixture; the blocking pool (512 threads) bounds cold reads at thousands of sessions | resident-page fast path, batched prefault (§3 P2) or overlap (§3 P1); evidence is the `prepare_us` column in the review §4.3 | disk track (`docs/disk-access/`) |
| `ack_us` | Server-observed delivery stage, built and withdrawn; smallest shape recorded in the review §2 | only if a server-side delivery number is ever wanted; delivery timing comes from the client report and the native harness until then | product call |
| Defaults | Set on 2026-09-06 without a product answer, changeable by env: summary rewrite `WTPACS_TELEMETRY_SUMMARY_MS=5000`; inline row cap `WTPACS_TELEMETRY_INLINE_CAP=1000000`; sampling `WTPACS_TELEMETRY_SAMPLE=1` (every session) | confirm or change | product call |
| Hardening | Kept: FoD message length capped at 4 MiB (`MAX_FOD_LEN`); QUIC knobs `--send-window-bytes`, `--stream-receive-window-bytes`, `--max-idle-timeout-ms` with library defaults. A production `send_window` is a capacity decision from link BDP | pick production values when there is a deployment | product |
| Schema | Client / server stage vocabulary unification stays deferred (README) | — | telemetry |
| S10 | Admission control at accept | — | production hardening |

