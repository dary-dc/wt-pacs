# Client

Last verified 2026-10-29 (the design state); branches and PRs 2026-11-09.

## Goal

Improve the browser client (transport, decode, cache, paint, telemetry), which a future 2D viewer will sit on. Mobile
on lossy wireless; bit-exact; fill and latency both count.

## State now

* **On `main`:** one downloader worker owns the session; decoders (HTJ2K through OpenJPH-WASM, AV1 through WebCodecs
  or dav1d-WASM) hand pixels to the page in `SharedArrayBuffer`s; the page holds the frame map and posts paints to a
  WebGL paint worker; two product clients (TS and WASM transports). No cache.
* **On `claude/core` (#250, draft, folded 2026-10-30):** the **view worker** as `?view=worker` beside today's
  `?view=page`, which stays the default. The page sends intents (`show`, `setDisplay`, `play`/`pause`, `valueAt`)
  and hears `shown`, `progress`, `failed`. One view worker holds the **controller** (what to want, in what order;
  the cine clock), the **frame store** (memory → OPFS → downloader; the only module that talks to the downloader)
  and the **paint module** (WebGL2, the VOI table, the display state). The OPFS cache (`store.js`) sits behind
  `?writer=`, off by default.
* **Rules of the design:** a frame has two owners, the downloader (owed) and the store (held), and changes owner at
  the ack. A frame is painted before its cache write, and cache writes run off the view worker's thread. The want
  stays ordered down to the wire. A frame is (series, index, version), and the generation steps only on a series
  change. Credits bound unacked frames. Eviction happens only over the byte budget and only for written frames.
* **Measured findings (cloud containers, indicative only):** WebKit's worker clock is a 15 ms timer; V8 counts a
  shared buffer as 0 bytes, so a memory window bounds nothing; async OPFS on one packed file is ruled out.
  Runs that need a quiet owner machine or a phone are owed, with their commands in each result.
* Since 2026-10-30: #289 (a second fold, 15 sources), #299 (a frame decoded twice, fixed), #302 (a repaint before the
  frame is held no longer stops painting), #303 (one-pass AV1 merge ported); none merged into `core`.
* 2026-11-11, `claude/demo-view-worker`: `demo-check.mjs --view worker` passes all 20 demo series under both views
  ([`docs/reviews/view-worker-check.md`](../reviews/view-worker-check.md)); correctness only, which view the demo
  shows is the owner's.

## Open (ordered)

1. The reviewed path of `core` into `main` ([`coordination.md`](coordination.md) §Open 2), carrying the demo work
   ([`optimal-quality.md`](optimal-quality.md)).
2. The cache arm in the view worker, with credits and eviction; the cine clock picking the frame by elapsed time;
   the remaining asking patterns (`docs/adr/frame-path.md` §Target; asking policy #298, proposed).
3. Not scheduled (§Target's open table): misses fragmented into one-frame runs; several viewports on one WebGL2
   context; AV1 groups and previews in the store; a read-back that throws; phones' decoder count.
4. The owner's calls: a series without digests (store `unchecked`, or decode again); exactness after a mismatch
   (block, mark or reveal); the cache's retention policy.
5. The WebGL painter proved on a real GPU.
6. From the PCS contract: `sf.jxl` needs a JPEG XL decoder unless the PACS transcodes; G > 1 for AV1 cine is asked
   of the PCS team ([`codecs.md`](codecs.md)).

## Decisions (the owner's)

* 2026-10-10: an OPFS cache for both web clients, no re-decoding. 2026-10-16: two product clients (TS and WASM).
* 2026-10-23: client telemetry is for production too, sampled.
* 2026-10-28: the view worker is the next target; frames never return to the main thread; VOI is part of paint
  ("paint module"); paint first, then the cache write; the store never decides a paint; the store, not the
  controller, asks the downloader.
* 2026-10-29: the revision taking the red-team review's fixes (ordered want, versioned frames, credits, writes off
  thread, one `failed {scope, reason}`, eviction only over budget).

## Pointers

`client/`, `client/README.md`, `docs/ARCHITECTURE.md`, `docs/CLIENTS.md`, `docs/WIRE.md`, `docs/decode/`;
`docs/adr/frame-path.md` (§Target: the view worker, §The core, assembled on `claude/core`);
`claude/core:client/view/`, `claude/core:lab/opfs-arms/`; PRs #250, #289, #299, #302, #303, #298.
