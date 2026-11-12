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
* 2026-11-12, `claude/names-1` (NAMES-1, for after the merge): NAMES-FIND's renames, one per commit. Glossary rows
  for downloader, consumer, refusal, route, quality label, mark, overlay and status line; the optimal-quality
  *picture*, never a *view*; `info.path` → `info.route` (status line `routes:`); `showLossy` → `showOptimal` (the
  metadata key `lossy` stays); `depthCut`/`cut` → `cutShift`; `requestExactFrame` → `requestFrame`. Nothing decoded,
  checked or painted changes; the gate and `demo-check.mjs` in both views are its evidence.

* 2026-11-12, `claude/clean-2` (CLEAN-2, a draft for after the core merge): what CLEAN-FIND, DEFAULTS-FIND and
  OPT-SIMPLIFY found that CLEAN-PRODUCT left: one starter for the demo pair (`scripts/demo-pair.sh`, which
  `demo-check.mjs` runs too); the product build bundles the WebTransport session alone; `?trace=`, `?settle=` and
  `?after=` behind `head.js`'s lab gate; the check's cine as `?check=cine`, so `?cine=` is the lab's alone; a lab
  `?opts=` can no longer turn the frame check off. No lab lever removed: each is named by a check or a rig
  (`client/viewer/run_check.sh`, `lab/av1/delivery/total-time/run.mjs`), so none is S7's candidate yet.
* 2026-11-12, `claude/unified-client` (UNIFY-CLIENT, a proposal into `claude/core`): the line's unified branch,
  from the demo tip `claude/demo-fixes-2` (`18d2d1ff`), with `claude/clean-product`'s review record, CLEAN-2 (#375) and
  NAMES-1 (#374) merged `--no-ff`, NAMES-1 last; no conflicts. Left out with their reasons in its PR body: #376 and
  #378 (await their review), #368–#370 and #377 (separate proposals), and the rest of LINES-READY §7.
  UNIFY-REVIEW (2026-11-12): the merge record holds, CLEAN-2's code reaches the tip unchanged, no old name in it;
  one NAMES-1 miss, `lab/faultbench/index.html` reading `info.path` (now `info.route`), left as a finding in #382.

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
