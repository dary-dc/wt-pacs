# Optimal quality

Last verified 2026-11-09 (branch tips read from `origin` that evening).

## Goal

Build the chosen design for the demo of 2026-11-13, on `claude/core`, merged into `main` after review: every viewer
sees a series' **optimal quality** (visually lossless AV1), and a reader's explicit **Lossless** request fetches that
frame whole from its **exact series** (the HTJ2K series of the same source). No residual, no server or wire change:
the optimal-quality series is a series of its own, ingested beside its exact series, and the client pairs them.

## State now (2026-11-09)

| part | branch → base | state |
| --- | --- | --- |
| ingest | `claude/oq-ingest` → `claude/core` | built in `lab/av1/tools/ingest_coded.py --lossy Q G --exact-series ID`; the DICOM ingest does not code it yet; `lossy_test.py` in the gate; `demo-series.sh`; reviewed 2026-11-10 on `claude/oq-ingest-fixes` (→ `claude/oq-ingest`): Q 0 refused (measured lossless at 8, 10, 12 bits), `--split` with `--lossy` refused; open: the ingest's own check of a lossy frame tests only its decoded shape, not its closeness |
| client | `claude/oq-client` → `claude/core` | built: pairing (`pair.js`), the Lossless button (`l`), the quality label, `?overlay=1`; tests pass, 21 of 22 mutants killed |
| phone | `claude/phone-setup` → `claude/core`; `claude/phone-pair` (#343) → `claude/phone-setup` | README §The viewer on an Android phone: one series, and since 2026-11-10 a pair (exact server on 4434); the pair checked only in a network namespace on a synthetic 10-bit pair, `l` read *Lossless*; no phone run |

* **Contract.** Metadata of an optimal-quality series: `"codec": "av1"`, `"lossy": {"q", "g", "depth"}`,
  `"exactSeries": "<id>"`, no `digests`; its frames arrive `unchecked`. No top-10-bit form yet.
* **Bytes, measured** (`demo-series.sh`, one run on a 4-core cloud host), as a fraction of the exact
  series' `.sbnd`: Q 8 is 0.074 (`dbts_a1`), 0.216–0.219 (`dbts_b1`), 0.095–0.096 (`dbts_c1`) at G 1, 8 and 16;
  Q 24 is 0.002–0.025. The quality at each Q is **not measured** in this build. Fixtures: those three tomosynthesis
  volumes only (56, 50 and 69 frames; 12, 10, 12 bits).
* **Decode routes:** ≤ 10 bits through WebCodecs where its probe passed; 12 bits and any refused config through
  dav1d-WASM; the route in each frame's `info.path`. A jump into a group decodes from its keyframe on one decoder.
* **Label:** *Optimal quality*; *fetching lossless…*; *Lossless* only after the exact frame's digest matched and it
  was painted; *Lossless check failed* otherwise, the lossy frame kept.
* **Not yet run:** a browser end to end on a real pair; any phone run. The web image (`deploy/nginx`) does not serve
  the exact series' two paths. A review of each branch is due as `<branch>-fixes`.

## Terms (to move into `docs/glossary.md` when the two branches' entries are reconciled)

* **source sample**: a pixel's value as stored in the series' DICOM pixel data; the exact frame carries it unchanged.
* **D**: the series' stored bit depth, DICOM *Bits Stored* (0028,0101).
* **OQ view** (optimal quality): the lossy AV1 view every viewer sees; **exact frame**: the HTJ2K frame of the
  source samples, sent on request.
* **Q**: the OQ view's quality level, libaom's quantizer (higher Q, more error); **G**: frames per keyframe.
* **coding error**: OQ value − source sample. **Depth cut**: coding the OQ view from `round(sample / 2^(D−10))` at
  10 bits so WebCodecs can decode a D > 10 series; it adds a **rounding error** of at most 2^(D−11).

## Open (ordered)

1. `claude/core`'s CI `deploy` failure (the native crate, `claude/core:client/native`, not copied by
   `deploy/Containerfile`); [`coordination.md`](coordination.md) §Open 2 has the reviewed path into `main`.
2. Reconcile `docs/glossary.md`: both branches add **exact series**, worded differently; ingest adds
   **optimal quality** and **pairing**, client **lossy series, optimal quality**. One concept, one name.
3. Review both branches; merge into `core`; then the browser end to end on a pair from `demo-series.sh`.
4. Serve the exact series' paths from the web image.
5. Phone runs: tethering for development and decode numbers; Wi-Fi plus netem for transport realism and the demo.
6. The DICOM ingest codes optimal quality (today only the lab tool does).
7. The depth cut for D > 10 (the OQ view through WebCodecs, painted from its 10-bit codes through a window table, no
   shift pass); D ≤ 10 needs none. Build `claude/oq-depth-cut` (stacks on the two OQ branches). Full fidelity is the
   exact HTJ2K frame; a 12-bit OQ view through dav1d is the same lossy view at the stored depth, a decode alternative.
10. Is Q 8 right for VL at the windows readers use (display-unit error per window width): `claude/av1-window-q`; how VL
    is established and which metrics experts use (PSNR's limits, windows, guidelines): `claude/av1-vl-metrics`.
8. Narrow windows show the coding error most: an explicit Lossless request now; an automatic exact request when the
   window is narrow (or a reading mode) is an option to compare, with the threshold set by readers, not chosen here.
9. Later, a separate approach outside this sprint: HTJ2K with resolution levels and tiles for large matrices and high D
   (protocol on `claude/htj2k-tiles`).

## Decisions (the owner's, 2026-11-09)

* The design: optimal quality (visually lossless AV1) plus the exact HTJ2K frame on explicit request; the residual
  dropped.
* G fixed per modality by measurement, no adaptive detector; Q per series by the noise rule
  ([`codecs.md`](codecs.md)); the PCS chooses; our side handles any Q, G and depth. For the demo: Q 8 (the noise
  rule's candidate on DBT; not yet confirmed visually lossless by readers) and Q 24 (for contrast), G 1, 8 and 16, hard-coded.
* The label says *Optimal quality* or *Lossless*, the latter only after the checksum passes; a developer overlay
  behind a toggle.
* Phone: tethering for development and decode numbers; Wi-Fi plus netem for transport realism and the demo.
* No per-build "how it works" pages: the design lives in the doc that owns it (`docs/av1/payload-format.md`
  §Optimal quality, `client/README.md` §A lossy series, exact on request).
* The demo is built on `claude/core` and reaches `main` only after review, by 2026-11-13 at the latest.
* The depth cut is used only for D > 10, to decode through WebCodecs; D ≤ 10 is coded at its own depth. Splitting
  the OQ view's decoded samples into top and low streams is discarded: it needs a second encode, a lossy top cannot
  be completed by the low bits, and the screen's content could no longer be controlled.

## Pointers

`claude/oq-ingest:docs/av1/payload-format.md` §Optimal quality, `claude/oq-ingest:ingest/coded-frames/`,
`claude/oq-ingest:scripts/demo-series.sh`; `claude/oq-client:client/README.md` §A lossy series, exact on request,
`claude/oq-client:client/viewer/pair.js`, `claude/oq-client:client/view/controller.js`,
`claude/oq-client:server/dev-server.py` (`--exact-metadata`, `--exact-transport`).
