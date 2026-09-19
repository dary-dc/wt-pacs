# T5 — The client off the main thread: a Worker, and BYOB reads

**Status:** open · **Needs:** the browser rig · **Size:** two days, one browser campaign

## Question

Main-thread contention costs 10–50 ms of tail in the survey's ranking; on this repository's
browser rig the page took 28.9 ms per frame to accept a decoded result and the decode queue
set a fill's finish (`docs/rig-limits.md` §2 on the `docs/rig-limits` branch). A Worker removes
renderer-side contention only: the network-service hop (renderer ↔ network process over Mojo)
stays, and Chromium's per-datagram receive cost with it. BYOB reads on the media stream delete
the accumulator copy, bounded at 8–10 % of client self time in a fill
([`../improvements/README.md`](../improvements/README.md)).

## Decision rule

Interleaved browser campaign, six repeats, main thread against Worker, both with and without
BYOB, all-received and all-decoded reported separately: adopt the Worker if p95 gesture-to-
on-screen improves by 10 % or more, or the main thread's busy share drops 30 % or more, with
no loss in all-received. Adopt BYOB on its own on the same rule for CPU per frame.

## Steps

1. **Worker wrapper.** `client/transport-ts/worker.ts` runs `TransportSession` inside a
   Worker; the page-side handle mirrors the API (`requestExactFrame`, `startStreamFrames`,
   `endStream`, `stats`) over `postMessage`, frames crossing as transferable `ArrayBuffer`s so
   no copy is added. The window (T1) lives in the Worker with the session.
2. **BYOB.** `pumpFramedStream` reads with `getReader({ mode: "byob" })` into the frame's final
   buffer once the length prefix is known, with a buffer of at least 64 KiB so one `read()`
   returns many packets' worth; drain in a loop and hand frames off in batches rather than
   awaiting per chunk. Chunk sizes differ by browser — measure them, do not assume packets.
   Measured in Chromium 141 ([`T12`](T12-browser-receive.md) §4): the default reader coalesces
   up to 256 KB, ~5 reads for a 250 KB frame and under one for a 32 KB frame, so a BYOB read
   per frame is fewer reads only for large frames. The telemetry proxy attributes bytes per
   `read()`, so check it still does.
3. **Campaign** on the browser rig with the harness (`ts.html`) driving both shapes, the
   `fill` and `ondemand` cells at 32 KB and 250 KB.
4. If the decoder also moves to a Worker, decode belongs beside the session, not on the page.

## Report

Per cell and arm: all-received, all-decoded, p95 gesture-to-on-screen, main-thread busy ms,
CPU per frame. In `docs/CLIENTS.md`.

## Stop conditions

Transferables copying (a `SharedArrayBuffer` or a structured clone in the profile) — the
wrapper is wrong before the numbers mean anything.
