# The client's design

The browser client as it is designed now: what it is, its rules, what is decided and what is open. What the product
is for is [`../ARCHITECTURE.md`](../ARCHITECTURE.md) §The product. The reasons and the numbers are in
[`evidence/`](evidence/), one file per question; the work in flight is [`../lines/client.md`](../lines/client.md).
This file is rewritten in place when a result or a decision moves it, never appended to (`CLAUDE.md` §Docs).

## What it is

```
page (UI only) ── show(i) · setDisplay · play · pause · valueAt ──►  view worker
               ◄── shown {i, exact, reason} · progress · failed {scope, reason} ──
                                                                 ├ controller    what to want, in what order; cine clock
                                                                 ├ frame store   memory → OPFS cache → downloader
                                                                 └ paint module  WebGL2, the VOI table, display state
downloader worker ◄── want {ordered misses} · ack ──────────────── frame store
  session · a record per owed frame · the wire
  └ decoders (nested workers) ── frame {SharedArrayBuffer, exact} ──► frame store
exact series: a second downloader, one decoder, no fill ── the exact frame ──► held beside the store
cache writes: off the view worker's thread (a store worker or the decoders), behind a lab setting
```

| module | owns | `?view=page` (the default) | `?view=worker` |
| --- | --- | --- | --- |
| downloader | the session, a record per owed frame, survival, the wire; the want's misses sent as asks or runs | its worker | its worker |
| decoders | decode; the XXH3-64 check against the ingest's digest; the samples written once | nested workers of the downloader | the same |
| controller | the current frame, the want and its order, the cine clock, the quality label | the page | the view worker |
| frame store | where a frame comes from: memory, then the cache, then the downloader; acks a frame once held | the page, no cache | the view worker; the cache under the lab's `?writer=` |
| paint | WebGL2, the VOI table, window, invert, pose | the paint worker | a module of the view worker |
| pairing | an optimal-quality series and its exact series, refused by name unless of the same source | the page (`viewer/pair.js`) | the same |

Built on `claude/unified-client`: both views, the pairing, WebCodecs first for AV1 with dav1d-WASM after a refusal,
the label and the exact frame on request. Behind a lab setting only: the cache and its writers, the ring of slots,
transferred buffers, `waitAhead`, `span`, the frame clocks. Native has the same modules on threads
([`../native/README.md`](../native/README.md) §Built). The modules and settings, with each one's status:
[`evidence/core-against-main.md`](evidence/core-against-main.md). The page's code: [`../../client/README.md`](../../client/README.md).

## Rules

* One owner per frame: the downloader owns what is owed (asked, in flight, decoding, unacked), the store what is held; it changes owner at the ack.
* No frame is lost silently: a crash, an unreadable delivery or a decode that never returns ends in a re-decode or a loud failure.
* The controller decides what is wanted; the store decides from where; only the store talks to the downloader.
* The want stays ordered down to the wire; the server does not reorder ([`../adr/reject-server-ordering.md`](../adr/reject-server-ordering.md)).
* A frame is (series, index, metadata version); the generation steps only when the series or its version changes.
* At most `K` frames are dispatched and unacked (credits), so a full store reaches the wire as a pause.
* A frame leaves memory only over the byte budget, only once written, farthest from the current frame first.
* Under `worker` no frame, pixel or port reaches the page; VOI is part of paint.
* Paint first: the frame on screen is painted before its cache write, and no write runs on the view worker's thread.
* An exact frame is checked against its ingest digest before it is handed on; a frame not checked `true` is never shown as exact.
* The cache stores only frames checked `true` and re-checks each on read; a failed read is a miss, asked again.
* An optimal-quality frame is `unchecked`; *✓ Lossless* is shown only on the paint of an exact frame checked `true`.
* The exact frame is held beside the store, never in it and never cached; asking it changes nothing else.
* Every option still under investigation is a setting whose default is the tip's behaviour, until its rule decides it.
* Lab settings never load in a product module, and the web image refuses them by name.

## Decided

| choice | date | whose | evidence |
| --- | --- | --- | --- |
| An OPFS cache for both web clients, no re-decoding | 2026-10-10 | the owner | [`evidence/cache-in-opfs.md`](evidence/cache-in-opfs.md) |
| The page stays in the pixel path unless a measured cost says otherwise; the checks stay on, the cache read's re-check included | 2026-10-11 | the owner | [`evidence/page-out-of-pixel-path.md`](evidence/page-out-of-pixel-path.md) §8 |
| Two product clients, TS and WASM | 2026-10-16 | the owner | [`../CLIENTS.md`](../CLIENTS.md) |
| Client telemetry is for production too, sampled | 2026-10-23 | the owner | `claude/telemetry-client:docs/adr/telemetry-in-production.md` |
| The view worker's shape: frames never return to the main thread; VOI part of paint; paint first, then the cache write; the store never decides a paint; the store, not the controller, asks the downloader | 2026-10-28 | the owner | [`evidence/view-worker-design.md`](evidence/view-worker-design.md) §Target |
| The red team's revision: an ordered want, versioned frames, credits, writes off thread, one `failed {scope, reason}`, eviction only over budget | 2026-10-29 | the owner | [`evidence/view-worker-design.md`](evidence/view-worker-design.md) §Review: the red team |
| Build the core architecture with the simple cine only, on one branch; every option a setting defaulting to today | 2026-10-30 | the owner | [`evidence/core-against-main.md`](evidence/core-against-main.md) §The core, assembled |
| `?view=page` stays the default: the view worker's first frame is later by ≥ 16.7 ms in five decided cells | 2026-10-30 | the rule, measured | [`evidence/page-out-of-pixel-path.md`](evidence/page-out-of-pixel-path.md) §7; [`evidence/view-worker-start.md`](evidence/view-worker-start.md) |
| WebCodecs decodes the optimal-quality view; dav1d only after a refusal or a failed decode at ≤ 10 bits, the overlay naming the route and why | 2026-11-11 | the owner | [`../../client/README.md`](../../client/README.md) §Which decoder, per payload |
| The page view stays; which view is the target is decided after the phone runs | 2026-11-11 | the owner | `claude/work-ledger:docs/queue-2026-11-10.md` |
| Mobile on lossy wireless; no TCP for the fill unless proven; fill and on-demand latency optimized separately; resilience parked | 2026-11-11 | the owner | the same |
| Telemetry off by default (rate 0); the frame clock kept | 2026-11-11 | the owner | the same |
| One home per subject, `docs/<subject>/` (this file, the page, `evidence/`), and the product statement's framing | 2026-11-14 | the owner | `CLAUDE.md` §Docs; [`../ARCHITECTURE.md`](../ARCHITECTURE.md) §The product |
| Exactness failures are a safety report, not telemetry: always on, never sampled, no pixels or patient data, the load report's endpoint and format; on a mismatch the second decode first, then the frame blocked, the reader told in that frame's view and the report sent at once. The sampled load report alone follows the rate | 2026-11-14 | the owner | [`../adr/exactness-in-production.md`](../adr/exactness-in-production.md) §4, §8 |
| The cache: survey the options before designing further; OPFS continues only if it comes out best | 2026-11-14 | the owner | *Open: where the cache keeps frames*, below |
| The delivery comparison is theory first, measured as calibration (*Open*, below); transport is another subject | 2026-11-14 | the owner | below |

## Open

Fixtures for every cloud result below: three DBT volumes (`dbts_a1`, `dbts_b1`, `dbts_c1`) of one dataset, no breast
ultrasound cine, 4-core cloud hosts without a GPU (SwiftShader, software WebCodecs), loopback or a userspace relay,
not a radio. The phone results: one phone (Chrome 157), one home link, one evening
(`claude/phone-rows:docs/phone-rows/README.md`).

**The delivery comparison.** Arm A the optimal-quality view only; arm B HTJ2K lossless only; C1 the approach (the
optimal-quality fill, then an exact frame on request: an on-demand latency); C2 the optimal-quality fill, then the
whole exact series, measured, not summed. *Theory:* fill ≈ max(bytes × 8 ÷ bandwidth, frames × decode per frame ÷
decoders) + rest; the optimal-quality series is ~0.07–0.22 of the exact series' bytes, so A and C1 win where the link
binds and lose their margin where decode binds. *Decides:* per load, wire time, decode floor, rest, the decoder route
taken and bytes; phone CPU per process; server egress and CPU; rendering fixed, arms interleaved; the calibrated home
Wi-Fi, then a sweep toward cellular and congested Wi-Fi with random loss, each link profile labelled measured or
assumed, then the phone at the points where an arm's regime changes. One table per link profile, kept in the
repository. *So far:* none run; the protocol is not written.

**Where the cache keeps frames.** OPFS (sync handles in a dedicated worker, or `createWritable`), IndexedDB, Cache
Storage, Storage Buckets, memory only; decoded samples (~17 MB a `dbts_b1` frame, no decode on reopen) or coded bytes
(a decode on every reopen, which the 2026-10-10 rule excludes). *Decides:* the survey from specs and engine sources,
then its deciding measurement. *So far:* no writer arm passed on Chromium or Firefox
([`evidence/cache-io-thread.md`](evidence/cache-io-thread.md) §Arm D, Results); async OPFS on one packed file is
ruled out; V8 counts a shared buffer as 0 bytes, so a byte window bounds nothing
([`evidence/frame-memory-ownership.md`](evidence/frame-memory-ownership.md)); the ring of slots qualifies on Chromium
only. The cache stays off.

**What bounds a fill on the phone.** *So far:* the decode, 133–135 ms a frame over three decoders, 0.76–0.94 of every
fill; the wire 0.5–1.0 s of a 2.4–3.3 s fill (one series, `dbts_b1` Q 8 G 8). The product asks WebCodecs for
`prefer-software`, a hint; the decoder Chrome took is not recorded and the decoder count was not varied, so the
phone's saturation is not shown. *Decides:* a round recording the route and per-frame arrivals, the decoder count
varied.

**Which view is the target.** *So far:* on the phone, worker against page depends on the congestion controller on the
tether (medians 0.960 under `cubic-restart`, 1.016 under `bbr`) and is inconclusive by its rule on Wi-Fi (n = 10); no
cloud run shows the worker faster; both pass every correctness check. *Decides:* the next phone round, amended by a
session that will not run it ([`../devices.md`](../devices.md) §7). The owner's.

**A failed Lossless is not retried**, and **a hidden page loses its AV1 decoder mid-group**, both seen on the phone
run. *Decides:* each traced in code, reproduced (labelled simulated), a failing test, the fix.

**Exactness without digests, and after a mismatch on the tip.** A series without digests: stored `unchecked`, or
decoded again on every open (the owner's). The 2026-11-14 decision blocks a mismatched frame; whether the tip still
only *marks* it ([`../adr/exactness-in-production.md`](../adr/exactness-in-production.md) §8, *Block or mark*) is to
be checked and built.

**The view worker's open table**, each with what decides it in
[`evidence/view-worker-design.md`](evidence/view-worker-design.md) §Target: the cine clock by elapsed time, paused on
`hidden` (WebKit's worker clock is a 15 ms timer, [`evidence/frame-clock-in-a-worker.md`](evidence/frame-clock-in-a-worker.md));
the downloader merged into the view worker ([`evidence/receive-loop-beside-paint.md`](evidence/receive-loop-beside-paint.md));
misses fragmented into one-frame runs; several viewports on one WebGL2 context; an AV1 group as the store's unit; a
read-back that throws; the decoder count on phones; the asking patterns.

**Settings awaiting the owner** ([`evidence/core-against-main.md`](evidence/core-against-main.md), *Waiting on the
owner*): `waitAhead` k = 8 adopted by its rule on CT, DBT undecided
([`evidence/ask-order-during-fill.md`](evidence/ask-order-during-fill.md)); `span` and `holdEveryOther`, advised
removed ([`evidence/view-worker-experiments.md`](evidence/view-worker-experiments.md)); `pixels: "transfer"` misses
the memory bar on both engines ([`evidence/transferred-buffer-per-frame.md`](evidence/transferred-buffer-per-frame.md)).

**Elsewhere:** dav1d fetched only when WebCodecs refuses; a wake before `l` asks; the integrity and coding-error check
on the label ([`../lines/optimal-quality.md`](../lines/optimal-quality.md)); the WebGL painter on a real GPU, and
Firefox and WebKit, which refuse WebCodecs AV1 on record; `sf.jxl` and G > 1 for AV1 cine from the PCS contract
([`../lines/codecs.md`](../lines/codecs.md)). What series that are not cine-like get is not stated yet.
