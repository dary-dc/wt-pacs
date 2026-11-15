# The client's design

The browser client as it is designed now: what it is, its rules, what is decided and what is open. What the product
is for is [`../ARCHITECTURE.md`](../ARCHITECTURE.md) §The product. The reasons and the numbers are in
[`evidence/`](evidence/), one file per question; the work in flight is [`../lines/client.md`](../lines/client.md).
This file is rewritten in place when a result or a decision moves it, never appended to (`CLAUDE.md` §Docs). Its
picture, box by box with each one's costs and open questions: [`design.html`](design.html).

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
[`evidence/speed-of-the-assembled-design.md`](evidence/speed-of-the-assembled-design.md). The page's code: [`../../client/README.md`](../../client/README.md).

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
| Optimal quality plus the exact HTJ2K frame on explicit request; the residual dropped. The label says *Optimal quality* or *Lossless*, the latter only after the check passes; a developer overlay behind a toggle | 2026-11-09 | the owner | [`../../client/README.md`](../../client/README.md) §Optimal quality, exact on request |
| D > 10: the depth cut to 10 bits; D ≤ 10 coded at its own depth; a split into top and low streams discarded | 2026-11-09 | the owner | [`../av1/payload-format.md`](../av1/payload-format.md) §Depth cut |
| The phone: tethering for development and decode numbers, Wi-Fi for transport realism | 2026-11-09 | the owner | [`../devices.md`](../devices.md) §7 |
| Client telemetry is for production too, sampled | 2026-10-23 | the owner | [`evidence/what-a-load-report-sends.md`](evidence/what-a-load-report-sends.md) |
| The downloader re-asks the rest of a fill on the asked frame's head (`refill: "head"`) | 2026-10-15 | the rule, measured | [`evidence/re-asking-the-fill-after-an-ask.md`](evidence/re-asking-the-fill-after-an-ask.md) |
| The page names its client and transport in its HTML; a trusted deployment reads no transport file (not built on this branch) | 2026-10-19 | the owner | `claude/page-without-transport-file:docs/CLIENTS.md` |
| The view worker's shape: frames never return to the main thread; VOI part of paint; paint first, then the cache write; the store never decides a paint; the store, not the controller, asks the downloader | 2026-10-28 | the owner | [`evidence/view-worker-design.md`](evidence/view-worker-design.md) §Target |
| The red team's revision: an ordered want, versioned frames, credits, writes off thread, one `failed {scope, reason}`, eviction only over budget | 2026-10-29 | the owner | [`evidence/view-worker-design.md`](evidence/view-worker-design.md) §Review: the red team |
| The ring of slots is a merge candidate once its mechanism is understood | 2026-10-30 | the owner | [`evidence/frame-memory-ownership.md`](evidence/frame-memory-ownership.md) *How the ring works* |
| Optimise for Chromium first; Firefox is a later goal | 2026-10-31 | the owner | [`evidence/page-out-of-pixel-path.md`](evidence/page-out-of-pixel-path.md) |
| The cache writer without its copy out of shared memory, and paint-first writing what is left of the tick, are arms too | 2026-11-03 | the owner | [`evidence/cache-io-thread.md`](evidence/cache-io-thread.md) |
| Build the core architecture with the simple cine only, on one branch; every option a setting defaulting to today | 2026-10-30 | the owner | [`evidence/speed-of-the-assembled-design.md`](evidence/speed-of-the-assembled-design.md) §The core, assembled |
| `?view=page` stays the default: the view worker's first frame is later by ≥ 16.7 ms in five decided cells | 2026-10-30 | the rule, measured | [`evidence/page-out-of-pixel-path.md`](evidence/page-out-of-pixel-path.md) §7; [`evidence/view-worker-start.md`](evidence/view-worker-start.md) |
| WebCodecs decodes the optimal-quality view; dav1d only after a refusal or a failed decode at ≤ 10 bits, the overlay naming the route and why | 2026-11-11 | the owner | [`../../client/README.md`](../../client/README.md) §Which decoder, per payload |
| The page view stays; which view is the target is decided after the phone runs | 2026-11-11 | the owner | `claude/work-ledger:docs/queue-2026-11-10.md` |
| The optimal-quality series is always ≤ 10 bits on the product path; the stored form a lab option, never shown | 2026-11-11 | the owner | the same |
| The pairing's same-source check stays, in the ingest, with XXH3 (`sourceFingerprint`) | 2026-11-11 | the owner | the same; [`../av1/payload-format.md`](../av1/payload-format.md) §Source fingerprint |
| The quality mark: green beside *Optimal quality*, *Lossless* distinct, words always beside the colour; the status line opens by a tap | 2026-11-11 | the owner | [`../../client/README.md`](../../client/README.md) §Optimal quality, exact on request |
| The integrity and coding-error check is a proposal (#368), the owner's to decide | 2026-11-11 | the owner | `claude/oq-integrity-build:docs/reviews/oq-integrity.md` |
| `cubic-restart` the default congestion controller; `bbr` and `bbr-bound` stay options; real-world runs decide | 2026-11-11 | the owner | [`../transport/transport-conclusions.md`](../transport/transport-conclusions.md) §1 |
| AV1 only for cine-like series; no low-resolution preview (a preview is tiny or full size); XXH3-64 the frame check | by 2026-11-10 | the owner | `claude/work-ledger:docs/queue-2026-11-10.md` §Decided approaches |
| Mobile on lossy wireless; no TCP for the fill unless proven; fill and on-demand latency optimized separately; resilience parked | 2026-11-11 | the owner | the same |
| Telemetry off by default (rate 0); the frame clock kept | 2026-11-11 | the owner | the same |
| Telemetry is essential and built now, sampled; one implementation per job, so the phone's beacon becomes a switch over the load report | 2026-11-11 | the owner | [`evidence/what-a-load-report-sends.md`](evidence/what-a-load-report-sends.md) |
| The core design reaches `main`; then two weeks with no merges but those the owner names, one question a branch and a draft PR | 2026-11-11 | the owner | [`../lines/coordination.md`](../lines/coordination.md) |
| One home per subject, `docs/<subject>/` (this file, the page, `evidence/`), and the product statement's framing | 2026-11-14 | the owner | `CLAUDE.md` §Docs; [`../ARCHITECTURE.md`](../ARCHITECTURE.md) §The product |
| Exactness failures are a safety report, not telemetry: always on, never sampled, no pixels or patient data, the load report's endpoint and format; on a mismatch the second decode first, then the frame blocked, the reader told in that frame's view and the report sent at once. The sampled load report alone follows the rate | 2026-11-14 | the owner | [`../adr/exactness-in-production.md`](../adr/exactness-in-production.md) §4, §5, §8; [`evidence/where-a-frame-can-be-corrupted.md`](evidence/where-a-frame-can-be-corrupted.md) |
| The cache: survey the options before designing further; OPFS continues only if it comes out best | 2026-11-14 | the owner | [`evidence/cache-options.md`](evidence/cache-options.md); *Open: where the cache keeps frames*, below |
| The delivery comparison is theory first, measured as calibration (*Open*, below); transport is another subject | 2026-11-14 | the owner | below |

## Open

Each item: the question, what decides it, and the evidence so far with its scope. Cloud results: three DBT volumes
(`dbts_a1`, `dbts_b1`, `dbts_c1`) of one dataset, no breast ultrasound cine, 4-core hosts without a GPU, software
decode, loopback, a relay or netem, not a radio. Phone results: one phone (Chrome 157), one home link, one evening
([`evidence/phone-run-method.md`](evidence/phone-run-method.md)). Transport itself (HTJ2K alone against TCP-based stacks, WebSocket included) is another
subject (the owner, 2026-11-14).

**The delivery comparison.** Arm A the optimal-quality view only; arm B HTJ2K lossless only; C1 the approach (the
optimal-quality fill, then an exact frame on request: an on-demand latency); C2 the optimal-quality fill, then the
whole exact series, measured, not summed. *Theory:* fill ≈ max(bytes × 8 ÷ bandwidth, frames × decode per frame ÷
decoders) + rest; the optimal-quality series is 0.07–0.22 of the exact series' bytes at Q 8, 0.10–0.28 at the noise
rule's Q (derived), 0.003–0.025 at Q 24 ([`evidence/optimal-quality-bytes.md`](evidence/optimal-quality-bytes.md)), so A and C1 win where the link binds and lose
their margin where decode binds. *Decides:* per load, wire time, decode floor, rest, the decoder route taken and
bytes; phone CPU per process; server egress and CPU; rendering fixed, arms interleaved; the calibrated home Wi-Fi
([`evidence/which-links-a-phone-meets.md`](evidence/which-links-a-phone-meets.md)), then a sweep toward cellular and congested Wi-Fi with random loss, each profile labelled
measured or assumed, then the phone where an arm's regime changes; one table per link profile, in the repository.
*So far:* none run; the protocol is not written. The profiles and each arm's regime on them, from sources:
[`../transport/link-profiles.md`](../transport/link-profiles.md) (2026-11-14).

**Where the cache keeps frames.** OPFS (sync handles in a dedicated worker, or `createWritable`), IndexedDB, Cache
Storage, Storage Buckets, memory only; decoded samples (~17 MB a `dbts_b1` frame, no decode on reopen) or coded bytes
(a decode on every reopen, which the 2026-10-10 rule excludes). *Theory* ([`evidence/cache-options.md`](evidence/cache-options.md), sources only):
IndexedDB and Cache Storage refuse a `SharedArrayBuffer` and share OPFS's bucket, quota and eviction; Storage Buckets
is Chromium-only; the user-picked directory is a desktop case. Leaning: OPFS as built, decoded samples; decoded wins a
phone reopen only if a cold read and XXH3 of 17 MB take under ~45 ms (≥ ~0.4 GB/s), else the no-re-decoding rule and
reopen time pull apart (the owner's). *Decides:* that phone read, measured. *So far:* no writer arm passed on Chromium
or Firefox, the copy-free and what-is-left arms included ([`evidence/cache-io-thread.md`](evidence/cache-io-thread.md)); the ring of slots qualifies on both
engines under the amended fill bar (Firefox 155) and its build, structural, waits for review
([`evidence/frame-memory-ownership.md`](evidence/frame-memory-ownership.md)); per-engine limits in [`evidence/cache-in-opfs.md`](evidence/cache-in-opfs.md). A contradiction for the owner: that file's
questions 3 and 4 print as answered what a later branch records as proposed. The cache stays off.

**What the cache leaves on a device.** Bare pixels, byte-identical in the browser profile, protected only by the
device's disk encryption (Chromium, one run); options A–F with a default per device kind, several needing reader
identity the product lacks; a policy the deployment sets? ([`evidence/what-the-cache-leaves-on-a-device.md`](evidence/what-the-cache-leaves-on-a-device.md)). The owner's.

**What bounds a fill on the phone.** *So far:* the decode, 133–135 ms a frame over three decoders, 0.76–0.94 of every
fill; the wire 0.5–1.0 s of a 2.4–3.3 s fill (`dbts_b1` Q 8 G 8). Every decode was a software request: the product asks
WebCodecs for `prefer-software` (`client/decode/av1-webcodecs.js:80`). The decoder count was not varied, so the
phone's saturation is not shown ([`evidence/fill-bound-on-phone.md`](evidence/fill-bound-on-phone.md)). On a 4-core cloud host the view at Q 8 costs 1.24–1.74 of the
product's HTJ2K frame at 1×; capped to one core it is still not shown faster than the exact frame
([`evidence/decode-speed-of-the-optimal-quality-picture.md`](evidence/decode-speed-of-the-optimal-quality-picture.md)).
*Decides:* a phone round recording the route and per-frame arrivals, the decoder count varied; the decode protocol at
`cores` 1 and 2.

**Which view is the target.** *So far:* on the phone, worker against page depends on the controller on the tether
(medians 0.960 `cubic-restart`, 1.016 `bbr`); on Wi-Fi it is inconclusive by its pre-registered rule, not unmeasured:
the amendment's 10-minute rule stopped the run after four of six octets, so no fill comparison is decided, and the run
commit differs from the demo commit in 20 files of the fill's path ([`evidence/view-target.md`](evidence/view-target.md)). In the cloud the page view
stays the default by its rule ([`evidence/page-out-of-pixel-path.md`](evidence/page-out-of-pixel-path.md) §7, again with both fixes), the worker wins a busy page on
the mean on both engines ([`evidence/view-worker-under-a-busy-page.md`](evidence/view-worker-under-a-busy-page.md)), and its start ties with the fix at 1× (no 4× cell
decided; [`evidence/view-worker-start.md`](evidence/view-worker-start.md)). *Decides:* the next phone round, amended by a session that will not run it
([`../devices.md`](../devices.md) §7). The owner's, as are the 10-minute rule's reading and whether the run's two
`bbr` failures withdraw `bbr` ([`evidence/congestion-controller.md`](evidence/congestion-controller.md)).

**Two failures from the phone run.** A failed Lossless is not asked again: a re-ask at 1, 4 and 16 s (#378) reached
Lossless 3 of 3 times simulated against 0 of 3; the schedule and the label's words are open
([`evidence/lossless-after-a-failed-ask.md`](evidence/lossless-after-a-failed-ask.md)). A hidden page loses its AV1 decoder mid-group: a late deadline (#376) and
visibility in the beacon (#377) ([`evidence/hidden-page-decode.md`](evidence/hidden-page-decode.md)). *Decides:* each review, then the next phone round.

**Exactness: building the 2026-11-14 decision.** The tip still *marks* a mismatched frame and paints it
(`client/viewer/screen.js:6`), and the load report's code sends nothing at rate 0, failures included
([`evidence/what-a-load-report-sends.md`](evidence/what-a-load-report-sends.md)): both change to the decision; neither is built. A **coded-bytes digest** beside the sample digest
would tell the bytes' fault (ask once more) from the decoder's (the second decoder, then block): a candidate for the
owner, its cost one XXH3 pass, not measured ([`evidence/where-a-frame-can-be-corrupted.md`](evidence/where-a-frame-can-be-corrupted.md) Q1). A series without digests: stored
`unchecked`, or decoded again on every open. Whether a blocked frame has a reveal. The owner's.

**The optimal-quality frame checked as coded** (#368). Every frame checked, the shown frame always and the rest at a
rate, or not taken. *So far:* correct on 18 series on both routes; fill +3.7 % at 1×, +1.9 % at 4×; six review findings
open, among them a refused frame keeping the previous green mark ([`evidence/optimal-quality-reconstruction-digest.md`](evidence/optimal-quality-reconstruction-digest.md)).
*Decides:* the findings fixed, a phone row, then the owner.

**What the label may claim.** *Optimal quality* only, until a reader test: Q 8 keeps the coding error within the
noise on most volumes yet moves 81–87 % of shown pixels by at least one level at the presets; the owner's two
questions of 2026-11-10 (stop calling the view diagnostic; denoising, and a 1.00 or 1.03 bar) are unanswered. An
automatic exact request at narrow windows (below W = 1 + 255·e/X levels; X the readers') and whether the interpreting
role gets the exact frame without asking (MQSA binds FFDM and DBT) are options ([`evidence/which-quality-is-visually-lossless.md`](evidence/which-quality-is-visually-lossless.md);
[`evidence/rules-for-showing-lossy-pictures.md`](evidence/rules-for-showing-lossy-pictures.md)).

**The exact frame sooner.** Lossless by three strips (×0.92 of today on `dbts_b1` at 4×, the gain not attributed) and
an exact level picture first (×0.26–0.28 of today's wait; may it be shown, and in what words, is the owner's)
([`evidence/exact-frame-by-htj2k-layout.md`](evidence/exact-frame-by-htj2k-layout.md); [`evidence/htj2k-progressive-delivery.md`](evidence/htj2k-progressive-delivery.md)).

**What a view asks for.** The owner, 2026-11-02: the asking pattern a real app has was never designed. Proposed, theory
only: one rule, a memory window W = min(n, max(8, ⌊M_v ÷ s_d⌋)) frames from the current one, so W = n for every
fixture but `dbts_b1` (15 at 256 MiB); it needs the page view to send a want and a frame memory that frees; several
series on one page, a client arbiter filling one at a time ([`evidence/what-a-view-asks-for.md`](evidence/what-a-view-asks-for.md); how viewers and readers ask:
[`evidence/how-viewers-and-readers-ask.md`](evidence/how-viewers-and-readers-ask.md)). *Decides:* the protocol in that file's §5. **An ask during a fill:** one queue with
the send window brings asks to ×0.32–0.90 at a fill cost of +14 to +54 ms in one or two cells, the window alone giving
the same gain; an ask stream of its own loses but on `dbts_b1` ([`evidence/ask-during-a-fill.md`](evidence/ask-during-a-fill.md)). **A scroll ahead:** every
step below R ÷ S and the cursor's frame only above it on today's server; not resolved on the one-queue server
([`evidence/what-a-scroll-ahead-asks.md`](evidence/what-a-scroll-ahead-asks.md)). **An ask behind the decoders:** ×0.76 at AV1 4×, the fill a tie, not resolved on this
host ([`evidence/ask-behind-a-decoder-queue.md`](evidence/ask-behind-a-decoder-queue.md)). Each is the owner's. **A contradiction for the owner:** the accepted stride
ADR skips slices at 9 slices/s, a rate no source gives, against a measured 25–30 slices/s and IHE's "shall not skip
slices" for DBT ([`evidence/scroll-rate-and-skipping.md`](evidence/scroll-rate-and-skipping.md)); the viewer's cine that never skips is on a branch, not here
([`evidence/cine-shows-every-slice.md`](evidence/cine-shows-every-slice.md)).

**The view worker's open table**, each with what decides it in [`evidence/view-worker-design.md`](evidence/view-worker-design.md) §Target: the cine clock by
elapsed time, paused on `hidden` (the Chromium run gave no verdict, every cell saturated;
[`evidence/frame-clock-in-a-worker.md`](evidence/frame-clock-in-a-worker.md)); the downloader merged into the view worker ([`evidence/receive-loop-beside-paint.md`](evidence/receive-loop-beside-paint.md));
misses fragmented into one-frame runs; several viewports on one WebGL2 context; an AV1 group as the store's unit; a
read-back that throws; the decoder count on phones. Proposed: keep the start's fix and remove
`viewWorkerAfterDownloader` (a tie; a 4× answer owed on a quieter rig).

**Settings awaiting the owner** ([`evidence/speed-of-the-assembled-design.md`](evidence/speed-of-the-assembled-design.md), *Waiting on the owner*): `waitAhead` k = 8 adopted by its
rule on CT, DBT undecided ([`evidence/ask-order-during-fill.md`](evidence/ask-order-during-fill.md)); `span` and `holdEveryOther`, advised removed
([`evidence/spanning-small-gaps-in-the-misses.md`](evidence/spanning-small-gaps-in-the-misses.md)); `pixels: "transfer"` misses the memory bar on both engines
([`evidence/transferred-buffer-per-frame.md`](evidence/transferred-buffer-per-frame.md)).

**Native.** Its milestones ([`evidence/native-client-milestones.md`](evidence/native-client-milestones.md)), the window against the browser
([`evidence/native-window-against-browser.md`](evidence/native-window-against-browser.md)), parity with the browser core and two proposals (the series' metadata on
`wt-pacs/1` at accept; the client contract's clauses run against native) ([`evidence/native-client-parity.md`](evidence/native-client-parity.md)), the raw QUIC
client against WebTransport, a tie ([`evidence/native-client-wire-parity.md`](evidence/native-client-wire-parity.md)). Its open items: [`../lines/native.md`](../lines/native.md).

**Elsewhere:** dav1d fetched only when WebCodecs refuses ([`evidence/dav1d-fetched-on-need.md`](evidence/dav1d-fetched-on-need.md)) and the depth hint that skips
it below 10 bits ([`evidence/av1-cold-open-depth-hint.md`](evidence/av1-cold-open-depth-hint.md)); a wake before the exact ask, −103 and −105 ms on a modelled radio,
the phone row owed ([`evidence/wake-before-lossless.md`](evidence/wake-before-lossless.md)); the WebGL painter on a real GPU; Firefox and WebKit, which refuse
WebCodecs AV1 on record, with Chrome for Android, Safari's hardware AV1 and Edge owed
([`evidence/browser-av1-profile-support.md`](evidence/browser-av1-profile-support.md); [`evidence/browser-decode-routes.md`](evidence/browser-decode-routes.md)); `sf.jxl` and G > 1 for AV1 cine from the PCS
contract ([`../lines/codecs.md`](../lines/codecs.md)); the reviews' and proposals' open items, listed in
[`../lines/client.md`](../lines/client.md). What series that are not cine-like get is not stated yet.
