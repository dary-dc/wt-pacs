# Client

Last verified 2026-11-12 against the demo tip `claude/demo-fixes-2` `18d2d1ff` (PR 367), the queue's status files
(`claude/work-ledger:docs/queue/`) and the open PRs.

## 1. Goal

The browser client (transport, decode, cache, paint, telemetry) that a 2D viewer will sit on: fast fills and low
on-demand latency on a phone over lossy wireless, every exact frame bit for bit, and only checked claims on screen.

## 2. On `main` after this week's merge

What PR 367 (the demo tip into `claude/core`) then PR 250 (`claude/core` into `main`) carry, once the owner gives
the two words. Until then all of it is on `claude/demo-fixes-2`, none on `main`.

* **Transport** (`client/transport/`): one downloader worker owns the WebTransport session; two product clients, TS
  and WASM, chosen by the transport file (`docs/CLIENTS.md`). A frame asked during a fill is decoded once (#349).
* **Decode** (`client/decode/`): HTJ2K through OpenJPH-WASM; AV1 through WebCodecs first and dav1d-WASM only where
  WebCodecs refuses a config or fails (`av1-probe.js`, `client/README.md` §Which decoder, per payload); every exact
  frame checked with XXH3 against the series' digests; a D > 10 optimal-quality series is the depth cut to 10 bits.
* **Two views** (`client/view/`, `client/viewer/`): `?view=page` (the default) and `?view=worker`. One controller
  (`view/controller.js`) holds the want and the current frame over one frame store (`view/store.js`) in both; under
  `worker` they and the paint module run in the view worker and the page only sends intents and hears `shown`,
  `progress`, `failed` (`docs/adr/frame-path.md` §3, *Built*; §Target). WebGL2 paint with the VOI table
  (`client/paint/`). The frame clock (`view/clock.js`) is kept by default (CLEAN-PRODUCT item 11, open below).
* **Optimal quality** (`client/README.md` §Optimal quality, exact on request; line [`optimal-quality.md`](optimal-quality.md)):
  the pair checked by `pair.js` on the ingest's `sourceFingerprint`; the label *Optimal quality* (green), *✓
  Lossless* (blue), *Lossless check failed* (red), words always beside the colour (`viewer/screen.js`); `l` or the
  button asks the exact frame; a tap unfolds the status line; the slice slider (`viewer/slider.js`) in both views.
* **No client cache by default.** The OPFS cache (`view/cache.js`, writers `store`, `decoders`, `view`) is reached only
  through the lab's `?writer=` under `?view=worker`.
* **Lab levers out of the product**: every lab URL parameter loads from `lab/viewer/levers.js` and
  `lab/viewer/hooks.js` through `head.js`'s gate; the web image refuses them by name (`viewer/crafted.mjs`), ships no
  check module, and `scripts/check_lab_absent.sh` fails the gate when a product path imports `lab/`.
* **Checks**: `client/viewer/check.mjs`, `demo-check.mjs --view page|worker` (40 of 40 at FREEZE-E2E,
  `docs/reviews/freeze-e2e.md`), the node tests under `client/`, `scripts/gate.sh`.

## 3. Decided (never reopened by an agent)

| decision | date | recorded |
| --- | --- | --- |
| An OPFS cache for both web clients, no re-decoding | 2026-10-10 | `docs/adr/frame-path.md` §Proposed: the client cache in OPFS |
| Two product clients, TS and WASM | 2026-10-16 | `docs/CLIENTS.md` |
| Client telemetry is for production too, sampled | 2026-10-23 | this file since that date; the design: `claude/telemetry-client:docs/adr/telemetry-in-production.md` (PR 370) |
| The view worker's shape: frames never return to the main thread; VOI is part of paint; paint first, then the cache write; the store never decides a paint; the store, not the controller, asks the downloader | 2026-10-28 | `docs/adr/frame-path.md` §Target |
| The red team's revision: an ordered want, versioned frames (series, index, version), credits, writes off thread, one `failed {scope, reason}`, eviction only over budget | 2026-10-29 | `docs/adr/frame-path.md` §Target, §Review |
| WebCodecs decodes the optimal-quality view; dav1d only after a refusal or a failed decode at ≤ 10 bits, the overlay naming the route and why | 2026-11-11 13:30 | `claude/work-ledger:docs/queue-2026-11-10.md` §Decided approaches |
| The page view stays; which view is the target is decided after the phone runs | 2026-11-11 13:30 | same file, the owner's decisions |
| Target: mobile on lossy wireless; no TCP for the fill unless proven; fill and on-demand latency optimized separately for now; resilience is phase 2, parked | 2026-11-11 | same file, §Decided approaches |
| Nothing reaches `main` uncleaned; lab code never inside product modules (the absence check) | 2026-11-11 17:30 | [`coordination.md`](coordination.md) §Decisions |
| Telemetry off by default (rate 0); the frame clock kept; PRs 368, 369, 370 stay separate proposals | 2026-11-11 21:30 | the queue file, the owner's decisions |

## 4. Open, ranked

Fixtures for every cloud result below: three DBT volumes (`dbts_a1`, `dbts_b1`, `dbts_c1`) of one dataset, no breast
ultrasound cine, 4-core cloud hosts without a GPU (SwiftShader), loopback or a userspace relay, not a radio. The
phone run: one phone, one home link, one evening (`claude/phone-rows:docs/phone-rows/README.md`).

1. **A failed Lossless is not retried** (phone load 6: after a fill with 7 % loss the exact session shows a handshake
   only, the reader left on *Lossless check failed*). Matters: the on-demand ask is the product's promise on a lossy
   link. Decides: the exact session's lifecycle traced in code, a reproduction through `lab/scripts/link_impair.py`
   (labelled simulated), a failing test, the fix. Row LOSSLESS-UNDER-LOSS, then PHONE-FIX-REVIEW.
2. **A hidden page loses its decoder mid-group and never recovers** (load 13: 29 of 50 frames). Decides: WebCodecs'
   reclamation text and Chromium's code quoted, a failing test, the fix; the beacon recording visibility changes.
   Row HIDDEN-PAGE-DECODE, then PHONE-FIX-REVIEW.
3. **Which view is the target.** Phone run: worker against page depends on the controller on the tether (medians
   0.960 under `cubic-restart`, 1.016 under `bbr`), no difference shown on Wi-Fi (n = 10); no cloud measurement shows
   the worker faster; both pass every correctness check. Decides: the next phone round, its amendment written by a
   session that will not run it (`docs/devices.md` §7), the fill as the beacon defines it. The owner's, after
   PHONE-BLIND-READ (`claude/phone-rows:docs/reviews/phone-blind-read.md`). One worker run of
   `dbts_a1-q8-g16-cut` failed once in 40 at CLEAN-PRODUCT and passed 6 of 6 reruns: unexplained.
4. **What bounds a fill on the phone.** Wire time is 0.5–1.0 s of a 2.4–3.3 s fill. Decides: the beacon's per-frame
   decode times and the page's timeline split; say where the phone saturates. Row FILL-SPLIT.
5. **The OPFS cache, decided but off.** No arm passed on Chromium or Firefox (#285); who writes (store worker,
   decoders, a sync handle) and frame memory (slots or disk-only) stay open (`docs/adr/frame-path.md` §Target, the
   open table). Decides: the arms' cells with arm D and a window drag during a fill (OPFSARMS), M5 with a disk-only
   arm (FRAMEMEM). Also: `client/README.md` §The viewer, *Frames*, says a store worker writes every checked frame
   by default; no product module loads it (only `?writer=store`): correct in place.
6. **Client telemetry in the product** (PR 370, the load report: one `sendBeacon` per sampled load, at hide; 4.9–6.6 KB
   on the fixtures; nothing timed). Owed: a review row by a session that did not write it, then §5's cost and
   delivery runs. The owner's: sample rate, sink, retention.
7. **dav1d fetched only when needed** (P6 on `claude/proposals`: −0.24 to −0.64 MB per accepting page, assumption).
   Decides: P6's protocol with R0's A/A arm (R5, not started by MEASURE-2). A phone's WebCodecs AV1 probe is not on
   record.
8. **A wake before `l` asks** (P3, rebuilt as R3 on `end_stream` alone): −103 and −105 ms in the plumbing cell; the
   phone row owed.
9. **The integrity and coding-error check on the label** (PR 368, I1–I3): the owner's; line
   [`optimal-quality.md`](optimal-quality.md).
10. **Cleaning and names after the merge**: CLEAN-2 (one starter for a pair, the unreachable ws and race bundles out
    of the image, lab levers out of the connect options) and NAMES-1 (`requestExactFrame` → `requestFrame` last),
    each a draft PR with a review row; both ride `claude/unified-client` last, each its own merge
    (`claude/lines-ready:docs/reviews/lines-ready.md` §7).
11. **The rest of §Target's open table**: the clock picking the frame by elapsed time and pausing on `hidden` (WebKit's
    worker clock is a 15 ms timer); misses fragmented into one-frame runs; several viewports on one WebGL2 context;
    an AV1 group as the store's unit; a read-back that throws; the decoder count on phones; the asking patterns
    (#298, proposed). Each with what decides it in that table.
12. **The WebGL painter on a real GPU**, and engines beyond Chromium: Firefox and WebKit refuse WebCodecs AV1 on
    record (every frame through dav1d on an iPhone).
13. **The owner's calls on exactness and the cache**: a series without digests (store `unchecked`, or decode again);
    exactness after a mismatch (block, mark or reveal); the cache's retention; `persist()`
    (`docs/adr/frame-path.md` §8).
14. **From the PCS contract**: `sf.jxl` needs a JPEG XL decoder unless the PACS transcodes; G > 1 for AV1 cine is
    asked of the PCS team ([`codecs.md`](codecs.md)).

Measured findings that bound these (indicative, cloud only): V8 counts a shared buffer as 0 bytes, so a memory window
bounds nothing; async OPFS on one packed file is ruled out (`docs/adr/frame-path.md`, the cache I/O section of 2026-10-28).

## 5. Unsupervised

An agent may, without the owner: write theory and pre-registered protocols; run them on cloud hosts within the
fixtures above (`CLAUDE.md` §Measurement, the protocol written by another session); build a fix or a proposal as one
branch and one draft PR per question, from `main` once it holds the core design (from `claude/unified-client` where
it needs that), a failing test first and mutated, the gate green, `demo-check.mjs` in both views; review another
session's PR as a review row. Items 1, 2, 4, 6's review, 7, 8's cloud cells and 10 are of this kind.

Waits for the owner: any merge; any removal (the frame clock's: `git revert 24b80bcd`, [`coordination.md`](coordination.md)
§Open 7); which view is the target; turning the cache or telemetry on, and telemetry's rate, sink and retention;
the exactness calls of item 13; anything structural (the downloader merged into the view worker, the lab workspace
split); any change to §3. Phone runs are the phone session's, on the owner's device.

## 6. Pointers

`client/README.md` (§Optimal quality, §The viewer), `docs/ARCHITECTURE.md`, `docs/CLIENTS.md`, `docs/WIRE.md`,
`docs/decode/`, `docs/devices.md` §7, `docs/adr/frame-path.md` (§3, §7, §8, §Target);
`docs/reviews/view-worker-check.md`, `docs/reviews/freeze-e2e.md`, `docs/reviews/experiments-off.md`;
`claude/proposals:docs/lines/proposals.md` (P3, P6, R3, R5), `claude/phone-rows`, `claude/lines-ready`;
PRs 367, 250, 368, 369, 370, 298, 285.
