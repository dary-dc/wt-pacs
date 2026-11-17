# The client's design

The browser client as it is designed now. What the product is for: [`../ARCHITECTURE.md`](../ARCHITECTURE.md) §The
product. Its picture, box by box with costs and open questions: [`design.html`](design.html). The reasons and numbers:
[`evidence/`](evidence/), one file per question; the work in flight: [`../lines/client.md`](../lines/client.md).
Rewritten in place when a result or a decision moves it, never appended to (`CLAUDE.md` §Docs).

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
| load report | *proposed, not built* (#370): a sampled record of a page load, rate 0 by default | the page | the same |
| safety report | *decided 2026-11-14, not built*: every exactness failure, never sampled | the page | the same |
| checked as coded | *proposed, not built* (#368): the optimal-quality frame checked against its coded reconstruction | the decoders | the same |

Built on `claude/unified-client`: both views, the pairing, WebCodecs first for AV1 with dav1d-WASM after a refusal,
the label and the exact frame on request. Behind a lab setting only: the cache and its writers, the ring of slots,
transferred buffers, `waitAhead`, `span`, the frame clocks; each one's status:
[`evidence/speed-of-the-assembled-design.md`](evidence/speed-of-the-assembled-design.md). Native has the same modules
on threads ([`../native/README.md`](../native/README.md) §Built). The page's code: [`../../client/README.md`](../../client/README.md).

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
* A mismatched exact frame is decoded again, then blocked, never painted, and the reader is told in its view (*decided 2026-11-14, not built*: the tip marks it, `client/viewer/screen.js:6`).
* The cache stores only frames checked `true` and re-checks each on read; a failed read is a miss, asked again.
* An optimal-quality frame is `unchecked`; *✓ Lossless* is shown only on the paint of an exact frame checked `true`.
* The exact frame is held beside the store, never in it and never cached; asking it changes nothing else.
* Every option still under investigation is a setting whose default is the tip's behaviour, until its rule decides it.
* Lab settings never load in a product module, and the web image refuses them by name.

## Decided

The owner's unless marked *the rule* (a pre-registered rule, measured). Evidence paths are under `evidence/` unless
they start with `../`.

| choice | date | evidence |
| --- | --- | --- |
| An OPFS cache for both web clients, no re-decoding | 2026-10-10 | [`cache-in-opfs.md`](evidence/cache-in-opfs.md) |
| The page stays in the pixel path unless a measured cost says otherwise; the checks stay on, the cache read's re-check included | 2026-10-11 | [`page-out-of-pixel-path.md`](evidence/page-out-of-pixel-path.md) §8 |
| The downloader re-asks the rest of a fill on the asked frame's head (`refill: "head"`); *the rule* | 2026-10-15 | [`re-asking-the-fill-after-an-ask.md`](evidence/re-asking-the-fill-after-an-ask.md) |
| Two product clients, TS and WASM | 2026-10-16 | [`../CLIENTS.md`](../CLIENTS.md) |
| The page names its client and transport in its HTML; a trusted deployment reads no transport file (not built here) | 2026-10-19 | `claude/page-without-transport-file:docs/CLIENTS.md` |
| Client telemetry is for production too, sampled | 2026-10-23 | [`what-a-load-report-sends.md`](evidence/what-a-load-report-sends.md) |
| The view worker's shape: frames never return to the main thread; VOI part of paint; paint first; the store never decides a paint and alone asks the downloader | 2026-10-28 | [`view-worker-design.md`](evidence/view-worker-design.md) §Target |
| The red team's revision: an ordered want, versioned frames, credits, writes off thread, one `failed {scope, reason}`, eviction only over budget | 2026-10-29 | [`view-worker-design.md`](evidence/view-worker-design.md) §Review: the red team |
| The ring of slots is a merge candidate once its mechanism is understood | 2026-10-30 | [`frame-memory-ownership.md`](evidence/frame-memory-ownership.md) *How the ring works* |
| Build the core architecture with the simple cine only, on one branch; every option a setting defaulting to today | 2026-10-30 | [`speed-of-the-assembled-design.md`](evidence/speed-of-the-assembled-design.md) §The core, assembled |
| `?view=page` stays the default: the view worker's first frame is later by ≥ 16.7 ms in five decided cells; *the rule* | 2026-10-30 | [`page-out-of-pixel-path.md`](evidence/page-out-of-pixel-path.md) §7; [`view-worker-start.md`](evidence/view-worker-start.md) |
| Optimise for Chromium first; Firefox is a later goal | 2026-10-31 | [`page-out-of-pixel-path.md`](evidence/page-out-of-pixel-path.md) |
| The cache writer without its copy out of shared memory, and paint-first writing in what is left of the tick, are arms too | 2026-11-03 | [`cache-io-thread.md`](evidence/cache-io-thread.md) |
| Optimal quality plus the exact HTJ2K frame on explicit request; the residual dropped. The label says *Optimal quality* or *Lossless*, the latter only after the check passes; a developer overlay behind a toggle | 2026-11-09 | [`../../client/README.md`](../../client/README.md) §Optimal quality, exact on request |
| D > 10: the depth cut to 10 bits; D ≤ 10 coded at its own depth; a split into top and low streams discarded | 2026-11-09 | [`../av1/payload-format.md`](../av1/payload-format.md) §Depth cut |
| The phone: tethering for development and decode numbers, Wi-Fi for transport realism | 2026-11-09 | [`../devices.md`](../devices.md) §7 |
| AV1 only for cine-like series; no low-resolution preview (a preview is tiny or full size); XXH3-64 the frame check | by 2026-11-10 | `claude/work-ledger:docs/queue-2026-11-10.md` §Decided approaches |
| WebCodecs decodes the optimal-quality view; dav1d only after a refusal or a failed decode at ≤ 10 bits, the overlay naming the route and why | 2026-11-11 | [`../../client/README.md`](../../client/README.md) §Which decoder, per payload |
| The page view stays; which view is the target is decided after the phone runs | 2026-11-11 | `claude/work-ledger:docs/queue-2026-11-10.md` |
| The optimal-quality series is always ≤ 10 bits on the product path; the stored form a lab option, never shown | 2026-11-11 | the same |
| The pairing's same-source check stays, in the ingest, with XXH3 (`sourceFingerprint`) | 2026-11-11 | [`../av1/payload-format.md`](../av1/payload-format.md) §Source fingerprint |
| The quality mark: green beside *Optimal quality*, *Lossless* distinct, words always beside the colour; the status line opens by a tap | 2026-11-11 | [`../../client/README.md`](../../client/README.md) §Optimal quality, exact on request |
| The application loads while the series loads, as when a reader opens a study's URL directly; no listing view | 2026-11-11 | `e5b20cba:docs/lines/optimal-quality.md` §Decisions, afternoon |
| AV1 tiles wait; HTJ2K with tiles and resolution levels matched to the screen, for DBT and other large matrices, is investigated and compared with this approach | 2026-11-11 | the same; [`exact-frame-by-htj2k-layout.md`](evidence/exact-frame-by-htj2k-layout.md) |
| The integrity and coding-error check is a proposal (#368), the owner's to decide | 2026-11-11 | `claude/oq-integrity-build:docs/reviews/oq-integrity.md` |
| `cubic-restart` the default congestion controller; `bbr` and `bbr-bound` stay options; real-world runs decide | 2026-11-11 | [`../transport/transport-conclusions.md`](../transport/transport-conclusions.md) §1 |
| Mobile on lossy wireless; no TCP for the fill unless proven; fill and on-demand latency optimized separately; resilience parked | 2026-11-11 | `claude/work-ledger:docs/queue-2026-11-10.md` |
| Telemetry off by default (rate 0); the frame clock kept | 2026-11-11 | the same |
| Telemetry is essential and built now, sampled; one implementation per job, so the phone's beacon becomes a switch over the load report | 2026-11-11 | [`what-a-load-report-sends.md`](evidence/what-a-load-report-sends.md) |
| The core design reaches `main`; then two weeks with no merges but those the owner names, one question a branch and a draft PR | 2026-11-11 | [`../lines/coordination.md`](../lines/coordination.md) |
| One home per subject, `docs/<subject>/` (this file, the page, `evidence/`), and the product statement's framing | 2026-11-14 | `CLAUDE.md` §Docs; [`../ARCHITECTURE.md`](../ARCHITECTURE.md) §The product |
| Exactness failures are a safety report, not telemetry: always on, never sampled, no pixels or patient data, the load report's endpoint and format; on a mismatch the second decode first, then the frame blocked, the reader told in that frame's view and the report sent at once. The sampled load report alone follows the rate | 2026-11-14 | [`../adr/exactness-in-production.md`](../adr/exactness-in-production.md) §4, §5, §8; [`where-a-frame-can-be-corrupted.md`](evidence/where-a-frame-can-be-corrupted.md) |
| The cache: survey the options before designing further; if OPFS comes out best its design continues, if not the cache gets research of its own | 2026-11-14 | [`cache-options.md`](evidence/cache-options.md); *Open*, below |
| The delivery comparison is theory first, measured as calibration (*Open*, below); transport is another subject | 2026-11-14 | below |
| 10 bits on hardware is the goal, 8 bits the fallback; resources on 10 bits are not cut | 2026-11-14 | `claude/work-ledger:docs/queue-client-2026-11-14.md` amendment 16; `claude/hw10-routes:docs/decode/hardware-10bit.md` (#392) |
| Native is paused: it rides the merges as an experimental crate, off the served path, and no row builds or measures it | 2026-11-15 | `claude/work-ledger:docs/queue-client-2026-11-14.md` amendment 18; `claude/native-notes:docs/native/README.md` §Status (#396) |
| The web stays the approach; its mobile options are explored before native | 2026-11-15 | `claude/work-ledger:docs/queue-client-2026-11-14.md` amendment 19; `claude/mobile-decode:docs/decode/mobile/README.md` (#397) |
| Only a lost ask is asked again, once: the session or stream gone, its deadline passed with nothing received, or its own re-dial failed; never a refusal nor a failed check | 2026-11-16 | `claude/work-ledger:docs/queue-client-2026-11-14.md` amendments 22, 23; `claude/lossless-under-loss:docs/reviews/lossless-under-loss.md` (#378) |
| No second picture for more than 8 bits (the split's fragility, its small decode gain) | 2026-11-16 | `claude/work-ledger:docs/queue-client-2026-11-14.md` amendment 23; `claude/mobile-decode:docs/decode/mobile/new-options.md` §4 |
| The content crop is doubtful (it can cut part of the breast off screen): no build, kept as noted | 2026-11-16 | `claude/work-ledger:docs/queue-client-2026-11-14.md` amendment 23; `claude/mobile-decode:docs/decode/mobile/content-crop.md` |
| Hardware painting first with the check following is acceptable, not ideal | 2026-11-16 | `claude/work-ledger:docs/queue-client-2026-11-14.md` amendment 23 |

## Open

Each item: the question, what decides it, the evidence so far. The scope of every result cited: cloud runs on three
DBT volumes (`dbts_a1`, `dbts_b1`, `dbts_c1`) of one dataset, no breast ultrasound cine, 4-core hosts without a GPU,
software decode, loopback, a relay or netem, not a radio; phone runs on one phone (Chrome 157), one home link, one
evening ([`phone-run-method.md`](evidence/phone-run-method.md)). Transport itself (HTJ2K alone against TCP-based
stacks, WebSocket included) is another subject (the owner, 2026-11-14).

**The delivery comparison.** Arm A the optimal-quality view only; B HTJ2K lossless only; C1 the approach (the
optimal-quality fill, then an exact frame on request: an on-demand latency); C2 the fill, then the whole exact series,
measured, not summed. *Theory:* fill ≈ max(bytes × 8 ÷ bandwidth, frames × decode per frame ÷ decoders) + rest; the
view's bytes are a fraction of the exact series' ([`optimal-quality-bytes.md`](evidence/optimal-quality-bytes.md)),
so A and C1 win where the link binds and lose the margin where decode binds. *Decides:* per load, wire time, decode
floor, rest, the decoder route taken and bytes; phone CPU per process; server egress and CPU; rendering fixed, arms
interleaved; the calibrated home Wi-Fi ([`which-links-a-phone-meets.md`](evidence/which-links-a-phone-meets.md)), then
a sweep toward cellular and congested Wi-Fi with random loss, each profile labelled measured or assumed, then the
phone where an arm's regime changes; one table per profile, in the repository. *So far:* none run; no protocol.

**Where the cache keeps frames.** OPFS, IndexedDB, Cache Storage, Storage Buckets or memory only; decoded samples (no
decode on reopen) or coded bytes (a decode on every reopen, which the 2026-10-10 rule excludes). *Leaning*, theory
only ([`cache-options.md`](evidence/cache-options.md)): OPFS as built, decoded samples. *Decides:* a phone's cold read
and check of one decoded frame, measured against its decode. *So far:* no cache writer arm passed on either engine
([`cache-io-thread.md`](evidence/cache-io-thread.md)); the ring of slots qualifies on both under the amended bar, its
build waiting for review ([`frame-memory-ownership.md`](evidence/frame-memory-ownership.md)); per-engine limits in
[`cache-in-opfs.md`](evidence/cache-in-opfs.md). The empirical choice between OPFS sync, OPFS async, IndexedDB
and Cache Storage (`claude/cache-plan:docs/client/evidence/cache-plan.md`): four lab arms built and reviewed through a
third fix round (the owner's yes, 2026-11-16), its run next (#394). The cache stays off.

**What the cache leaves on a device.** Bare pixels, protected only by the device's disk encryption; a default per
device kind, or a policy the deployment sets? ([`what-the-cache-leaves-on-a-device.md`](evidence/what-the-cache-leaves-on-a-device.md)). The owner's.

**What bounds a fill on the phone.** *So far:* the decode, every one a software request (the product asks WebCodecs
for `prefer-software`); the decoder count not varied, so the phone's saturation is not shown
([`fill-bound-on-phone.md`](evidence/fill-bound-on-phone.md); the cloud's decode cost:
[`decode-speed-of-the-optimal-quality-picture.md`](evidence/decode-speed-of-the-optimal-quality-picture.md)).
*Decides:* a phone round recording the route and per-frame arrivals, the decoder count varied; the decode protocol
at `cores` 1 and 2.

**Decode on a phone, and hardware.** *So far (2026-11-15):* full precision today only off hardware; a hardware frame
is checked only at 8 bits, by inverting the engine's conversion; leaning, AV1 in software until the phone cells report
(`claude/mobile-decode:docs/decode/mobile/README.md`, #397). No shipped browser route serves the checked 10-bit view
(`claude/hw10-routes:docs/decode/hardware-10bit.md`, #392 §Review). The 8-bit view costs 1.14–1.86× today's bytes at
its highest Q under the noise rule's bar, on 19 DBT volumes (`claude/depth8:docs/av1/depth-cut-8.md`, #389). The
checked 8-bit hardware view in studio range (16 to 235, 220 levels, against the series' own depth) may be explored
further (the owner, 2026-11-16; `claude/mobile-decode:docs/decode/mobile/hw-inverted.md`). *Decides:* the probe and
the decode cells of the next round (`claude/phone-protocol:docs/phone-rows/next-round.md`).

**An HTJ2K-only path for large matrices on phones**, its first picture a reduced-resolution level of the same
codestream, the exact frame after: to be investigated (the owner, 2026-11-16), against *no low-resolution preview*
(by 2026-11-10, above). *So far (2026-11-17):* the level picture failed the visually lossless proxy at display scale,
so its ratios compare unequal quality (`claude/mobile-decode:docs/decode/mobile/htj2k-preview.md`, #397). *Decides:*
its phone cells, then the owner.

**Which view is the target.** *So far:* on the phone's tether it depends on the controller; on its Wi-Fi it is
inconclusive by its rule, not unmeasured ([`view-target.md`](evidence/view-target.md)); in the cloud the page view
stays by its rule, the worker wins a busy page ([`view-worker-under-a-busy-page.md`](evidence/view-worker-under-a-busy-page.md))
and its start ties ([`view-worker-start.md`](evidence/view-worker-start.md)). *Decides:* the next phone round,
amended by a session that will not run it ([`../devices.md`](../devices.md) §7): written, reviewed and fixed 2026-11-15
(`claude/phone-protocol:docs/phone-rows/next-round.md`, #359), its one-press runner's blockers closed in a third round
(the owner's yes, 2026-11-16; #400); cell 3's guard form is the owner's before the round.

**Two failures from the phone run.** A failed Lossless is not asked again (#378,
[`lossless-after-a-failed-ask.md`](evidence/lossless-after-a-failed-ask.md)); a hidden page loses its AV1 decoder
mid-group (#376, #377, [`hidden-page-decode.md`](evidence/hidden-page-decode.md)). *Decides:* each review, then the
next phone round. *So far:* #378 asks again only a lost ask (decided 2026-11-16, above), reviewed with no
blocker (`claude/lossless-under-loss:docs/reviews/lossless-under-loss.md`); whether one re-ask is enough, the owner's.

**Exactness after a mismatch.** The 2026-11-14 decision is not built: the tip marks and paints, and the load report
sends nothing at rate 0 ([`what-a-load-report-sends.md`](evidence/what-a-load-report-sends.md)). For the owner: a
coded-bytes digest, to tell the bytes' fault from the decoder's
([`where-a-frame-can-be-corrupted.md`](evidence/where-a-frame-can-be-corrupted.md) Q1); a series without digests;
whether a blocked frame has a reveal. How the load and safety reports leave the page is chosen empirically between `sendBeacon`,
`fetch` with `keepalive` and the WebTransport session, and two receivers; its run in progress since 2026-11-16
(`claude/report-plan:docs/client/evidence/report-plan.md`, #395).

**The optimal-quality frame checked as coded** (#368): every frame, the shown one and the rest at a rate, or not
taken. *Decides:* its six review findings fixed, a phone row, then the owner
([`optimal-quality-reconstruction-digest.md`](evidence/optimal-quality-reconstruction-digest.md)).

**What the label may claim.** *Optimal quality* only, until a reader test; an automatic exact request at narrow
windows, and whether the interpreting role gets the exact frame without asking, are options
([`which-quality-is-visually-lossless.md`](evidence/which-quality-is-visually-lossless.md),
[`rules-for-showing-lossy-pictures.md`](evidence/rules-for-showing-lossy-pictures.md)). So is the exact frame sooner:
by strips, or an exact level picture first, and in what words
([`exact-frame-by-htj2k-layout.md`](evidence/exact-frame-by-htj2k-layout.md),
[`htj2k-progressive-delivery.md`](evidence/htj2k-progressive-delivery.md)). The owner's.

**What a view asks for.** Never designed (the owner, 2026-11-02). Proposed, theory only: one rule, a memory window
from the current frame; several series under a client arbiter ([`what-a-view-asks-for.md`](evidence/what-a-view-asks-for.md),
its §5 decides; [`how-viewers-and-readers-ask.md`](evidence/how-viewers-and-readers-ask.md)). Beside it, each the
owner's: an ask during a fill ([`ask-during-a-fill.md`](evidence/ask-during-a-fill.md)), a scroll ahead
([`what-a-scroll-ahead-asks.md`](evidence/what-a-scroll-ahead-asks.md)), an ask behind the decoders
([`ask-behind-a-decoder-queue.md`](evidence/ask-behind-a-decoder-queue.md)).

**The view worker's open table**, seven questions, each with what decides it
([`view-worker-design.md`](evidence/view-worker-design.md) §Target; the cine clock:
[`frame-clock-in-a-worker.md`](evidence/frame-clock-in-a-worker.md); the downloader merged into it:
[`receive-loop-beside-paint.md`](evidence/receive-loop-beside-paint.md)). Proposed: keep the start's fix and remove
`viewWorkerAfterDownloader`.

**Settings awaiting the owner** ([`speed-of-the-assembled-design.md`](evidence/speed-of-the-assembled-design.md),
*Waiting on the owner*): `waitAhead` ([`ask-order-during-fill.md`](evidence/ask-order-during-fill.md)), `span` and
`holdEveryOther` ([`spanning-small-gaps-in-the-misses.md`](evidence/spanning-small-gaps-in-the-misses.md)),
`pixels: "transfer"` ([`transferred-buffer-per-frame.md`](evidence/transferred-buffer-per-frame.md)).

**Contradictions for the owner**, none settled by a later decision; listed, not resolved:

1. The accepted stride ADR skips slices at 9 slices/s, a rate no source gives, against a measured 25–30 slices/s and
   IHE's "shall not skip slices" for DBT ([`scroll-rate-and-skipping.md`](evidence/scroll-rate-and-skipping.md)); the
   cine that never skips is on a branch, not here ([`cine-shows-every-slice.md`](evidence/cine-shows-every-slice.md)).
2. [`frame-memory-ownership.md`](evidence/frame-memory-ownership.md)'s questions 3 and 4 print as answered what a
   later branch records as proposed.
3. The phone run's 10-minute rule stopped its Wi-Fi block after four of six octets: does the rule stand against a
   six-octet reading, and do the run's two `bbr` failures withdraw `bbr`? ([`view-target.md`](evidence/view-target.md),
   [`congestion-controller.md`](evidence/congestion-controller.md)).
4. `readMin`'s cut-stream fix is not merged and its default is open ([`../merge-readiness.md`](../merge-readiness.md) H3).
5. The visually-lossless bar, 1.00 or 1.03 of the noise, and whether denoising counts (the owner's questions of
   2026-11-10; [`which-quality-is-visually-lossless.md`](evidence/which-quality-is-visually-lossless.md)).
6. The ring's Firefox result was run on Firefox 155, not the 159 its bar was set on
   ([`frame-memory-ownership.md`](evidence/frame-memory-ownership.md)).

**Elsewhere:** native's open items ([`../lines/native.md`](../lines/native.md); its evidence is `evidence/native-*.md`); dav1d fetched only when WebCodecs refuses ([`dav1d-fetched-on-need.md`](evidence/dav1d-fetched-on-need.md),
[`av1-cold-open-depth-hint.md`](evidence/av1-cold-open-depth-hint.md)); a wake before the exact ask
([`wake-before-lossless.md`](evidence/wake-before-lossless.md)); the WebGL painter on a real GPU; Firefox and WebKit
([`browser-av1-profile-support.md`](evidence/browser-av1-profile-support.md),
[`browser-decode-routes.md`](evidence/browser-decode-routes.md)); `sf.jxl` and G > 1 for AV1 cine from the PCS
contract ([`../lines/codecs.md`](../lines/codecs.md)); the reviews' and proposals' open items in
[`../lines/client.md`](../lines/client.md). What series that are not cine-like get is not stated yet.
