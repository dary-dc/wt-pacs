# Optimal quality

Last verified 2026-11-10 (branch tips read from `origin` that evening).

## Goal

Build the chosen design for the demo of 2026-11-13, on `claude/core`, merged into `main` after review: every viewer
sees a series' **optimal quality** (visually lossless AV1), and a reader's explicit **Lossless** request fetches that
frame whole from its **exact series** (the HTJ2K series of the same source). No residual, no server or wire change:
the optimal-quality series is a series of its own, ingested beside its exact series, and the client pairs them.

## State now (2026-11-10)

Every part is merged on `claude/core-next` (draft PR into `claude/core`; its body is the merge record, merge by merge),
after the image build fix and the signed Int8 rule: `oq-ingest` and its fixes (Q 0 and `--split` refused),
`oq-client-fixes`, `oq-depth-cut` and its fixes, `demo-e2e` (`demo-check.mjs`, README §Demo), `phone-setup` and its
fixes, `phone-pair` (README §The viewer on an Android phone, step 3b). Then #289, #299, #302,
`claude/av1-unified-mainbase` and `main`.

* **Contract.** Metadata of an optimal-quality series: `"codec": "av1"`, `"lossy": {"q", "g", "depth"}` (plus
  `bitsStored` for a depth cut), `"exactSeries": "<id>"`, no `digests`; its frames arrive `unchecked`.
* **Bytes, measured** (`demo-series.sh`, one run on a 4-core cloud host, the same to the byte in a second on
  2026-11-10), as a fraction of the exact series' `.sbnd`, at G 1, 8 and 16: Q 8 is 0.0685–0.0687 (`dbts_a1`, the
  depth cut), 0.216–0.219 (`dbts_b1`), 0.088–0.090 (`dbts_c1`, the depth cut); Q 24 is 0.003–0.025. *Corrected
  2026-11-10:* this gave 0.074 and 0.095–0.096 for `dbts_a1` and `dbts_c1`, the stored forms' fractions, not the
  cuts the demo shows. The quality at each Q is **not measured** in this build. Fixtures: those three tomosynthesis
  volumes only (56, 50 and 69 frames; 12, 10, 12 bits).
* **Decode routes:** WebCodecs first for every optimal-quality frame, a depth cut included; dav1d-WASM only after a
  refusal, named in the overlay. A WebCodecs failure inside a group is not recovered by dav1d (the owner's call).
* **Label:** *Optimal quality*; *fetching lossless…*; *Lossless* only after the exact frame's digest matched and it
  was painted; *Lossless check failed* otherwise, the optimal-quality frame kept.
* **Browser end to end on the merged branch** (CORE-NEXT-REVIEW, `3ddc0aed`, headless Chromium on SwiftShader, page
  view, ts client): `demo-check.mjs` passed on `dbts_a1-q8-g8-cut`, `dbts_b1-q8-g8`, `dbts_c1-q8-g16-cut` (every frame
  `av1-webcodecs`) and `dbts_a1-q8-g16-stored` (every frame `av1-dav1d` after WebCodecs refused), filled and with
  `fill=0`; labels *Optimal quality* → *fetching lossless…* → *Lossless* → *Optimal quality*, and *Lossless check
  failed* for a tampered digest. Not a GPU, not hardware decode, not a phone.
* **From a fresh clone** (DEMO-E2E-2, 2026-11-10, `claude/demo-e2e-2`): README §Demo word for word on one 4-core
  cloud host, Chromium 141 headless on SwiftShader; all 20 optimal-quality series passed, label in order, *Lossless*
  never before the exact frame's paint, no console error; numbers per series in `client/README.md` §Optimal quality,
  exact on request. Fixed: a certificate ending within a day was renewed by the static host after the series
  servers loaded the old one (no picture); README §Demo gained the steps before the demo from any state and the
  phone pair for a demo series.
* **The demo build** (DEMO-INTEGRATE, 2026-11-10): `claude/demo-fixes-0` (#355 into `claude/core`) is the demo tip
  `claude/core-next-fixes` plus `gate-cloud`, `double-decode-check` and `demo-e2e-2`, each a `--no-ff` merge; full
  gate OK in a cloud session (skipped: lavapipe, GL display, Firefox, nginx); CI gate and deploy green.
* **Not yet run:** any phone run. The web image (`deploy/nginx`) does not serve the exact series' two paths.

## Terms

One row each in [`docs/glossary.md`](../glossary.md) since 2026-11-10 (`claude/core-next`): *optimal quality* (and the
optimal-quality series that holds it; *lossy series* is no longer a second name), *exact series* and *exact frame*,
*depth cut*, *pairing*, *stored form*, *source sample*, *D*, *Q, G* and *coding error*. *Corrected 2026-11-10:* this
section said the depth cut adds a rounding error of at most 2^(D−11); at the clamp it is up to 2^(D−10) − 1 (3 at D 12,
for 4095 alone; `docs/av1/payload-format.md` §Depth cut).

## Open (ordered)

1. Done 2026-11-10 on `claude/core-next`: the image build (`core-ci-deploy`) and the glossary (§Terms).
2. The owner's merge words on `claude/core-next`, merge by merge ([`coordination.md`](coordination.md) §Open 2).
3. The browser end to end on the merged branch: done headless 2026-11-10, twice, the second from a fresh clone
   (State now); on a GPU and a phone, owed: the owner's laptop and phone rehearsal, README §Demo.
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
11. Lab and check code on the demo's product paths, findings only, each waiting for the owner's yes
    ([`../reviews/understand/clean.md`](../reviews/understand/clean.md), 2026-11-11 on `claude/demo-understand`):
    viewer.js's ~110 lines of check and lab hooks, five lab settings through the view worker's signatures, `onePass` and
    `reuseCopyBuffer` decided but still flags, the web image shipping `?check=`'s halves, L1 (38 paths, not 40).
12. Names on the demo path against the glossary, findings only, each waiting for the owner's yes
    ([`../reviews/understand/names.md`](../reviews/understand/names.md), 2026-11-11 on `claude/demo-understand`):
    `requestExactFrame` asks optimal-quality frames too; the mark's *unchecked* on every optimal-quality frame, and
    `client/README.md` claiming a lossy frame's `exact` (no digests exist); `showLossy` (R1); *view* for the picture;
    the decode route as `path`, `route` and `decoders:`; `depthCut` a shift count; eight words with no glossary row.
13. What the demo's page and servers read, findings only, each waiting for the owner's yes
    ([`../reviews/understand/defaults.md`](../reviews/understand/defaults.md), 2026-11-11): `?check=`, `?deadline=`,
    `?trace=`, `?settle=`, `?after=` outside the lab gate; `?cine=` one name for two levers; `?opts=` able to override
    the digests; three "Lab only" server choices in the default build.

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
  §Optimal quality, `client/README.md` §Optimal quality, exact on request).
* The demo is built on `claude/core` and reaches `main` only after review, by 2026-11-13 at the latest.
* The depth cut is used only for D > 10, to decode through WebCodecs; D ≤ 10 is coded at its own depth. Splitting
  the OQ view's decoded samples into top and low streams is discarded: it needs a second encode, a lossy top cannot
  be completed by the low bits, and the screen's content could no longer be controlled.

## Pointers

`claude/oq-ingest:docs/av1/payload-format.md` §Optimal quality, `claude/oq-ingest:ingest/coded-frames/`,
`claude/oq-ingest:scripts/demo-series.sh`; `claude/oq-client:client/README.md` §Optimal quality, exact on request,
`claude/oq-client:client/viewer/pair.js`, `claude/oq-client:client/view/controller.js`,
`claude/oq-client:server/dev-server.py` (`--exact-metadata`, `--exact-transport`).
