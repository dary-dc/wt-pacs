# Optimal quality

Last verified 2026-11-11 06:00 UTC (branch tips and the work queue read from `origin`).

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
* **Tests for a phone on lossy wireless** (TEST-MOBILE, 2026-11-11, `claude/demo-tests-mobile`): the label through a
  failed ask and its retry, the route rule by depth and in a group, `demo-check.mjs --link` through
  `lab/scripts/link_impair.py` (no `sch_netem` in the cloud kernel). Correct wherever it finished; at 40 ms one way
  and 2 % loss `dbts_a1`'s cut filled in 36 s and Lossless took 3–6 s, and `dbts_b1` did not fill in 120 s
  ([`docs/reviews/demo-tests-mobile.md`](../reviews/demo-tests-mobile.md); one run per cell, one cloud host).
* **Red team** (REDTEAM-DEMO, 2026-11-11, `claude/demo-redteam`, node tests only): five failing tests, one finding
  without a test ([`docs/reviews/demo-redteam.md`](../reviews/demo-redteam.md)). The pair's source check is
  geometry alone (no ingest writes `framesSha256`); photometric and rescale are not compared; a cut series shifts a
  frame of any bits; an empty digest list passes; the overlay gives the exact frame the series' Q, G and cut.
* **Blind review** (REVIEW-BLIND, 2026-11-11, `claude/demo-review-blind`): [`docs/reviews/demo-blind.md`](../reviews/demo-blind.md),
  code paths only, no fixture run. Five correctness findings, none paints a wrong frame as *Lossless*: the `unchecked`
  mark on every optimal-quality frame beside its label, a lossless failure left on the status line after a passing
  retry, the overlay's Q/G on the exact frame, the stored form admitted by `pairOf`, `--codec lossy` accepted; owner
  calls: the stored form in the demo list, and dav1d's 623 KB preloaded on every AV1 page though WebCodecs is first.
* **Fixes, round 1** (FIX-1, 2026-11-11, `claude/demo-fixes-1`, merging `demo-view-worker` and the three finding
  branches): the red team's five tests pass and run in the gate. A depth cut's frame not decoded at 10 bits is refused
  by name; `checkPair` requires the same `framesSha256` in both series (the demo set carries it: `fetch_data.py`
  writes it, `ingest_coded.py` copies it into both), the same `photometric`, `rescale` and `perFrame`, and a 16-hex
  digest per frame; dot-segment ids are refused. The blind review's C1–C3 as `viewer/screen.js` with a node test (no
  `unchecked` mark beside a label, no Q/G on the exact frame, a passed retry clears its failure), C5 (`--codec lossy`
  refused), S1. Answered, not changed: C4, D1, D2 (owner calls), S2–S4, D3 (no change asked). Node tests only for the
  fixes; the browser check not re-run on a demo series here.
* **End to end on round 1** (E2E-3, 2026-11-11, `claude/demo-fixes-1` at `9e2ef4ef`, the rehearsal commit):
  `demo-series.sh` to the byte as before; `demo-check.mjs` on all 20 series under the page view, the view worker, and
  the page view under #362's stricter check, interleaved by series: 60 of 60 passed, headless on one cloud host
  ([`docs/reviews/e2e-3.md`](../reviews/e2e-3.md), with the owner's rehearsal list). #362 (the check's Home and
  *Lossless*-paint fixes) is not in `demo-fixes-1`: without it the check stalled 30 s on 12 of 28 a1/c1 runs.
* **Source fingerprint** (SOURCE-FINGERPRINT, 2026-11-11, `claude/source-fingerprint` from `claude/demo-fixes-1`,
  not merged): every series the ingests write (`ingest_coded.py`, `from_dicom.py`, the Rust ingest) carries
  `sourceFingerprint`, XXH3-64 over the source's frame digests as its HTJ2K series carries them; `checkPair` requires
  the same 16 hex digits in both series instead of `framesSha256`, which stays the fetcher's download pin and is no
  longer copied into a series ([`../av1/payload-format.md`](../av1/payload-format.md) §Source fingerprint). Synthetic
  sets and node tests, every new test mutated. `demo-series.sh` run again (one 4-core cloud host, 685 s with the
  coders built): every exact bundle 43 B smaller (`framesSha256` out, `sourceFingerprint` in), each optimal-quality
  bundle the same size; each set's eight or seven series carry one fingerprint, the three sets three; `checkPair`
  accepts all 20 pairs and refuses each against the other two sets' exact series by source (a node script over the
  metadata; no browser run on these series).
* **Integrity, a proposal** (OQ-INTEGRITY-BUILD, 2026-11-11, `claude/oq-integrity-build` from
  `claude/source-fingerprint`, not for the demo): OQ-INTEGRITY's I1–I3 built behind one switch, the ingest's
  `--integrity` (`demo-series.sh` under `INTEGRITY=1`), off by default. The ingest writes each frame's reconstruction
  digest and coding error into `lossy`; the decoder checks the digest (`asCoded`, never `exact`), decodes a
  mismatched frame inside a group again from its keyframe on dav1d-WASM after WebCodecs, and the controller refuses a
  frame matched on neither route; the label says *Optimal quality ✓* on a matched frame, the overlay the check and
  the error ([`../av1/payload-format.md`](../av1/payload-format.md) §Integrity). Synthetic sets and stand-in decoders
  in the tests; I1's protocol run in §Integrity. The owner decides whether and when.
* **Not yet run:** any phone run. The web image (`deploy/nginx`) does not serve the exact series' two paths.

* **The night of 2026-11-11** (work queue `claude/work-ledger:docs/queue-2026-11-10.md`, rows run in parallel, up to
  twelve): running REDTEAM-DEMO, REVIEW-BLIND, TEST-MOBILE, AV1-CORRECT, OPT-THEORY, and the rows added that night:
  VIEW-WORKER-CHECK (`demo-check.mjs --view page|worker`, all 20 series under both views, headless), PHONE-NO-INSTALL
  (the phone run on a laptop without installs), and five findings-only rows for understanding: OPT-SIMPLIFY,
  CLEAN-FIND, NAMES-FIND, DEFAULTS-FIND, ESSENTIALS. FIX-1, MEASURE-1, REDTEAM-PROPOSALS and E2E-3 follow as their
  inputs finish. Two Fable 5.2 sessions, proposals only: FABLE-SIMPLIFY (11-11 16:00 UTC, `claude/fable-simplify`) and
  FABLE-DESIGN (11-12 15:00 UTC, on the unified tip, `claude/fable-design`). Each row writes its result to
  `docs/queue/<ROW>.md` on `claude/work-ledger`.
* **The laptop for the phone run** may not install anything (the owner, 2026-11-11). Present: cargo and rustc 1.97,
  Python 3.15, git, curl, jq, gcc, `tc`, podman with a local `rust` image (it has `openssl`) and the wt-pacs images,
  Firefox. Absent: the `openssl` command, `adb`, node and npm, cmake, meson, nasm, ninja, Python 3.11 to 3.13, Chrome,
  root. What that leaves (read on the machine, not yet run): the page needs no build (the ts bundle and the decoders
  are committed); `series-server` builds with cargo; `dev-server.py` is standard library only; the certificate can
  be made in the `rust` image; the demo series cannot be coded there (the coders and the ingest venv need what is
  absent), so they are coded elsewhere and copied; without `adb` the phone needs the page on the laptop's address,
  which `dev-server.py` does not offer yet (it binds 127.0.0.1 and its CSP names only that); netem needs root. Fedora
  Workstation's zone admits UDP and TCP 1025 to 65535; which zone the phone's link lands in is the owner's check.

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
5. Phone runs: the owner is ready to run them at any time. On the laptop without installs (State now), after
   PHONE-NO-INSTALL lands, the owner answers: (a) what counts as installing: crates fetched by cargo into the home
   directory, podman images already present, a portable binary such as `adb` in the home directory; (b) how the
   demo series reach the laptop (their sizes come from PHONE-NO-INSTALL); (c) which laptop and phone; (d) the
   demo's loss and delay without netem (root), or netem dropped for it. The owner runs
   `sudo firewall-cmd --get-default-zone; sudo firewall-cmd --get-active-zones`, again with tethering on.
11. Understanding before 11-13: the findings of OPT-SIMPLIFY, CLEAN-FIND, NAMES-FIND, DEFAULTS-FIND, ESSENTIALS and
    FABLE-SIMPLIFY, each ranked by what it saves a presenter; the owner chooses what goes in before the demo and what
    after. Then a reading pass with the owner, ESSENTIALS' points first, deeper only where time allows.
12. Which view the demo shows: the view worker is the target (`client.md`, 2026-10-28); VIEW-WORKER-CHECK says only
    whether it meets the page view's correctness bar headless; on the phone both views run on the same series,
    alternated; the owner chooses. If the worker is shown, the page view's removal is the first simplification after.
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
  §Optimal quality, `client/README.md` §Optimal quality, exact on request).
* The demo is built on `claude/core` and reaches `main` only after review, by 2026-11-13 at the latest.
* The depth cut is used only for D > 10, to decode through WebCodecs; D ≤ 10 is coded at its own depth. Splitting
  the OQ view's decoded samples into top and low streams is discarded: it needs a second encode, a lossy top cannot
  be completed by the low bits, and the screen's content could no longer be controlled.

## Decisions (the owner's, 2026-11-11)

* The unification is done as part of building the demo, limited to what the demo touches: one path into `main`, one
  name per concept and one implementation per job on the demo path. The rest of the repository's unification
  ([`coordination.md`](coordination.md) §Unification) follows after 2026-11-13.
* "I cannot show to the team something that I don't know what it's doing, or I cannot explain": understanding is a
  requirement of the demo, so that the team can keep contributing and steering. Simplification, cleaning, names,
  defaults and an essentials-first explanation are investigated first, findings only; the owner decides what goes
  in and when, by results, impact and importance.
* The reading pass starts from the essential points and goes deeper only if time allows or when convenient.
* Two Fable 5.2 sessions: simplification, and design improvement once the stack is unified; proposals only.
* The phone run's laptop takes no installs: find the minimum from what is present. Checks that need elevation are
  handed to the owner; the work goes on without them until their output comes.
* The usage window is free: the queue's rows run in parallel.
* wt-pacs stays self-contained: the state of its lines lives in `docs/lines/`; the private notes keep only rules such
  as the forbidden topics and strings.

## Decisions (the owner's, 2026-11-11, afternoon)

* The demo is given from `main`: the approaches chosen with the team are the product's candidates. After the freeze
  the owner merges the demo tip into `claude/core`, then `claude/core` into `main` (PR 250), as merge commits, never
  squashed: history is preserved.
* The optimal-quality series is always ≤ 10 bits: D > 10 is always the depth cut, so WebCodecs decodes it; dav1d is
  only the fallback where WebCodecs refuses or fails at ≤ 10 bits ("it doesn't make sense to pay for a slow decoding
  for the preview, which is intended to be fast"). The stored form leaves the demo's show list.
* Congestion control: `cubic-restart` stays the default and both controllers are kept. MEASURE-1's "adopt" for BBR
  holds only in its cells (random loss, a 1 000-packet buffer); congestive loss, a neighbour and a jump during the
  fill were not tested ([`../transport/transport-conclusions.md`](../transport/transport-conclusions.md) §1). The
  phone runs use both controllers on real links, because simulations may differ from a real-world link.
* The pairing's same-source check stays and belongs in the ingest, with XXH3 like the frame check, not SHA-256. Beyond
  the source, an optimal-quality frame's quality should be guaranteed to be what the screen says: investigated as
  theory first.
* The quality mark: green beside *Optimal quality*; *Lossless* distinct. The status line can be opened by a tap on a
  phone. Slices step by touch as established viewers do; the UX keeps changing as it is iterated.
* The page view is not removed; the phone runs decide between the views, in a separate local session, while the
  coordinating session keeps the queue.
* The application loads while the series loads, as when a reader opens a study's URL directly; no listing view is
  built for the demo. Loading dav1d only when WebCodecs refuses is investigated.
* Tiles in the AV1 encode wait until after the demo; HTJ2K with tiles and resolution levels matched to the screen,
  for DBT and other large matrices, is investigated, formalized and compared with the demo's approach.

## Known before the demo, fixed after it

What a presenter should know, from the reviews of 2026-11-11 (`claude/demo-understand:docs/reviews/understand/`,
`claude/demo-pre-main-review:docs/reviews/pre-main.md`):

* The code calls every frame request `requestExactFrame`, optimal-quality frames included, and the optimal-quality
  state `showLossy` (`View.lossy`, the intent `lossy`) where the screen says *Optimal quality* (NAMES-FIND 1, 3).
* The web image ships the check hooks (`check-page.js`, `view/check.js`), so `?check=` works in production; on the
  lab host `?opts=` can switch the exactness check off from the URL (DEFAULTS-FIND 1, 4).
* About 110 of `viewer.js`'s 334 lines are check and lab hooks (CLEAN-FIND).
* PR 250 brings to `main` new `lab/` directories (about 5 100 lines, `lab/target-review` among them) and
  `client/native` (+3 303); moving any off `main` names each item and waits for the owner's yes (PRE-MAIN-REVIEW §4).
* The decoders' WASM is committed and the gate checks it rebuilds to the same bytes; that is what lets the laptop
  without installs run the page without Docker.
* `framesSha256` is written only by the lab fixture fetcher, so a pair made by any other ingest fails the pairing
  check until the ingest writes the source fingerprint (row SOURCE-FINGERPRINT). *Built 2026-11-11 on
  `claude/source-fingerprint`, not in the demo:* every ingest writes `sourceFingerprint` and `checkPair` compares it
  in place of `framesSha256`; it enters the demo only with the owner's word, since every demo series must be written
  again.

## Pointers

`claude/oq-ingest:docs/av1/payload-format.md` §Optimal quality, `claude/oq-ingest:ingest/coded-frames/`,
`claude/oq-ingest:scripts/demo-series.sh`; `claude/oq-client:client/README.md` §Optimal quality, exact on request,
`claude/oq-client:client/viewer/pair.js`, `claude/oq-client:client/view/controller.js`,
`claude/oq-client:server/dev-server.py` (`--exact-metadata`, `--exact-transport`).
