# The demo path, simplified: proposals

Written 2026-11-11 by a session that had read none of the earlier reviews when §1 and §2 were written; §4 compares
with them afterwards. **Proposals only: nothing here is implemented, and no removal happens without the owner's yes.**

Read at `claude/demo-fixes-1` `daee0d1d` (the demo tip; `claude/demo-fixes-2` does not exist): `client/viewer`,
`client/view`, `client/paint`, `client/decode`, `client/transport` (`consumer.js`, `downloader.js`, `ts/`),
`server/dev-server.py`, `server/` (the flags and the session's shape; `read_path.rs` and the tests were not read
line by line), `README.md` §Demo, `client/README.md` §The viewer, `docs/lines/client.md`,
`docs/lines/optimal-quality.md`.

**No claim below rests on a run of mine.** Each is a reading of the code at that commit: a `grep` that shows who
uses a thing, and the name of the test that would fail if the capability went. Where a proposal needs a measurement
to decide, it says which.

## 1. Essentials: what the demo does, in one path

A presenter has to be able to say this, and no more:

1. **The page** (`viewer/index.html`, `head.js`, `viewer.js`) reads the series' metadata and the transport file,
   then starts one **downloader** worker.
2. **The downloader** (`transport/downloader.js`) owns the WebTransport session (`transport/ts/`) and a pool of
   **decoder** workers. It asks the server for frames in the order the view wants them, hands each frame's coded
   bytes to a decoder, and forgets a frame once the view has acknowledged it.
3. **A decoder** (`decode/decoder.js`) decodes one frame (AV1 through WebCodecs, dav1d-WASM if WebCodecs refuses;
   HTJ2K through OpenJPH-WASM), hashes the pixels with XXH3 when the series has digests, and posts them straight to
   the view in shared memory.
4. **The view** (`view/controller.js` over `view/store.js`) holds the frames by index, knows the current frame, and
   paints it (`paint/paint-worker.js`: WebGL2, the DICOM window as a table).
5. **The pairing**: an optimal-quality series names its exact series. The page checks the two describe one source
   (`viewer/pair.js`), opens a second downloader on the exact series' server, and on **Lossless** asks that one frame;
   the label says *Lossless* only once the frame's digest matched and it was painted.

That is five boxes and one arrow between each. The code holds that shape, and it is sound. What makes it hard to
explain is not the shape but what is threaded through it:

| what a reader meets | where | how many |
| --- | --- | --- |
| two places the view can live, chosen by URL | `?view=page`, `?view=worker` | 2 of everything the view does |
| three ways the view asks the downloader | `fill`, `ask` + `cancel`, `want` | 3 |
| three writers of a cache that is off | `?writer=store`, `decoders`, `view` | 3, none on by default |
| two cines | `View.play` (the page's timer), `clock.js` `Cine` (four tick sources) | 2, one of them lab only |
| lab and check hooks inside the product page | `viewer.js` | about 100 of 330 lines |
| settings a URL can turn | `lab/viewer/levers.js` → `?opts=` | over 20 named in the code read |
| one clock helper, written out | `at`, `abs`, `now` | 7 definitions, 3 names |

## 2. The simplest shape that keeps every capability

Written before any earlier finding was read.

**One view: the view worker.** The owner's target (2026-10-28) is that frames never return to the main thread. Then
the page is only intents and events, and these go: the page's painter (`paint/painter.js`), the paint worker's own
message handler, the controller's page branch (`#asks`, `#steps`, the cancel dance in `show`), `heldAcks` and
`port` as options (they become the only way), and the second arm of every check. `View` and `ViewWorker` become one
class. This is the largest saving and the one that needs a decision the owner has reserved for the phone runs.

**One way to ask: the want.** `want(indices)` already expresses the other two: a fill is a want of the whole series,
an on-demand step is a want of one frame. With one view, `fill`, `ask` and `cancel` stay only for the exact series'
single-frame ask and the check's protocol. Whether the exact series' ask can also be a want of one frame is a
follow-up, not a requirement.

**One cache writer, chosen by its measurement, or none in the tree until it is chosen.** The cache is a decided
capability (OPFS, no re-decoding) that is not on: no page passes `?writer=` unless the lab does. Three writers are
kept switchable for a comparison. Once the comparison names one, the other two, their plumbing in `decoder.js` and
`consumer.js`, and the `writer` argument itself go.

**The page knows nothing of the lab or the check.** `viewer.js` builds the page and exposes one handle (the view,
the event stream, the counters it already keeps). The check and the lab harness load beside it and drive that handle,
instead of the page calling `lab.started?.()`, `lab.filled?.()`, `lab.finished?.()`, tracing steps, counting
messages and polling for the fill's end.

**Start-up has one order.** `pageDials`, `viewWorkerFirst`, `glAfterDial` and `shortRuns` are four switches for one
question (what starts first). The answer becomes the code; the switches go.

**One cine.** The product's cine is a page timer; the worker's `Cine` class and its four tick sources exist for the
lab's frame-clock study. Either the worker's clock becomes the product's (the target in `docs/lines/client.md`
§Open 2) with the one source the study chose, or it lives with the lab until then.

**Layers import downwards only.** `view/controller.js` imports `viewer/pair.js`; `decode/decoder.js` imports
`view/frame-file.js`; `view/cache.js` starts `viewer/store.js` as a worker; two unrelated files are both `store.js`.
`depthCut` and `CUT_DEPTH` belong beside the payload they describe, the cache files beside each other, and one of
the two stores takes another name.

**One command starts a pair.** Two servers and a static host, with a `sed` and five flags between them, is what
`demo-check.mjs` already starts by itself. A presenter should type an ID.

What stays exactly as it is, because it is already the simplest thing that does the job: the downloader's record
and queue, the survival path (stall, re-dial, the transport file followed across a restart), the decoder's check
and second decode, the paint module's two passes, the DICOM window table, the pairing check and the label's rule,
`dev-server.py`'s headers and policy, the server's session loop. None of these has a second implementation beside
it, and each has its reason one pointer away.
