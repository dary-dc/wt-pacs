# Optimal quality

Last verified 2026-11-10 (`claude/oq-depth-cut` at `6f61ff0b`; other tips as read on 2026-11-09); the AV1
harvest's effect on the demo's claims added 2026-11-10 (§What the harvest changes), branch states not re-read.

## Goal

Build the chosen design for the demo of 2026-11-13, on `claude/core`, merged into `main` after review: every viewer
sees a series' **optimal quality** (visually lossless AV1), and a reader's explicit **Lossless** request fetches that
frame whole from its **exact series** (the HTJ2K series of the same source). No residual, no server or wire change:
the optimal-quality series is a series of its own, ingested beside its exact series, and the client pairs them.

## State now (2026-11-10)

| part | branch → base | state |
| --- | --- | --- |
| ingest | `claude/oq-ingest` → `claude/core` | built in `lab/av1/tools/ingest_coded.py --lossy Q G --exact-series ID`; the DICOM ingest does not code it yet; `lossy_test.py` in the gate; `demo-series.sh` |
| client | `claude/oq-client` → `claude/core` | built: pairing (`pair.js`), the Lossless button (`l`), the quality label, `?overlay=1`; tests pass, 21 of 22 mutants killed |
| depth cut, route | `claude/oq-depth-cut` → `claude/core` (draft PR) | built: the cut (ingest, paint, fixture); WebCodecs first for every OQ series, dav1d only after a refusal; tests pass, the route's 7 of 7 mutants killed |
| phone | `claude/phone-setup` → `claude/core` | not on `origin` when read |

* **Contract.** Metadata of an optimal-quality series: `"codec": "av1"`, `"lossy": {"q", "g", "depth"}`,
  `"exactSeries": "<id>"`, no `digests`; its frames arrive `unchecked`. A depth cut adds `lossy.bitsStored` = D.
* **Bytes, measured** (`demo-series.sh`, one run on a 4-core cloud host), as a fraction of the exact
  series' `.sbnd`: Q 8 is 0.074 (`dbts_a1`), 0.216–0.219 (`dbts_b1`), 0.095–0.096 (`dbts_c1`) at G 1, 8 and 16;
  Q 24 is 0.002–0.025. The quality at each Q is **not measured** in this build. Fixtures: those three tomosynthesis
  volumes only (56, 50 and 69 frames; 12, 10, 12 bits). These are Q 8's bytes, not the noise rule's Q's (below).
* **Decode routes** (owner's decision 2026-11-09, built on `claude/oq-depth-cut`): every OQ series tries WebCodecs
  first, at any depth; dav1d-WASM only after WebCodecs refused the frame or its ≤ 10-bit probe failed; over 10 bits
  the first refusal holds for the worker. The route in `info.path`, the refusal in `info.refusal`, both on the
  overlay. Headless Chrome for Testing 153 accepts a 12-bit config in `isConfigSupported` and refuses the unit at
  `decode`. An exact AV1 series keeps its rule (over 10 bits, dav1d alone). A jump into a group decodes from its
  keyframe on one decoder.
* **Demo series** (`demo-series.sh` on `claude/oq-depth-cut`): `dbts_a1` and `dbts_c1` as depth cuts at Q 8 and 24,
  G 1, 8 and 16, plus one stored-form series each (`…-q8-g16-stored`) to compare; `dbts_b1` at its own 10 bits. The
  script has **not been run** in this form: the Q 24 and G 8 cuts' bytes are not measured.
* **Label:** *Optimal quality*; *fetching lossless…*; *Lossless* only after the exact frame's digest matched and it
  was painted; *Lossless check failed* otherwise, the lossy frame kept.
* **Not yet run:** a browser end to end on a real pair; any phone run; the dispatch rig and the page check on a
  host with `client/decode/wasm/built/` (the 2026-11-10 gate ran there without it: those steps fail identically
  with and without the route change). The web image (`deploy/nginx`) does not serve
  the exact series' two paths. A review of each branch is due as `<branch>-fixes`.

## What the harvest changes (2026-11-10)

From [`codecs.md`](codecs.md) §AV1 harvest, which has the evidence and the branch of each. Fixtures: the three timed
DBT volumes on one 4-core cloud host, software decode; quality readings on 19 EA1141 DBT volumes; no breast
ultrasound cine.

* **Q 8 is a candidate, not visually lossless.**
  * The noise rule picks Q 8 for only two of the six timed (series, G) cells: `dbts_b1` G 16 and `dbts_c1` G 1
    (*measured*). For the others it picks `dbts_a1` Q 4, `dbts_b1` G 1 Q 12, and `dbts_c1` G 16 Q 4.
  * On `dbts_a1`, Q 8 passes the rule's 1.03 bar and fails the strict one, 1.00 (*derived*).
  * The criterion e_N ≤ σ passes a coding that deletes the noise (*derived*). No metric is validated against readers
    on DBT (*theory*).
  * The label *Optimal quality* is right. Any claim of *visually lossless* or *diagnostic* is not, until readers.
* **Bytes.** The table above stands as Q 8's. At the rule's Q the view is 0.10–0.28 of HTJ2K's bytes (*derived*).
  G 8 and G 16 saving nothing at Q 8 is an equal-Q reading, not a property of G.
* **WebCodecs.** The route stands, but nothing shows it decodes in under one HTJ2K frame on a slow device: the 4×
  throttle capped threads, not cores. At Q 8 the view decodes in about 1.55–1.81 HTJ2K frames on `dbts_a1` and
  `dbts_c1` (top-10-bit stream; *derived* after removing a harness pass). The exact ask's cost is quoted against an
  HTJ2K unit the product does not ship.
* **The depth cut.** Its cost at Q 8 in-window is unmeasured. The 0.3 dB is all-sample PSNR from one row, and banding
  was not run. It stays for the decode route only.
* **G for the demo.** G 1, 8 and 16 stay for contrast. Groups shard 1 (`dbts_b1` only) recommends no G over G 1.
  Alt-ref saves 5–6 % at equal PSNR and nothing at the noise anchor, and it makes the slowest frame 3.4–5.2× the
  median (*measured*).
* **Owed by the OQ branches:** `claude/oq-ingest` should refuse or label Q 0, which the AV1 specification makes
  lossless at these flags, and correct its equal-Q G reading.

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
   Run `demo-series.sh` once in its new form and record the cut's bytes at Q 24 and G 8.
10. Is Q 8 right for VL at the windows readers use: done (`claude/av1-window-q`, #323). e_N ÷ σ is the same at
    every window, and one display level needs Q 1–2 (12-bit) or Q 4 (10-bit). How VL is established: done
    (`claude/av1-vl-metrics`, #325); only a flicker test with readers establishes it. The owner's yes/no list is
    [`codecs.md`](codecs.md) §Open 0. Its items 2, 3 and 9 decide this demo's Q, its quoted bytes and its wording.
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
* (2026-11-09) The browser decodes the OQ view through WebCodecs; dav1d-WASM is only a fallback when WebCodecs refuses
  a config, never a default route. For D > 10 the OQ view is the depth cut at 10 bits; full fidelity is the exact
  HTJ2K frame.
* The depth cut is used only for D > 10, to decode through WebCodecs; D ≤ 10 is coded at its own depth. Splitting
  the OQ view's decoded samples into top and low streams is discarded: it needs a second encode, a lossy top cannot
  be completed by the low bits, and the screen's content could no longer be controlled.

## Pointers

`claude/oq-ingest:docs/av1/payload-format.md` §Optimal quality, `claude/oq-ingest:ingest/coded-frames/`,
`claude/oq-ingest:scripts/demo-series.sh`; `claude/oq-client:client/README.md` §A lossy series, exact on request,
`claude/oq-client:client/viewer/pair.js`, `claude/oq-client:client/view/controller.js`,
`claude/oq-client:server/dev-server.py` (`--exact-metadata`, `--exact-transport`).
`claude/oq-depth-cut:docs/av1/payload-format.md` §Decoder choice, per payload and §Depth cut,
`claude/oq-depth-cut:client/decode/av1.js`, `claude/oq-depth-cut:scripts/demo-series.sh`.
