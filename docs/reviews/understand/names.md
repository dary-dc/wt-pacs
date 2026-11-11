# Names on the demo path against the glossary

NAMES-FIND, 2026-11-11, on the demo tip `claude/demo-fixes-0` `618e13c8`. Findings only: nothing is renamed here,
and every rename waits for the owner's yes. Ranked by what each saves a reader who must explain the demo, essentials
first. Read from the code and the docs; nothing was measured or run. "Every place" lists the lines found by `grep` on
the demo tip, product and docs first; lab paths are counted, since they move with the lab's own branch
(CLEAN-FIND's §L1).

Read: the demo path's code (`client/viewer/viewer.js`, `pair.js`, `index.html`; `client/view/controller.js`,
`view.js`, `view-worker.js`; `client/decode/av1.js`, `decoder.js`; `client/paint/voi.js`), the label, the overlay,
the mark and the status line as `viewer.js` writes them, README §Demo, `client/README.md` §Optimal quality, exact on
request, and [`docs/glossary.md`](../../glossary.md).

## 1. *exact* names an ask of any frame, and the HTJ2K frame the label calls *Lossless*

**One name for two.** The glossary's *exact frame* is the exact series' frame checked against its digest. But
`requestExactFrame(i)`, the transport's ask (the glossary's *ask*, `request_frame` on the wire), is also how every
optimal-quality frame is asked: `Controller.show` asks the lossy AV1 frame through it (`client/view/controller.js:158`)
and `Controller.showExact` the exact one (`:193`). A presenter tracing `l` meets "exact" on both sides of the one
distinction the demo exists to show.

* **Rename:** `requestExactFrame` → `requestFrame`, the wire's name for it.
* **Every place:** 133 occurrences in 48 files. Product: `client/transport/consumer.js`, `downloader.js`,
  `ts/frame-session.ts`, `wasm/src/lib.rs` (its `js_name`), `client/view/controller.js:158,193`,
  `client/view/check.js` (4). Contract: `client/contract/dispatch-rig.ts` (28), `clauses.ts` (26), `downloader-rig.ts`,
  `race.ts`, `ask-during-fill.html`, `refusals.html`. Tests: `transport/downloader.test.mjs` (6), `ts/test/run.ts` (5),
  `view/controller.test.mjs` (3). Docs: `WIRE.md:187`, `CLIENTS.md:27,539`, `ARCHITECTURE.md:468,1324,1326`,
  `adr/frame-path.md` (2), `adr/telemetry-instrument-clients-from-outside.md`, `av1/README.md`, `av1/adr-unit.md` (3),
  `av1/queue.md`, `decode/README.md`. Lab: 20 files (`lab/harness/`, `lab/client-telemetry/`, `lab/page-open/`, …).
* **Risk before 11-13:** mechanical but wide (one `sed` over the list, then the full gate); every client of the
  contract moves at once. A docs-only alternative: a glossary line under *ask* saying the method's name predates
  optimal quality.

## 2. The screen asks "exact?" of a frame that cannot be checked, and a doc says it can

On an optimal-quality series the label says *Optimal quality*, and beside it the **mark** says *unchecked* on every
frame, and the **status line** counts `exact 0, not exact 0, unchecked 56`. Both read `info.exact`, the frame digest
check; an optimal-quality series carries no digests (`ingest/coded-frames/lossy_test.py:92`), so it is never anything
but unchecked. The presenter must explain a grey *unchecked* that is not a fault, and two indicators for one question.

`client/README.md:97–98` then says the opposite: "A lossy frame's own `exact` means its decode matched the encoder's
reconstruction, not the source." No optimal-quality metadata has digests, so no lossy frame has an `exact` of `true`;
README §Demo (`README.md:313`) says "a lossy frame has no digest to check".

* **Correct in place** (docs, no rename): `client/README.md:97–98`, by `CLAUDE.md` §Docs, e.g. "An optimal-quality
  frame has no digest (`lossy_test.py`), so its `exact` is unset and the mark says *unchecked*."
* **Rename, on screen only:** the mark's *unchecked* → *no digest*; the status counts `exact / not exact / unchecked`
  → `digest matched / NOT EXACT / no digest`, the glossary's *frame digest* words. Whether the mark shows at all under
  the label is a behaviour change, the owner's.
* **Every place:** `client/viewer/viewer.js:62,83,84,144`, `index.html:31` (the `.unchecked` class),
  `client/viewer/check.mjs:204,220` (reads the text), `client/view/check.js:81`, `README.md:313,320`,
  `client/README.md:103,252,257,410,436`.

## 3. `showLossy` beside the label *Optimal quality* (the evening brief's R1)

**Two names for one.** The glossary retired *lossy series* for *optimal quality* (`docs/lines/optimal-quality.md`
§Terms); the label says *Optimal quality*; the code that returns to it is `showLossy`, `View.lossy()`, the view
worker's intent `lossy`. The same drift in `checkPair(lossy, exact)`, the decoder config's `lossy: true` and the prose
"the lossy frame".

* **Rename:** `showLossy` → `showOptimal`, `View.lossy` → `View.optimal`, intent `lossy` → `optimal`; `checkPair`'s
  parameter → `optimal`; the decoder config's `lossy` → `optimal`; "the lossy frame" → "the optimal-quality frame".
* **Every place:** `client/view/controller.js:206–207`, `client/view/view.js:22,27–28,176–177`,
  `client/view/view-worker.js:138`, `client/viewer/viewer.js:154,211`, `client/view/controller.test.mjs:388`;
  `client/viewer/pair.js:25–35`; `client/decode/av1.js:13,49`; `client/README.md:96,103`.
* **Stays:** the metadata key `lossy` (`ingest/coded-frames/ingest.py:317,338`, `lossy_test.py:89`,
  `docs/av1/payload-format.md:365,408`, `client/contract/av1/payloads/depth-cut/metadata.json:11`,
  `ingest/from-dicom/from_dicom_test.py:116`, `lab/av1/provenance.py`): a format, which the glossary's *optimal
  quality* row already names; renaming it re-codes the demo set. Not before 11-13.

## 4. *view* is where frames are held, and also the picture

**One name for two.** The glossary's *view* is `page` or `worker` (`?view=`, the status line's `view page`, `View`,
`view.js`). Its own *optimal quality* row, README §Demo and the decided approaches also call the optimal-quality
picture "the view": "a series' visually lossless AV1 view", "the AV1 view", "the same view coded at 12 bits", "the OQ
view". A presenter reading the status line's `view page` aloud means the other one.

* **Rename, prose only:** the picture is "optimal quality" or "the optimal-quality picture"; *view* stays `page |
  worker`.
* **Every place:** `docs/glossary.md:37`, `README.md:195,302,310`, `docs/lines/optimal-quality.md:65,67,89`,
  `docs/av1/payload-format.md:333,391,404,436`. The queue's decided approaches use "the OQ view" too; they are the
  owner's text and are left as written.

## 5. The decode route has three names, and the status line calls it *decoders*

**Three names for one.** WebCodecs or dav1d for a frame is `info.path` and `about.path` in code, `avoid` "a path not
to take" (`client/decode/decoder.js:20`), `route()` in `client/decode/av1.js:46`, `--route` in `demo-check.mjs`, "the
decode route" in README §Demo and the overlay's docs, and `decoders: av1-webcodecs 56` on the status line, while the
glossary's *decoder* is the worker that decodes. No glossary row.

* **Rename:** one name, *route* (the screen's and the decided approaches' word): `info.path` → `info.route`,
  `seen.paths` → `seen.routes`, the status line's `decoders:` → `routes:`; a glossary row *route*: `av1-webcodecs`,
  `av1-dav1d`, `htj2k` (and the lab's `av1-mixed`).
* **Every place:** `client/decode/decoder.js:20,48–53,93,108`, `av1.js:57–82`, `htj2k.js:75`;
  `client/view/controller.js:10,84,260`, `client/view/check.js:81,138`; `client/viewer/viewer.js:132,139,145`;
  tests `client/view/controller.test.mjs:257,272,280,431,435,468,518`, `cache.test.mjs:67`;
  `client/contract/dispatch-rig.ts:1129`; `client/README.md:105,253`; lab 2 (`lab/av1/delivery/total-time/page.js:76`,
  `lab/faultbench/index.html:28`). Smallest step: the status line's word and the glossary row alone (2 places).

## 6. *Lossless* on screen, *exact* in code, and the pair's two clients named apart

**Two names for one, defensible.** The label, the button and `l` say *Lossless*; the code says exact: `showExact`,
`View.exact()`, intent `exact`, `connectExact`, `#exact`, `exactSource`. *Lossless* is the reader's word, and the
glossary's *exact frame* the code's; neither glossary row names the other. Separately, the pair's two consumers are
`controller.client` (the optimal-quality series') and `controller.exactSource` (the exact series'): one thing, two
shapes of name, and `client` is the glossary's transport implementation, the one the status line's `client ts` shows.

* **Rename:** none for *Lossless*; a glossary row *quality label* with each state's code name beside its text:
  `optimal` *Optimal quality*, `asking` *Optimal quality · fetching lossless…*, `lossless` *Lossless*, `failed`
  *Lossless check failed · optimal quality shown*. `exactSource` → `exactClient`, or both → `consumer` and
  `exactConsumer` with a glossary row *consumer* (`DownloaderClient`, `client/transport/consumer.js`).
* **Every place:** `exactSource`: `client/view/controller.js:56,190,193`, `view-worker.js:109,141,155`,
  `viewer.js:205`, `controller.test.mjs:361`. `controller.client`: `controller.js:153,158,262`,
  `view/check.js:15,76,122,145`, `view-worker.js:102,103,141,155`, `viewer.js:178,322`.

## 7. `depthCut` and `cut` are a shift count, not the depth cut

**One name for two.** The glossary's *depth cut* is a series' 10-bit form. `depthCut(meta)` (`client/viewer/pair.js:6`)
returns D − 10, and `info.cut`, `frame.cut`, `#cut` carry that count to the paint (`voi.js:47` says so: "`cut` = D −
10"). A reader seeing `cut: 2` reads a form, not a shift.

* **Rename:** `depthCut` → `cutShift`, `cut` → `cutShift` in the frame's info.
* **Every place:** `client/viewer/pair.js:6`, `pair.test.mjs:3,45–48`, `client/view/controller.js:3,8,59,67,76,99,244`,
  `client/paint/paint-worker.js:222`, `client/paint/voi.js:46–58`.

## 8. Words the presenter says that the glossary does not define

*Downloader* (used in five glossary rows, defined in none), *consumer*, *route* (§5), *quality label* (§6), *mark*,
*overlay*, *status line*, *on demand* (the status line's word for `?fill=0`), and *refusal* in its second sense: the
glossary's is the server's FoD refusal, while the overlay's `after WebCodecs refused: …` is the decoder's
(`info.refusal`, `client/decode/av1.js:37–68`) and the page's errors begin `refused:` too (`pair.js`, `viewer.js:22,40`).

* **Add:** one row each to `docs/glossary.md` §The product; *refusal* names its three users. Docs only; no code moves.

## Order, if the owner says yes

Docs before 11-13, code after: §2's correction and §8's rows (docs, no risk); then §5's and §2's screen words (the
status line and the mark, a handful of lines, with `check.mjs` and `demo-check.mjs` re-run); §3 (R1, 11 places);
§6, §7; §1 last, the widest. §4 is prose. None changes what is decoded, checked or painted.

Fixtures and limits: none were used; this is a reading of the code at `618e13c8`. Line numbers are that commit's.
