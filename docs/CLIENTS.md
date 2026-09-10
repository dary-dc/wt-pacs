# Client transports

| Path | Role |
|------|------|
| `client/transport-wasm/` | Rust WASM via `web_sys::WebTransport` |
| `client/transport-ts/` | TypeScript / browser ESM (`session.ts` + `wire.ts`; `build.sh` → gitignored `dist/`) |

Same Media-complete wire as the server: FoD on one bidi control stream, envelope payloads on server uni streams.

## Ask before waiters

`startStreamFrames` / `startExactFrames` used to arm a 15 s timer per index, then write
the FoD ask. The write could not flush until that loop yielded, so fill first-useful-byte
waited on `O(n)` `setTimeout` work. Both arms now record the range or index list, queue
the write, and arm a waiter only in `waitExactFrame`. Media that arrives first is held
until that wait (not `droppedEarlyMedia`).

`connect` no longer awaits `ready` before `createBidirectionalStream` — the stream open
is allowed to sit in the first flight. The harness starts the WebTransport as soon as
`/wt/dev-transport.json` returns, in parallel with module/`init()` load.

### Time to queue a fill ask — Node 22, interleaved

One `startStreamFrames(n)` vs the old arm-all-then-write loop. Six repeats, arm order
reversed every repeat. Latency of the call that must finish before the ask can leave;
not throughput. T2-local (this runner).

| n | old arm-all p50 | new `startStreamFrames` p50 |
| - | --------------: | --------------------------: |
| 8000 | 7.24 ms | 0.05 ms |

Sorted repeats (ms): old 2.96 · 3.35 · 6.35 · 7.24 · 9.43 · 12.93; new 0.03 · 0.04 · 0.04 · 0.05 · 0.09 · 0.12.
The host is a 4 vCPU VM; nothing is claimed past it. Handshake-overlap vs wasm `init()`
was not timed in Chromium here.

Tests: `client/transport-ts/test/session.test.ts` (mutated: arm-first fails the timer
count; drop-early hangs the delivery claim; `await ready` first fails the ready-gate).

## Not retried

`claude/serene-rubin-wakfg7` already closed, on a real box: fat LTO (landed),
`aws-lc-rs` (tie or loss), Chromium `max_udp_payload_size` (peer advertises 1472),
fill `posix_fadvise` (shipped). This hunt does not touch store/disk, QUIC knobs,
parse, or sched hops.
