# client

One worker owns the session, every frame's record and the queue; decoders hand pixels straight to
the consumer over a port the downloader hands out. It is the lab's only client.
Design and what it is for: [`docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md).

**[`transport/`](transport/)** — the page side, the download worker and the transports:

| file | |
| - | - |
| `consumer.js` | the page side: one waiter per asked frame, so `stats` needs no round trip |
| `downloader.js` | the worker: dial, per-frame records, the fill pushed one run at a time and re-issued after an ask, two-priority queue, dispatch, cancel |
| `downloader.test.mjs`, `consumer.test.mjs` | node: how many decoders a start makes; what `connect` refuses before a worker starts |
| `ts/`, `wasm/` | the TypeScript transports and the WASM transport's crate ([`docs/CLIENTS.md`](../docs/CLIENTS.md)) |

**[`decode/`](decode/)** — the decode worker, its codec modules and the decoders' WASM builds:

| file | |
| - | - |
| `decoder.js` | one decoder instance: loads the series' codec module and posts each frame it returns to the consumer |
| `htj2k.js` | an HTJ2K codestream behind the codec modules' interface, one OpenJPH decoder object reused; pixels into a `SharedArrayBuffer`, sign extension and range in one pass |
| `av1.js` | an AV1 payload behind the codec modules' interface, its decoder chosen per payload; loaded only for an AV1 series |
| `av1-payload.js` | the payload's header read, and every malformed case refused by name |
| `av1-dav1d.js`, `av1-webcodecs.js` | one stream unit through dav1d-WASM or through WebCodecs, as a picture |
| `av1-frame.js` | a picture checked against the header and merged to the contract: planes interleaved, split, colour transform and offset undone |
| `av1-probe.js` | a 16×16 unit per layout WebCodecs may take, and its checksum (made by `ingest/coded-frames/make_golden.py`) |
| `wasm-glue.js` | an Emscripten module from its classic glue in a module worker, for OpenJPH and dav1d alike |
| `htj2k.test.mjs`, `av1.test.mjs` | node: the range pass; the AV1 payload reader |
| `wasm/` | `dav1d/` builds dav1d-WASM, `fetch_openjph.sh` fetches OpenJPH's into `vendor/` |

The rest: [`contract/`](contract/) the transport's clauses and the rigs, [`paint/`](paint/README.md) the
painter, [`record/`](record/) telemetry, [`harness/`](harness/) the lab's pages.

**An AV1 series.** `opts.decoder.codec` names the series' codec: `"htj2k"` (or absent) is today's
path untouched, `"av1"` loads `av1.js` and, at the decoder's start, both decoders it may need — dav1d-WASM
from [`client/decode/wasm/dav1d`](./decode/wasm/dav1d/README.md) (`glue`, `wasm`, `dir` as for
OpenJPH, `THIRD_PARTY.txt` served beside them) or WebCodecs; anything else makes `connect` reject
with `unknown codec "…"` before a worker starts. Every entry is a payload of
[`docs/av1/payload-format.md`](../docs/av1/payload-format.md): a 16-byte header that says the source's
bits, the coded depth, the low bits split apart, signed and offset, the colour transform, then one
frame (G = 1). The payload comes out in the same `{pixels, width, bits, signed, range}` as an HTJ2K
frame, colour interleaved R, G, B; a malformed one fails with `undecodable: av1 payload: …` naming
what is wrong, before or after decoding, and never as pixels.

**Which decoder, per payload.** WebCodecs when every stream of the payload is ≤ 10 bits, `VideoDecoder`
exists, and the probe for each stream's layout — grey 8 or 10-bit, 4:4:4 8 or 10-bit, told apart
before decoding by the header and the unit's `seq_profile` — returned its samples, once per worker;
dav1d-WASM otherwise, and for a payload WebCodecs fails on. Both modules are imported, and dav1d's
glue and WASM fetched, when the decoder starts, beside the dial; each is initialised on first use,
and an import that fails is tried again on the next payload. Before, the first payload waited for all of
it: **−1.0 serial round trips to the first exact frame through WebCodecs and −3.0 through dav1d on
100–300 ms links, cold, every paired round** (10.02 → 8.98 and 11.93 → 8.96; HTJ2K 7.99); warm,
nothing moves. On a link under 20 ms a ≤ 10-bit series pays for the fallback's 238 KB arriving
beside its first frame (+26 ms at 10 ms, +67 on loopback), dav1d wins from 10 ms. A page that knows
the series is AV1 can `preload` the seven AV1 modules, the glue and the WASM, as `lab/page-open/codec.html`
does: AV1 then reaches HTJ2K's 8.0. [`lab/page-open/README.md`](../lab/page-open/README.md)
§Cold round trips by codec. A WebCodecs frame is taken only for the unit it
was sent with, so one flushed late from an earlier unit is never taken for the unit in hand. The
dispatch rig checks the writer's golden payloads (`client/contract/av1/payloads/`, plain and optimized,
seven shapes each) through both decoders, every refusal by its message, the choice, the fallback and
a late frame; `av1.test.mjs` the same reader in node.

**An AV1 series in groups.** `opts.groupLength: G` (absent = 1) with `opts.frameCount` says a
keyframe sits at every multiple of G and the frames between decode only after it. A group is the
payload: an ask for any frame asks its whole group from the keyframe, a fill asks whole groups, and a
group's frames go to one decoder in index order. A frame that fails fails the rest of its group,
each by name. Each unit reaches the decoder as a payload of one frame. [`docs/av1/adr-unit.md`](../docs/av1/adr-unit.md) §3, *Built*; the dispatch rig
checks a G = 8 set and a one-group set (`client/contract/av1/{g8x20,whole12}`) frame by frame.
A ≤ 10-bit series in groups decodes through WebCodecs, not flushed inside a group
([`docs/decode/README.md`](../docs/decode/README.md) §WebCodecs without a flush).

**A scalable AV1 series.** A unit with a lossy base layer under a lossless top decodes through
dav1d-WASM twice from the same bytes: the base reaches `opts.onPreview` as a frame whose `info` says
`preview: true` at the base's own size, then the exact frame reaches the ask or `onFrame`, which
never receive a preview. A unit without its top fails by name after its preview. WebCodecs returns
the exact frame and no preview. [`docs/av1/adr-unit.md`](../docs/av1/adr-unit.md) §6; the
dispatch rig checks `client/contract/av1/scalable/`.

`DownloaderClient.connect(url, certHash, opts)` takes `opts.fill` — the first fill's indices, sent
in `start` so it does not wait for a round trip through the page. `lab/fill-at-start/` prices it.

**Only the dial needs the URL.** `url` and `certHash` may each be a promise: the worker, the
decoders and the transport import start at once and the dial waits alone. The opening fill rides
the session URL as `?ask=fill:A-B` and is never asked for on the control stream — on by default, as
the server's `--opening-ask` is; `opts.openingAsk: false` asks it on the control stream instead, and a
server run with `--opening-ask false` needs that. `lab/page-open/README.md` §The first byte on a
fill prices both: the opening ask is **−1.13 round trips** to the first frame of a fill, 41 ms at a
40 ms link and 178 ms at 160; the promise is worth nothing measurable on that box.

**How many decoders.** `opts.decoders` defaults to `min(3, navigator.hardwareConcurrency || 3)`:
a third decoder helps on four cores and not on two ([`docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md)
§Resources); `downloader.test.mjs` pins it at two cores and eight. The warm-up frame `opts.warmup` was
removed on 2026-10-03 — it moved only per-frame waits, not the page's clock; the code is at tag
`archive/downloader-opts-2026-10-03` and its numbers in `docs/decode/README.md` §Warming the decoders.

**What a decoder worker costs.** 5.9 MB resident each, 5.7 MB of it the worker's own JS+WASM heap,
measured as the slope in the decoder count with the instrument calibrated against 32 MB of ballast
per worker — and 6.1 MB through this whole path, session included, with the page keeping every
frame ([`docs/decode/README.md`](../docs/decode/README.md) §What a decoder worker costs,
resident). The one decoder object `htj2k.js` reuses accounts for 0.81 MB of that and does not
grow with the series; each worker compiling its own module accounts for 0.3 MB. So neither is a
lever worth pulling, and a page where three of these cost tens of MB each is not paying for them.

**The wire buffer is a ring, not a frame's own.** `connect` sizes it —
`opts.wireBuffers`, defaulting to `decoders × perDecoder + 2`, the frames that can be between the
wire and a decoder, a default 2, 8 and 16 were measured against and nothing beat — and the session
hands frames out of it. `decoder.js` transfers `bytes.buffer`
back in its `done` or `failed` reply and this worker returns it with `session.releaseWireBuffer`,
so a fill's peak is the pool rather than the series: **−19.2 MB [−20.9…−16.0] of renderer peak on
an 87-frame 16-bit fill, 8 of 8 rounds**, −10.8 on the colour set, against a constant 3.1 MB the
pool retains and no movement in the fill's clock
([`docs/decode/README.md`](../docs/decode/README.md) §The wire buffer ring). `wireBuffers: 0`
never retains, which is one buffer per frame — the behaviour before it, and what a consumer that
hands nothing back gets anyway. An undecoded frame (`decode: false`) is transferred to the page and
never comes back, as before.

**A request is a generation.** `cancel()` bumps it and returns a promise that resolves once the
downloader has ended the stream and dropped that request's work; every frame and failure carries the
generation it was made under, and anything older is dropped on the page rather than handed over
under an index the new request is using. A refused *fill* frame has no waiter, so it reaches the
consumer through `opts.onError({ frameIndex, reason, generation })` — a refused *asked* frame still
rejects its own promise, and a refusal that fails the rest of a fill spares a frame an ask carries. [`ARCHITECTURE.md`](../docs/ARCHITECTURE.md) §The consumer.

**What a frame reports.** Beside the decoded `byteCount`, every frame message the decoder and the
downloader post carries `wireBytes` — the codestream length the frame's envelope declared, which is
what actually crossed the link. A consumer reporting traffic quotes that one: on a compressed frame
the decoded plane is several times larger, so `byteCount` would overstate the link by that factor.
It reaches the page as `frame.info.wireBytes`, the way `byteCount` does, on the decoded path and on
the undecoded one alike; nothing was renamed to make room for it.

**A frame that did not arrive whole is a failure, not a frame.** Two checks, both inside the worker
graph, so the page never sees a bad frame. On the wire, a uni stream that ends before the length its
own envelope declares names the frame it lost and refuses it
([`docs/CLIENTS.md`](../docs/CLIENTS.md) §A truncated frame is a failure). In the decoder, a
decoded buffer that is empty or shorter than the codestream's header declares is thrown, because one
decoder object is reused and an undecodable frame otherwise comes back carrying the **previous**
frame's pixels under the new index ([`docs/decode/README.md`](../docs/decode/README.md) §A frame
that did not decode). Either way the consumer gets `onError({ frameIndex, reason, generation })` for
a fill frame or a rejected promise for an asked one, so a fill that lost a frame cannot report
itself complete. A session that **dies** mid-fill is the third way to lose a frame: the transport
names every index the fill still owed, and — corrected 2026-09-22 — this worker resumes on that
list rather than failing the run, and fails it only once the re-dials have run out (§A session that
dies is resumed). Neither check sees a codestream the server truncated *before* framing it; the
harness's per-frame `.sha256` is what sees that.

**A frame says whether it is exact.** Given the series' digests — `opts.digests`, the metadata's
`digests.frames` when its `algorithm` is `xxh3-64` ([`docs/FIXTURES.md`](../docs/FIXTURES.md) §Frame digests) —
each decoder worker hashes every frame it decodes before handing it on, and the frame carries
`info.exact`: `true` when its XXH3-64 matches, `"unchecked"` when the series or the frame has no digest.
A mismatch is decoded once more on another path (`info.path`: `htj2k` in a decoder object of its own,
`av1-webcodecs` ⇄ `av1-dav1d`, `av1-mixed` → `av1-dav1d`; inside a group there is none) and is `true`
only if that matches, with `info.mismatchOn` naming the path that missed; otherwise `false`, its
`info.reason` naming both decodes. A frame is never asked again for it: the same bytes would come back.
`stats().exact` counts frames per path as `{ true, false, unchecked }`. The hasher is hash-wasm's XXH3
(`decode/wasm/fetch_xxh3.sh`); a worker given digests that cannot load it fails its start. What it costs
and why it is on: [`docs/adr/exactness-in-production.md`](../docs/adr/exactness-in-production.md).

**A session that dies is resumed.** A path that goes away takes no byte with it that the records do
not already hold, so the worker treats a death as a resumption rather than a failure. Every
platform trigger — `online`/`offline` and `navigator.connection` `change` in the worker,
`visibilitychange`, `pageshow`, `freeze` and `resume` forwarded by `consumer.js` — re-reads one
clock: the last byte the transport delivered. **No byte for `stallMs` while frames are owed** and the
session is re-dialled, the wait doubling after each re-dial it caused, and exactly what the records
still owe is issued on the new one — the fill's remainder as a run and any outstanding ask again, with
nothing that arrived re-fetched and nothing re-decoded. The request's **generation does not move**:
a resume is the same request, so the page's waiters and records stay valid and the only thing it is
told is when each resume happened, as `stats().resumedAt`. `survival: false` turns it off; an object overrides
`{ stallMs: 3000, redialMs: 1000, tries: 5, dialMs: 5000 }`, where `tries` counts the re-dials since a
frame last arrived, so sessions that are accepted and never deliver end in the owed frames named. A dial whose `ready` has not settled by
`dialMs` is closed and counts as a failed try, the first dial included. Until 2026-09-24 a quiet fill started a probe ask
instead, which livelocked on a slow link. An ask keeps no timer in the consumer: the downloader
settles it, and the transports time a frame from the last byte, not from the ask.

**No client timer fails an ask whose bytes are still coming** (2026-10-07). The timers
that can end a frame are the stall above, `dialMs`, and each transport's 15 s per-ask waiter — no byte
on the session for 15 s, restarted by every byte (the consumer's close deadline and WebCodecs' 2 s flush
act on bytes already in hand). The waiter was the one that could fail an open session's ask outright:
once three silences had doubled `stallMs` past 15 s, it fired first and the ask failed with re-dials
left. **It is now silence like the stall's**: both WebTransport clients reject it as `FrameTimeoutError`
and the downloader resumes the ask on a new session, failing it only when `tries` runs out
(`downloader.test.mjs`; the contract clause names it; each mutation caught). Measured on row
LOSSLINK's harness ([`lab/av1/delivery/total-time`](../lab/av1/delivery/total-time/README.md) §Row ASKDEADLINE): the 10-bit
volume as HTJ2K, 4 frames filled then 8 asked one at a time, 20 Mbit and `lte-good` clean, 2 % and 5 %
loss, 1×, this downloader against the one before it and against `stallMs` 15 s, 10 rounds interleaved,
155 of 180 visits kept, **2 160/2 160 frames exact and 0 asks failed in every variant, before as after**. On
the clean links and iid loss nothing fires — no silence over 1 s, no resume, fill ×0.98–1.03 and ask
medians within 70 ms. On `lte-good`'s bursts the silences are real and the session lives through them:
up to 9.3 s with today's stall, 12.4 s with 15 s; 3 s re-dials 2–12 times a cell, and the ask tail (p95
12.8–13.8 s at 5 %) is the same either way. **A 15 s stall is not adopted**: it re-dials less but its
tail is longer (p95 19.5 s, max 54 s; Chromium itself drops two of those sessions at 6.6 s of silence),
within a spread where one burst is ten seconds. The fix changes nothing measured here; it removes the
one path by which a timer failed an ask the transport might still deliver.
[`docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md) has the states, the
reasons and what a cut costs today against built.

**A session can be recycled before a byte budget runs out** — `recycleAtBytes: N`, off by default.
Past three quarters of N delivered on one session, the next is dialled in the background; once it is
ready the old one is closed and the records' remainder is issued on the new one, exactly as a resume
issues it, and the page is told as `stats().recycledAt`. It is for WebKit's session that stalls after
16 MB; what it costs, and against what, is `docs/ARCHITECTURE.md` §Recycling before the stall.

**Every decision is held by a test** (2026-10-07). A sweep of 76 mutants over
`downloader.js` and `consumer.js` — each branch, guard and threshold broken in turn, the node tests
and both browser rigs run against it — left 32 alive. Each of the 21 that were decisions no test
reached now has one that fails on its mutant (`dispatch-rig.ts` unless named):

| decision | test | its mutant |
| --- | --- | --- |
| a frame to the least busy decoder | `aFrameGoesToTheLeastBusyDecoder` | the first decoder with room |
| a fill skips frames already recorded | `aFillOfFramesInHandAsksOnlyTheRest` | re-records them |
| a lost decoder fails the start only when none is left | `aDecoderLostBeforeTheDialDoesNotFailTheStart` | `lose()` reports every loss |
| recycling at three quarters of the budget | `aSessionNearItsBudgetIsReplaced` (its budget moved to 400 B) | at the whole budget |
| a failed ask on a closed session resumes it | `anAskAloneOnAClosedSessionIsReasked` | the ask fails |
| silence condemns a session owing only an ask | `aSilentSessionOwingAnAskIsRedialled` | only a fill counts |
| a recycled session is asked the owed asks | `aRecycledSessionTakesTheOwedAsk` | only the fill is re-issued |
| a resume with nothing owed dials nothing | `aCancelBetweenRedialsEndsThem` | dials on |
| spent re-dials fail the owed asks too | `whenTheRedialsRunOutAnOwedAskIsNamed` | only the fill is named |
| spent re-dials are given back | `theRedialsAreGivenBackOnceSpent` | the next death fails at once |
| an option passed as `undefined` keeps its default | `anUndefinedOptionKeepsItsDefault` | survival switched off |
| only a dial that never settles is retried at start | `aRefusedFirstDialFailsAtOnce` | a refusal is retried |
| a command waits for a resumption under way | `aCommandDuringAResumeDialsNoSessionOfItsOwn` | dials beside it |
| a cancel forgets which decoder holds a group | `aCancelReleasesTheGroupADecoderHeld` | a stale decoder takes frame 2 |
| a command's failure is named only in its request | `aDialFailingAfterACancelNamesNothing` | named after a cancel |
| a decoder's failure is named only in its request | `aDecodeFailingAfterACancelNamesNothing` | named after a cancel |
| a second ask for one frame is refused | `aSecondAskForTheSameFrameIsRefused` | it replaces the first's waiter |
| `stats().resumedAt`, `stats().recycledAt` | `aDeadSessionIsResumedNotReported`, `aSessionNearItsBudgetIsReplaced` | never recorded |
| `groupLength` a whole number ≥ 1; cross-origin isolation unless `decode: false` | `consumer.test.mjs` | not checked |

Four were dead code and are gone: `promote()`'s guard on a frame already asked and its `pump()` (a
frame waits in a queue only while no decoder can take it, and moving it frees none), the record's
generation (a cancel clears every record, so none outlives its request) and the consumer's
`decodeEnd` fallback for `lastChunkMs` (`lastByte` is set on every frame). Seven are left alive, each
for a reason: the `check` message and the visibility filter only matter when a frozen page's timers
fire late, which headless Chromium does not do; `close()` removing the page listeners and the two
`??=` on the closed reason change nothing observable; the wire buffer's release only moves memory
(the stand-in decoder returns no buffer, and the ring allocates when empty); and recycling's guard
against a resumption that finished first is a race the fake cannot order.

Its self-check (`client/harness/index.html`) checks each decoded frame of the `decode_c512` series
against the fixture's `.sha256`; `client/harness/cell.html` runs a lab cell over any series:

```bash
./server/scripts/gen_dev_cert.sh
cargo run --release -p series-server -- --port 4433 --series <series>.sbnd
python3 server/dev-server.py --port 8765
# then open http://127.0.0.1:8765/harness/ in a cross-origin-isolated context
```

**The page must be cross-origin isolated.** Pixels are written once into a `SharedArrayBuffer`;
`DownloaderClient.connect` refuses rather than falling back to a copy, because a silent fallback
would measure the wrong thing. `dev-server.py` and `deploy/nginx` both send the headers.

**The transport is a seam.** `config.transport` is a module URL exporting `TransportSession`,
defaulting to `client/transport/ts/dist/session.js`. A third implementation plugs in there without
the downloader knowing ([`CLIENTS.md`](../docs/CLIENTS.md) §The seam) — and it is
how the contract suite drives the downloader: `client/contract/run_browser.sh downloader`, run by the gate.
`config.decoderWorker` is the same seam for the decoder: `client/contract/run_browser.sh dispatch`
points it at a stalling stand-in to force the contention its ordering and dispatch-bound tests need.
`opts.worker` is the downloader's own script: `lab/page-open/boot.mjs` boots it from a bundle or a
blob (its relative URLs then resolve nothing, so the page names `transport` and `decoderWorker`).

**Mutate it after any change to `decoder.js`.** Perturb one decoded sample and every `sha` line must
read `MISMATCH`; drop every fifth frame and the fill must report fewer than it asked for. Both were
run; a decode path whose ground-truth check does not fire is worth nothing.
