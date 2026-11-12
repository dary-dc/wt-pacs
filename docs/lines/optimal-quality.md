# Optimal quality

Last verified 2026-11-12 against the demo tip `claude/demo-fixes-2` `18d2d1ff` (the demo commit `157b7109` plus docs;
PR 367), the work queue's status files on `claude/work-ledger`, `claude/oq-integrity-build` (#368), `claude/ingest-oq`,
`claude/phone-rows`, `claude/proposals` (#358), `claude/lines-ready`, `claude/merge-plan` and the open PRs.

## 1. Goal

Every viewer sees a series' **optimal quality**, an AV1 series coded to be visually lossless (Q 8 is the noise rule's
candidate, not yet confirmed by readers), and a reader's explicit **Lossless** request fetches that frame whole, bit
for bit, from its **exact series** (the HTJ2K series of the same source). No residual, no server or wire change: the
two are series of their own, ingested side by side, and the client pairs them.

## 2. On `main` after this week's merge

What PR 367 then PR 250 carry once the owner gives the two words (`claude/merge-plan:docs/reviews/merge-plan.md`;
[`coordination.md`](coordination.md)); none of it is on `main` yet. The line has no unified branch of its own: it
rides `claude/unified-client` with the client and native lines (`claude/lines-ready:docs/reviews/lines-ready.md` §7).

* **Contract** ([`../av1/payload-format.md`](../av1/payload-format.md) §Optimal quality, §Depth cut, §Source
  fingerprint): `"codec": "av1"`, `"lossy": {"q", "g", "depth"}` (plus `bitsStored` for a depth cut),
  `"exactSeries": "<id>"`, `sourceFingerprint` (XXH3-64 over the source's frame digests, the same in both series), no
  `digests`; its frames arrive `unchecked`.
* **Writing a pair: the lab tool only.** `ingest/coded-frames/ingest.py` and `scripts/demo-series.sh` write the 21
  demo series (three exact, 18 optimal quality at Q 8 and 24, G 1, 8 and 16; the stored form only with
  `STORED_FORM=1`); every ingest (`ingest.py`, `ingest/from-dicom/from_dicom.py`, the Rust ingest) writes
  `sourceFingerprint`. The product ingest does not code optimal quality (§4 item 2).
* **Client** (`client/README.md` *Optimal quality, exact on request*): `client/viewer/pair.js` (`pairOf`, `checkPair`:
  same fingerprint, photometric, rescale, per-frame layout, a 16-hex digest per exact frame; dot-segment ids
  refused); WebCodecs decodes every optimal-quality frame, a depth cut included, and a cut frame not decoded at 10 bits
  is refused by name; dav1d-WASM only after a refusal, named in the overlay; a WebCodecs failure inside a group is
  not recovered by dav1d. The label (`client/viewer/screen.js`): *Optimal quality* (green), *fetching lossless…*,
  *✓ Lossless* (blue) only after the exact frame's digest matched and it was painted, *Lossless check failed* (red)
  with the optimal-quality frame kept; words always beside the colour; a tap unfolds the status line on a phone.
* **Serving**: `server/dev-server.py --exact-metadata --exact-transport`; the web image's `--profile pair` with
  `EXACT_SERIES` serves the exact series from a second server on 4434 (`deploy/README.md` §Run it); README §Demo,
  including the laptop-without-installs variant (`dev-server.py --bind`, Chrome's *Insecure origins treated as
  secure*).
* **Bytes, measured** (`demo-series.sh`, 4-core cloud host, the same to the byte across runs), as a fraction of the
  exact series' `.sbnd` at G 1, 8 and 16: Q 8 is 0.0685–0.0687 (`dbts_a1`, the depth cut), 0.216–0.219 (`dbts_b1`),
  0.088–0.090 (`dbts_c1`, the depth cut); Q 24 is 0.003–0.025. Quality per Q: [`codecs.md`](codecs.md) §4 item 1.
* **Correctness, on the demo commit** (FREEZE-E2E, [`../reviews/freeze-e2e.md`](../reviews/freeze-e2e.md)): README
  §Demo's check loop, 18 series plus two with WebCodecs refused, under the page view and the view worker,
  interleaved: 40 of 40 passed; full gate OK. `demo-check.mjs` checks the label's order, *Lossless* never before the
  exact frame's paint, and `Home`'s paint. Earlier records: [`../reviews/e2e-3.md`](../reviews/e2e-3.md),
  [`../reviews/demo-e2e-2.md`](../reviews/demo-e2e-2.md), [`../reviews/demo-tests-mobile.md`](../reviews/demo-tests-mobile.md),
  [`../reviews/demo-redteam.md`](../reviews/demo-redteam.md), [`../reviews/demo-blind.md`](../reviews/demo-blind.md).
* **Terms**, one row each in [`../glossary.md`](../glossary.md): optimal quality, exact series and exact frame, depth
  cut (rounding error up to 2^(D−10) − 1 at the clamp, 3 at D 12), pairing, stored form, source sample, D, Q and G,
  coding error, source fingerprint.

Fixtures for every result in this file unless it says otherwise: three DBT volumes of one dataset (`dbts_a1`,
`dbts_b1`, `dbts_c1`; 56, 50, 69 frames; 12, 10, 12 bits); no breast ultrasound cine; 4-core cloud hosts without a
GPU, headless Chromium on SwiftShader, software WebCodecs; one phone run (§4 item 4).

## 3. Decided (never reopened by an agent)

| decision | date | recorded |
| --- | --- | --- |
| Optimal quality plus the exact HTJ2K frame on explicit request; the residual dropped | 2026-11-09 | this file; [`codecs.md`](codecs.md) §3 |
| G fixed per modality by measurement, no adaptive detector; Q per series by the noise rule; the PCS chooses, our side handles any Q, G and depth | 2026-11-09 | same |
| The label says *Optimal quality* or *Lossless*, the latter only after the check passes; a developer overlay behind a toggle | 2026-11-09 | this file |
| The design lives in the doc that owns it (`payload-format.md`, `client/README.md`), no per-build pages | 2026-11-09 | this file |
| D > 10: the depth cut to 10 bits; D ≤ 10 coded at its own depth; splitting the view into top and low streams discarded | 2026-11-09 | this file; `payload-format.md` §Depth cut |
| The optimal-quality series is always ≤ 10 bits on the product path; the stored form is a lab option off the show list | 2026-11-11 13:30 | `claude/work-ledger:docs/queue-2026-11-10.md`, the owner's decisions |
| WebCodecs first; dav1d only where WebCodecs refuses or fails at ≤ 10 bits, the overlay naming the route and why | 2026-11-11 13:30 | same, §Decided approaches |
| The pairing's same-source check stays, in the ingest, with XXH3 (`sourceFingerprint`), not SHA-256 | 2026-11-11 13:30 | same |
| The quality mark: green beside *Optimal quality*, *Lossless* distinct; the status line opens by a tap | 2026-11-11 | this file (2026-11-11 afternoon) |
| The page view stays; the phone runs decide between the views | 2026-11-11 | same |
| The integrity and quality check is a proposal (#368), outside the demo and the unified branches, the owner's to decide | 2026-11-11 21:30 | the queue file, the owner's decisions |
| The demo suspended, the product goes on; no merges for two weeks except the owner's named ones | 2026-11-11 21:15 | same; [`coordination.md`](coordination.md) |
| Phone: tethering for development and decode numbers; Wi-Fi for transport realism | 2026-11-09 | this file |

## 4. Open, ranked

1. **The integrity and coding-error check** (PR 368 into `claude/demo-fixes-2`, I1–I3; theory on
   `claude/oq-integrity:docs/lines/proposals.md` §Integrity). Matters: until I1 ships, the green mark claims a check
   nobody ran. Built behind one switch, off by default: the ingest writes `lossy.reconstruction` (XXH3-64 of each
   frame as dav1d decodes it; AV1 §7.2 makes conforming decoders' output identical without film grain) and
   `lossy.codingError`; the client checks it, re-decodes a mismatched group on dav1d, refuses a frame matched on
   neither route. Measured: correct on all 18 series both routes; cost over 504 interleaved fills +3.7 % at 1×,
   +1.9 % at 4× (max +7.8 %), the rule's *adopt*. The review (`claude/oq-integrity-build:docs/reviews/oq-integrity.md`)
   found, unfixed: a refused frame leaves the previous green mark on screen (I3's "not as coded" label not built);
   `decoder.js` mutants M2–M4 survive the gate (M3 would label failed samples ✓); no `demo-check.mjs` check per label
   state; `coding_error_test` misses σ of the reconstruction for σ of the source; the first picture's +7.8 % median
   at 1× recorded but not weighed. Also found: `noiseBandRatio` 1.25–2.35 on every demo series (σ over all samples,
   not in-window): I2's protocol decides what it means. Limits: no hardware AV1 decoder in any cell; a phone row owed.
2. **The product ingest writes the pair** (INGEST-OQ, design only: `claude/ingest-oq:docs/reviews/ingest-oq.md`).
   Proposed: the Rust ingest's phase 2 writes it, `aomenc` as a subprocess so its bytes equal `ingest.py`'s `lossy`,
   held by a parity test; the exact series first and the optimal-quality series never published alone; Q and G passed
   by the PCS's trigger; unsigned D > 10 always cut (the lab tool's uncut default is wrong for the product). Found,
   read not run: signed sources over 10 bits after the offset have no form on the product path; `pairOf`'s
   `/^[\w.-]+$/` refuses PCS-coded ids, whose alphabet has `~`. Tests T1–T5 with the mutants each must kill. Owner
   calls: which ingest (Rust recommended), the signed gap (cut after the offset, which extends a decided approach, or
   exact only), where Q and G come from, whether the PCS may code optimal quality; F1–F3 belong to
   [`metadata.md`](metadata.md).
3. **The two failures the phone found** (both rows on [`client.md`](client.md) §4): a *Lossless* never fetched after a
   fill with 7 % loss (load 6; the exact session shows a handshake only: a failed request is not retried), and a fill
   that lost its decoder with the page likely hidden (load 13). The first breaks this line's promise on a lossy link.
   Rows LOSSLESS-UNDER-LOSS and HIDDEN-PAGE-DECODE (theory, a simulated reproduction, a failing test and its fix, draft
   PRs), then PHONE-FIX-REVIEW.
4. **The first phone run's reading** (PHONE-RUN, `claude/phone-rows:docs/phone-rows/README.md`; blind read
   `claude/phone-rows:docs/reviews/phone-blind-read.md`). One Galaxy S23, one home link, one evening, `dbts_b1-q8-g8`
   only, run commit `962226e8`. Tether 23 passed, 1 missing; Wi-Fi (server wired) 22 passed, 2 failed, both `bbr`;
   every Cubic loss on Wi-Fi congestive. By the six-octet reading `cubic-restart` filled faster on Wi-Fi (9 of 10,
   median ratio 1.084) and worker against page shows no difference; but octet 1 took 99 minutes, so the Second
   amendment's 10-minute rule stops the run after octet 4 and leaves every fill comparison *not decided*, and the run
   commit differs from `157b7109` in 20 files of the fill's path, so no verdict carries to the demo commit. Loads 6
   and 10 were slow in the phone's decode (median 524 and 872 ms a frame against about 135), not on the wire. Owner
   calls: which reading stands; whether the two `bbr` failures withdraw `bbr`. Before the next round, theory first:
   HOSTNET-THEORY, LINK-CALIBRATION, FILL-SPLIT, and the phone session's RUNNER-AUTO; its protocol amendment is written
   by a session that will not run it. Which view is the target waits on it (§3).
5. **Is Q 8 visually lossless at the windows readers use.** Owned by [`codecs.md`](codecs.md) §4 item 1 (the bar
   1.00 or 1.03, the anchor as [Q_lo, Q_hi], MEASURE-1's B and A, #373); readers decide, no agent does. This line
   consumes the answer: the demo's Q 8 and the PCS's Q per series.
6. **Narrow windows show the coding error most.** Today an explicit Lossless request; an automatic exact request when
   the window is narrow (or in a reading mode) is an option to compare. I2's per-frame error converted to display
   levels at the current window (#368's overlay) is its input; the threshold is set by readers, not here.
7. **dav1d fetched only when needed** (P6, [`client.md`](client.md) §4 item 7): a theory and protocol, −0.24 to
   −0.64 MB a page on devices that accept WebCodecs (assumption); R5 (P6 with R0's A/A arm) not started.
8. **Tiles.** AV1 tiles wait until after the demo (decided): R1 (`claude/proposals` §Round 2) found 2×2 tiles not ready
   by its rule (max |Δ| +5 source units on `dbts_a1-q8-g8-cut` against a 1-unit bar). HTJ2K at the screen's
   resolution (#324, [`codecs.md`](codecs.md) §4 item 4): HTJ2K-MEASURE in flight, then HTJ2K-VERDICT.
9. **Names and leftovers on the demo path.** The code calls every frame request `requestExactFrame`, optimal-quality
   ones included, and the optimal-quality state `showLossy` (`View.lossy`, intent `lossy`) where the screen says
   *Optimal quality*: NAMES-1 (`claude/demo-understand:docs/reviews/understand/names.md`). What CLEAN-PRODUCT left of
   CLEAN-FIND, DEFAULTS-FIND and OPT-SIMPLIFY: CLEAN-2. Two `demo-check.mjs` mutants that ask a group ahead survived
   REVIEW-E2E2, cause not traced. Each a draft PR riding `claude/unified-client` last, its own merge.
10. **Stale drafts of this line**: #340 and #350 (docs into `main`); #356 and #360–#365, whose heads the tip carries,
    still open; #359, whose last four commits (`docs/devices.md` §7's second amendment and its note, the protocol the
    phone run used) are not on the tip, so they reach `main` only if #359 is carried. Closes and carries are the
    owner's after the two words (`claude/merge-plan:docs/reviews/merge-plan.md` §4.1).

## 5. Unsupervised

An agent may, without the owner: fix #368's review findings on `claude/oq-integrity-build`, each with a failing test
first, mutated, the PR kept a proposal; run I2's protocol against the quality study's rows; trace the two surviving
`demo-check.mjs` mutants; write the tests T1–T5 of INGEST-OQ as a protocol; run the rows of §4 items 3 and 4 and P6's
protocol; amend the phone protocol for the next round (a session that will not run it); review any of these as a
review row. Every build is one branch and one draft PR with a review row.

Waits for the owner: taking #368 and its open choices (the unchecked label, block or paint, the mask); which ingest
writes the pair, the signed gap and where Q and G come from; the phone run's reading and any controller or view call;
any merge, any close, any removal; any change to §3.

## 6. Pointers

[`../av1/payload-format.md`](../av1/payload-format.md) §Optimal quality, §Depth cut, §Source fingerprint;
`client/README.md` *Optimal quality, exact on request*; `client/viewer/{pair.js,screen.js,demo-check.mjs}`;
`ingest/coded-frames/ingest.py`, `scripts/demo-series.sh`; `server/dev-server.py`; `deploy/README.md` §Run it;
README §Demo; [`../devices.md`](../devices.md) §7 and §8 (§7's second amendment on `claude/phone-protocol`, #359); `docs/reviews/` on the tip (freeze-e2e, e2e-3,
demo-e2e-2, demo-tests-mobile, demo-redteam, demo-blind, experiments-off, view-worker-check);
`claude/oq-integrity-build:docs/reviews/oq-integrity.md` (#368); `claude/ingest-oq:docs/reviews/ingest-oq.md`;
`claude/phone-rows:docs/phone-rows/`, `claude/phone-rows:docs/reviews/phone-blind-read.md`;
`claude/proposals:docs/lines/proposals.md` (§Integrity, P6, §Round 2; #358); `claude/lines-ready:docs/reviews/lines-ready.md`;
`claude/merge-plan:docs/reviews/merge-plan.md`; the queue's status files, `claude/work-ledger:docs/queue/`.
