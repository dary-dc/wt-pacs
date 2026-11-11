# Demo review, blind: `claude/core...claude/demo-fixes-0`

REVIEW-BLIND of the work queue, 2026-11-11. The demo tip is `claude/demo-fixes-0` at 618e13c8 (the newest of the
queue's demo branches that exists). Findings only; nothing is fixed here. FIX-1 fixes each or answers it with evidence.

**What was read, in order.** The product diff first: `client/viewer/{viewer.js,pair.js,head.js,index.html}`,
`client/view/{controller.js,store.js,view.js,view-worker.js,clock.js}`, `client/decode/{av1.js,av1-webcodecs.js,
av1-frame.js,decoder.js}`, `client/transport/{consumer.js,downloader.js}`, `client/paint/{voi.js,painter.js,
paint-worker.js,settle.js}`, `ingest/coded-frames/{ingest.py,decode.cpp}`, `lab/av1/tools/ingest_coded.py`,
`scripts/demo-series.sh`, `server/dev-server.py`, `.github/workflows/gate.yml`; then `docs/glossary.md` and
`client/README.md` to check names and claims. Not blind in one respect: the queue's procedure made this session read
the DEMO-INTEGRATE and REDTEAM-DEMO status files before the code; findings that REDTEAM-DEMO also holds say so.
Not read: `client/native/`, the lab paths, the measurement scripts (`scripts/perf_*`), the docs diff.

**What was run.** `node client/view/controller.test.mjs` (32/32), `node client/viewer/pair.test.mjs` (ok),
`node --test client/decode/av1.test.mjs` (pass), `scripts/comment_budget.sh` (ok). No browser, no fixture run, no
gate: every finding is about a code path, not a measured behaviour. Fixtures named by the demo: `dbts_a1`, `dbts_b1`,
`dbts_c1`, all from one dataset; no breast ultrasound cine; the host is a 4-core cloud container without a GPU.

Ranked within each section, most consequential first. *Smallest fix* is a sketch, not tested.

## Correctness

**C1. Every optimal-quality frame is marked `unchecked` on screen beside the label *Optimal quality*.**
`client/viewer/viewer.js:83`. The mark follows `s.exact`; an optimal-quality series carries no digests, so each of its
frames arrives with `exact` undefined and `#mark.unchecked` is shown in grey, top left, while the quality label says
*Optimal quality*, top right. It follows `client/README.md` §Exactness word for word, so it is not a slip of the code,
but the screen then says two things of one frame, one of which reads as a failure to a viewer. *Smallest fix:* the
label supersedes the mark for a series that has one: `markEl.className = s.quality ? "" : …` (and the same for its
text), with `client/README.md` §Exactness saying so.

**C2. A lossless check that fails and then passes on a retry leaves the error on the status line.**
`client/viewer/viewer.js:149` with `client/view/controller.js` `showExact` (emits `failed`). `status()` shows the
last of `errors`, which nothing clears; after `l` → *Lossless check failed* → `l` → *Lossless*, the status line still
ends `error: frame i: lossless: …`. *Smallest fix:* keep the lossless failure out of `errors` (the label already
names it), or drop it from `errors` once that frame is shown lossless.

**C3. The overlay gives the exact frame the optimal-quality series' Q, G and depth.** `client/viewer/viewer.js:130–133`.
`series` is built from `meta.lossy` whatever is painted; when *Lossless* is shown the overlay reads `htj2k · … · Q 8 ·
G 16 · 10-bit depth cut of 12`. REDTEAM-DEMO holds this one too, without a test. *Smallest fix:* omit `series` when
`quality === "lossless"`.

**C4. `pairOf` admits an optimal-quality series over 10 bits that is not a depth cut, and the decoder then tries
WebCodecs on it with no probe.** `client/viewer/pair.js:13` accepts any whole `depth ≥ 8`; `client/decode/av1.js:49–50`
sends a `lossy` payload of depth > 10 to WebCodecs with an empty probe list. The decided approach is that D > 10 is
shown as its depth cut; the demo set still carries one such *stored form* series per 12-bit set
(`scripts/demo-series.sh:38`, glossary *stored form*: a comparison). It decodes (dav1d after WebCodecs fails, the
refusal kept per worker), so nothing wrong is painted; the finding is that the product path admits and routes a form
the design excludes. *Smallest fix:* either `pairOf` refuses `depth > 10` without `bitsStored` and the stored-form
series leaves the demo list for the lab, or the glossary's *stored form* is named in `pair.js` as the one admitted
exception.

**C5. `ingest_coded.py --codec lossy` is accepted and fails with a `TypeError`.** `lab/av1/tools/ingest_coded.py:30`
offers `choices=list(ingest.CODECS)`, which now includes `lossy`; without `--lossy`, `coded()` hands `lossy()` the
representation arguments, one more than `lossy()` takes. Nothing is written, so no wrong series
results. *Smallest fix:* `choices=["av1", "htj2k"]`.

Checked and held: the label's rule (`Controller.quality`, *Lossless* only for the exact slot's frame whose
`info.exact === true`); the retry after a failed check (a fresh slot; the shared ask is cleared before the await
resumes); leaving the frame drops the slot and a late answer is ignored (`this.#exact !== e`); the one-pass merge
(`av1-frame.js` `merge`) equals the two-pass `begin`/`end` for a split frame, rct and split being refused together
by `av1-payload.js:33`; the depth cut's rounding (`ingest.py` `depth_cut`, half up, so `c · 2^cut` in `valueAt` and
`windowTable` is centred, as the glossary's *depth cut* says); the downloader's late-frame change keeps such a frame
wanted; the dev server's exact paths serve only the two files named.

## Standards (`CLAUDE.md`)

**S1. Lab levers sit in product modules and in their contracts.** `client/decode/av1.js:13` (one docstring line of
about 450 characters naming `mixed`, `onePass`, `reuseCopyBuffer` and two pre-registered protocols),
`client/decode/av1-webcodecs.js:11–19`, `client/transport/downloader.js:264` (`shortRuns`),
`client/view/view-worker.js` (`glAfterDial`, `pageDials` via `view.js`), `client/view/view.js` (`ViewWorker.boot`,
`viewWorkerFirst`), `client/viewer/viewer.js` (`lab.settle`, `lab.filled`, `lab.cine`, `firstWant`). Each is off by
default, so the demo path is unchanged; the cost is the reader's, who must tell the product from the experiments.
The single long docstring line meets the comment budget's letter (one line) and not its intent (*one line, in the
common case*; a paragraph wants `docs/`). *Smallest fix:* the `av1.js` docstring to one clause and a pointer;
the levers themselves are CLEAN-FIND's inventory, not this review's.

**S2. The demo's optimal-quality series are made by a lab tool.** `scripts/demo-series.sh:28` calls
`lab/av1/tools/ingest_coded.py`; the product's ingest (`ingest/from-dicom`) has no `--lossy` route. The product
therefore depends on `lab/` for the series it shows. *Smallest fix:* none before the demo; record it in
`docs/lines/optimal-quality.md` §Open as the path from lab to product ingest.

**S3. One name, two senses: `exact`.** `info.exact` is a frame's digest verdict (glossary *frame digest*); `exact
series`, `exactSource`, `showExact`, `connectExact` are the HTJ2K series of a pair (glossary *exact series*). The two
meet in `Controller.quality`, where `e.frame … f.info.exact === true` reads as a tautology. *Smallest fix:* none in
code before the demo; a glossary line that says `exact` names both and how to tell them apart. NAMES-FIND owns the
rename question, as it owns `showLossy` beside the label *Optimal quality*.

**S4. Test claims.** The new controller tests state their claims in their doc comments, as `CLAUDE.md` asks
(`client/view/controller.test.mjs`, the exact request, the label before the checksum, the retry, the depth cut's
shift). No test covers C1–C3: `viewer.js` has no node seam, so the screen's mark, status line and overlay are
checked only in the browser check.

## Defaults on the product path

**D1. Every AV1 page preloads dav1d (623 KB of WASM) though WebCodecs decodes first.** `client/viewer/head.js:32–33`.
`av1.js` imports `av1-dav1d.js` only after a refusal, so on a phone whose WebCodecs takes the series the preload is
bytes that compete with the fill on the link the target names (mobile, lossy wireless). For a pair, the exact
series' `openjph` is not preloaded (it is fetched on the first `l`, where its latency is the reader's). Not measured.
*Smallest fix:* for `codec: "av1"`, preload the AV1 modules but not `dav1d.{js,wasm}`; whether to preload `openjph`
for a pair is a latency trade for a measurement to decide.

**D2. The demo list carries the stored-form series.** `scripts/demo-series.sh:38` (see C4). A presenter who opens it
sees dav1d named on the overlay after a WebCodecs refusal, which is the comparison it was made for, but also the one
route the decided approach calls a fallback. *Smallest fix:* say in README §Demo which series is the comparison.

**D3. `?overlay=1` is a product URL parameter, and the overlay is the only place the route is named.**
`client/viewer/viewer.js:135`. The decided approach asks that the overlay name the route and why; it does, behind a
toggle, as the owner decided. Noted for DEFAULTS-FIND's inventory, no change asked.

## For FIX-1

C1, C2, C3 and C5 each want a failing check first: C1–C3 in the browser check (`client/viewer/demo-check.mjs`) or
a node seam for the label/mark/overlay text; C5 in `ingest_coded.py`'s argument test. C4 and D1 are owner calls:
C4 whether the stored form stays admitted, D1 whether dav1d is preloaded.
