# Codecs and lab

Last verified 2026-11-25 (owed runs: the session cost); 2026-11-20 (PR state, branches, and the transport and HTJ2K rows of
`claude/work-ledger:docs/queue-2026-11-14.md` and `queue-client-2026-11-14.md`); the AV1 findings as of their dates.
The optimal-quality view's measured state, the study branches, the harvest of 2026-11-10, the owner's questions and
decisions: [`../av1/README.md`](../av1/README.md) §The optimal-quality view; HTJ2K at screen resolution:
[`../htj2k-tiles.md`](../htj2k-tiles.md) (§The work in short); the transport:
[`../transport/design.md`](../transport/design.md).

## Goal

HTJ2K and AV1, the server, the transport and the disk, investigated and measured to `CLAUDE.md` §Measurement. The PCS
encodes, so a codec finding is a recommendation to the PCS team and an input to the PACS line. Structural theory (what
follows from a format's definition or arithmetic) discards cheaply and names candidates; sizes and times are always
measured, and every result names its fixtures.

## In flight

* **HTJ2K A1**, the attribution run of D+T3's Lossless gain ([`../htj2k-tiles.md`](../htj2k-tiles.md) §Verdict):
  arm D+T1 built and reviewed 2026-11-19 (no blocker; PR 408); HTJ2K-A1-RUN running since 2026-11-20 08:00 on
  `claude/htj2k-a1`; then HTJ2K-A1-REVIEW and the `exact-frame-layout` decision page.
* **The transport comparison** (the subject's design: [`../transport/design.md`](../transport/design.md), #391):
  HTJ2K alone over WebTransport against HTTP/2 `fetch`, WebSocket and HTTP/3 `fetch` on the link profiles; theory,
  protocol and results in `claude/transport-design:docs/transport/evidence/stacks.md` (theory and a prediction per
  profile 2026-11-17; §5 pre-registered the same day: eight arms, fourteen cells through the TUN relay). Built, reviewed, fixed and run
  2026-11-18/19 on `claude/transport-arms` (PR 403; `claude/transport-arms:lab/transport-arms/`,
  `claude/transport-arms:docs/reviews/transport-arms.md`): every
  frame exact; fills tie on clean links; after a 5 s silence the TCP arms are ×1.35–1.70. Verdict-reviewed
  2026-11-19 (`stacks.md` §6.5): §6 reproduced from the rows, CR's H2-fill a miss, ENT unbalanced, AD's fill forms
  struck for a carrier defect, fixed and reviewed the same day. AD re-run 2026-11-19
  (`stacks.md` §6.6): H3-fill and H2-fill answer an ask during a fill faster than WT-TS (0.50–0.68), a miss below
  §5.3's ×1.0–2.0. Next: the `transport-stack` decision page (TRANSPORT-PAGE). One 4-core container, Chromium 157
  headless, the TUN relay ≤ 90 Mbit, `dbts_b1` HTJ2K, no radio.
* **The audits' corrections** ([`../av1/corrections.md`](../av1/corrections.md)): every entry applied in place
  2026-11-20 by row CORRECTIONS-APPLY (`claude/av1-corrections-apply`, PR 416), reviewed 2026-11-22; it merges after
  PR 415, after its re-review.
* **The noise rule at ingest**: its protocol written 2026-11-19 (NOISE-INGEST-PROTOCOL, `claude/noise-ingest`, draft
  PR 413); NOISE-INGEST-MEASURE next, ending in the `ingest-optimal-quality` page.
  *2026-11-21 (row NOISE-INGEST-MEASURE, measured, one cloud core, the three timed volumes):* the port
  (`lab/noise-ingest`) equals the rows' σ on 175 of 175 frames, at 0.002–0.003 CPU s/Mpx, 12–20 % of the exact
  path's CPU a frame. σ over all samples is lower on two of three and would move the rule's Q 8 → 2 and 4 → 2, so
  σ_min waits for phase 2's window. Results and misses: [`../av1/noise-point.md`](../av1/noise-point.md) §Measured.
  *2026-11-24 (row NOISE-INGEST-REVIEW, a session that wrote none of it):* no blocker; P1–P5 recomputed from the raw
  rows, mutants 1–3 fail the golden test, and mutant 4 is equivalent on any frame of more than 36 410 kept samples
  at 12 bits or fewer (*theory*: both `_lerp` forms are then exact). Findings in PR 413's body.
* **An 8-bit depth cut for hardware** ([`../av1/depth-cut-8.md`](../av1/depth-cut-8.md), theory 2026-11-14, measured
  2026-11-15 on all 19 volumes): the cut alone stays under the noise; coded, predicted at 0.82–2.44 times today's
  view's bytes, the 8-bit view meets the noise rule at Q 3–11 at 1.14–1.86 times; 4:2:0 adds +0.01–0.12 %; it buys a
  checked hardware path on desktop Chromium only (4:2:0 grey, `NV12`), whose exactness and speed on a desktop GPU
  are open.
* **The series server's network mode** ([`../transport/network-mode.md`](../transport/network-mode.md), theory
  2026-11-12): host networking for `server` and `exact` (rootless pasta's publish drops at the host what the
  controller reads as congestion, carries no ECN and splits every GSO send); unmeasured, its §6 check owed to a phone
  round, written by a session that will not run it.
* **One place for the coded sets** ([`../reviews/dataset-hub.md`](../reviews/dataset-hub.md), findings 2026-11-11): a
  recipe key and a pin file; release assets on this repository lead.

## PRs

| PR | what | state |
| --- | --- | --- |
| #398 | stage A1: this line's 34 branches into `claude/unified-codecs` (five by `-s ours`, call M1: [`../av1/README.md`](../av1/README.md) §Paths kept in history only); the gate green, the product the baseline but the two lines of a `stallMs` key; blind review in its body, no blocker | draft; in `claude/unified`; `av1-paint-depth` (#309) stays out (call M6) |
| #340, #350 | the two reviewed line-doc PRs of `claude/unified-codecs` | draft |
| #329, #331, #332, #334 | quality audit; encoder settings; noise ratio; decode audit | draft; their branches in `claude/unified` |
| #391 | the transport's design, an inventory | draft |
| #403, #408, #413 | the transport arms; HTJ2K A1; the noise rule at ingest | draft |
| #254, #317, #323, #325, #326 | the server's 13 results (congestion and disk designs, PGO, tail ping, GSO, others; no default changed); noise point; window and Q; VL metrics; groups | closed 2026-11-18, not merged; branches in `claude/unified` |
| #283, #288, #290, #305, #306, #312, #314–#316, #318 | the AV1 result chain into `av1-unified-mainbase` | closed 2026-11-18, not merged; branches in `claude/unified` |

## Owed runs

* **The cost of a reading session** ([`../server/session-cost.md`](../server/session-cost.md), pre-registered
  2026-11-24): server CPU, peak memory and wire bytes a session, arms A, A+C1, B, FIT on CLEAN and CR; its review,
  then SESSION-COST-RUN and -VERDICT (`claude/work-ledger:docs/queue-2026-11-24.md`).
  Reviewed 2026-11-24 (PR 441's body): four blockers, among them §3's ask counts against the product's own code and
  PR 446's reversal on `dbts_b1`. Fixed in place 2026-11-24 (§9): counts from the product's code, two tables (the
  tip's and PR 446's), FIT's *W* both ways, claims against the frame retrieve only. Re-reviewed 2026-11-24 (PR 441's §Re-review): no
  blocker open, the counts reproduced at both commits; r-m1 (CR's CPU multiplier per form) for the run. Run 2026-11-24
  (SESSION-COST-RUN, §9's amendment and §Results; rows on `claude/session-cost-rig`): 147 sessions; the view's
  asks on `dbts_b1` and `dbts_c1` a third to two thirds of T1's, so B is the dearest arm everywhere; lowest bytes A
  on `dbts_a1` and `dbts_c1`, FIT on `dbts_b1`; exact-frame CPU and every peak RSS above their bands. Verdict review 2026-11-25 (§Verdict review): the table and every lowest arm reproduced; B1, the CPU claim against the frame retrieve is CLEAN's only; m1, the bytes are delivered, not sent (CLEAN's FIFO overflowed). Verdict fix 2026-11-25 (§Verdict fix): CPU claim scoped to CLEAN, delivered bytes with the overflow as an upper bound per cell, CR's CPU read per form; no lowest arm moves. Verdict re-review 2026-11-25 (§Verdict re-review): B1 closed; R-B1, CR `dbts_a1` A's CPU written held on the reading that misses it; r-m1, the view's rate tops at 7.1 ms a MB, not 7.0; Verdict fix 2 2026-11-25 (§Verdict fix 2): R-B1 and r-m1 fixed; r-n3 found §5's HTTP/2 rate is a payload MB and its rows' median 100 ms, not 90, so CR `dbts_a1` A against the frame retrieve is not shown (not "not met"); every CLEAN verdict stands. Verdict re-review 2 2026-11-25 (§Verdict re-review 2): no blocker open; §5's 90 ms is H2-fill's median, H2-frame's 100, so "not shown" stands; r2-m1 (the moved verdict's marker and the pre-registered reading beside it) and two nits left for PAGES-AFTER-RUNS.
* **G at equal quality** (`claude/av1-groups`): shard 2 (`dbts_a1`, `dbts_c1`, TRUS; about 4.3 h on one 4-core host)
  and the collect without `--partial`; the settings shard S2 (A, C cut); a structure-only source with no coding error
  of its own; a finer ladder at Q 8–12. Decode time in order matters more than jumps. No G is decided for DBT.
* **The decode audit's three checks** (`claude/av1-audit-decode`): D1 at 4× with a core cap; one block with `back()`
  off the clock; the product's HTJ2K path beside each study's unit on one Chromium. Until then the view's decode is
  quoted at Q 8 only, with its stream, host and throttle.
* **The noise-ratio protocol** (κ measured, a model observer on calcifications), before any reader study.
* **Noise detection at ingest** (σ_min, its estimator's timing on the three volumes), then handed to the PCS team.
* **To a GPU machine or a phone**: hardware decoders' exactness, reduced-depth paint timing, group arms, the view's
  decode speed on a real slow device; HTJ2K's phone runs P1–P3 after A1; the network mode's §6 check.
* **The coded sets**: the same bundle digests on two hosts.

## Waits for the owner

The harvest's ten questions ([`../av1/README.md`](../av1/README.md) §The owner's questions of the harvest): one bar of
1.03; Q 8 hard-coded for the demo; quoting bytes at the rule's Q; a temporally denoised view; groups shard 2; the
zero-encode re-reads first; holding WebCodecs speed claims; the noise-ratio protocol first; "also for diagnosis"; the
study branches' corrections. Also: the anchor quoted as [Q_lo, Q_hi] with ν beside, and "keep at least half" (Q_ν) as
an option; a note to the PCS team on G for AV1 cine, and keeping or removing the client's G > 1 path; the held server
defaults in `line-server`'s index (#254); whether an 8-bit view is acceptable; a GET path in the product (`stacks.md` §5.5); who
uploads the coded sets; any merge, close or removal.

*Corrected 2026-11-22:* this list also held "the idea of 2026-11-09, undecided (optimal quality split into top and
low bits, the low on request)", whose target was "the optimal-quality image, not lossless"; the owner discarded it
on 2026-11-09 ([`../av1/README.md`](../av1/README.md) §The owner's decisions), so nothing waits on it.

*Dropped as superseded 2026-11-20* (recoverable from this file's history at `4a2b4277f`): Open 2, harvesting the AV1
chain into `av1-unified-mainbase` (its PRs closed 2026-11-18, their branches in `claude/unified`); Open 11's
"Next: stage B" (stage B ran 2026-11-15; its pointer to §Paths kept in history only is in the #398 row);
§The unified branch's "every other PR of the line's chain waits for a review row" (those PRs closed 2026-11-18).

## Pointers

`docs/av1/` (`README.md`, `payload-format.md`, `encoder-settings.md`, `audit-protocols.md`, `corrections.md`,
`MAINBASE.md`, `queue.md`), `docs/htj2k-tiles.md`, `docs/decode/README.md`, `docs/FIXTURES.md`, `docs/transport/`,
`docs/adr/disk-access.md`, `lab/`; the study branches, each in `claude/unified`: `claude/av1-unified-mainbase`,
`claude/av1-quality-metrics:lab/av1/metrics/README.md`, `claude/av1-quality-profiles:lab/av1/profiles/README.md`,
`claude/av1-noise-point:docs/av1/noise-point.md`, `claude/av1-window-q:docs/av1/window-q.md`,
`claude/av1-vl-metrics:docs/av1/vl-metrics.md`, `claude/av1-noise-ratio:docs/av1/noise-ratio.md`,
`claude/av1-encoder-settings:docs/av1/encoder-settings.md`, `claude/av1-audit-quality:docs/av1/audit-quality.md`,
`claude/av1-audit-decode:docs/av1/audit-decode.md`, `claude/av1-groups:docs/av1/groups.md`, `claude/av1-svc-preview`,
`claude/line-server`. The unified codecs branch: `claude/unified-codecs`, from `claude/av1-unified-mainbase`.

## Optimal quality

Folded here from `optimal-quality.md` on 2026-11-24 (LINES-FOLD); its history is in git.

Last verified 2026-11-14 against `claude/unified-client` `e5b20cba` and `claude/direction`'s line doc of 2026-11-12.
The product: [`../ARCHITECTURE.md`](../ARCHITECTURE.md) §The product. The client's side of the design:
[`../client/design.md`](../client/design.md); the contract: [`../av1/payload-format.md`](../av1/payload-format.md)
§Optimal quality, §Depth cut, §Source fingerprint; the page: `client/README.md` §Optimal quality, exact on request.

### Optimal quality: goal

Every reader sees a series' optimal-quality AV1 view, and a Lossless request brings that frame whole from its exact
HTJ2K series; no residual, no server or wire change.

### Optimal quality: in flight

* **On `claude/unified-client`**, with the client line: the pairing, the label, WebCodecs first, the depth cut, the
  pair served by the web image's `--profile pair`; 40 of 40 on the demo commit under both views
  ([`../reviews/freeze-e2e.md`](../reviews/freeze-e2e.md)). The product ingest codes it behind a flag, off by default (below).
* **The integrity and coding-error check** (#368, behind one switch, off by default): its review's findings unfixed —
  a refused frame leaves the previous green mark; three `decoder.js` mutants survive the gate; no `demo-check.mjs`
  check per label state; the coding-error test compares the wrong σ; the first picture's +7.8 % at 1× not weighed
  (`claude/oq-integrity-build:docs/reviews/oq-integrity.md`; the evidence:
  [`../client/evidence/optimal-quality-reconstruction-digest.md`](../client/evidence/optimal-quality-reconstruction-digest.md)). Until it ships, the green mark claims a check nobody ran. *2026-11-22:* a fault model reads the
  branch's withheld frame as leaving the previous frame's picture on the canvas, and asks whether a ✓ on a lossy
  picture says anything once every frame is checked
  ([`../client/evidence/integrity-model.md`](../client/evidence/integrity-model.md) §5; theory, not run).
* **The product ingest writes the pair**, a design only (`claude/ingest-oq:docs/reviews/ingest-oq.md`): the Rust
  ingest's second phase with `aomenc` as a subprocess, held by a parity test; found: signed sources over 10 bits
  have no form on the product path, and `pairOf` refuses ids with `~`. Its testable claims are tests since 2026-11-21
  (`claude/ingest-oq-tests`, no fix): T2 and T3 against `ingest.py` in `ingest/coded-frames/pair_contract_test.py`,
  F1 in `client/viewer/pair.test.mjs`, each failing claim a named known gap the gate keeps green until it holds:
  `ingest.py` leaves the cut to its caller and codes signed 12-bit sources (the Rust ingest's `optimal::form` cuts and
  refuses them), it writes no optimal-quality metadata, and `pairOf` admits neither `~` nor `<Study>/<Series>`. Reviewed 2026-11-22 (PR 421's body §INGEST-OQ-TESTS-REVIEW): no blocker; each
  claim fails on today's code and flips to "gap closed" under a scratch fix; a known gap does not check why it fails (m1).
* **The product ingest codes optimal quality: built, experimental** (#390): `ingest/from-parser --optimal-quality [Q]
  [--group G]`, off by default, byte-identical to `ingest.py`'s `lossy` on synthetic sets in the gate and on `dbts_a1`
  Q 8 G 8 cut ([`../av1/payload-format.md`](../av1/payload-format.md) §Optimal quality). Owed: the owner's S1/S2 for
  signed sources over 10 bits (S2 built), G per modality once measured, phase 2's display keys and several instances a
  series, a reconstruction digest if #368 is adopted; the DICOM ingest (`from_dicom.py`) does not code it. Reviewed
  (#390's body): the flag off writes the same bytes as `e5b20cba`'s ingest on six synthetic sets; no blocker.
  Untested: the aomenc pin, aomenc not needed with the flag off, exit 1 on a refusal; the "both refuse" for signed over
  10 bits is `same.py`'s own rule, not `ingest.py`'s.
* **The two failures the phone found** ([`client.md`](client.md#in-flight) §In flight); the first breaks this line's promise on a
  lossy link.
* **Is Q 8 visually lossless at the readers' windows**: owned by the codecs line (above); readers decide, no agent.
  What the AV1 harvest of 2026-11-10 changes in the demo's claims is in [`../av1/README.md`](../av1/README.md) §The harvest of 2026-11-10: Q 8
  is a candidate (the noise rule picks it on two of the six timed cells); at the rule's Q the view is 0.10–0.28 of
  HTJ2K's bytes (*derived*); nothing shows WebCodecs under one HTJ2K frame on a slow device; the depth cut's
  in-window cost is unmeasured; `claude/oq-ingest` owes a refusal or label of Q 0.
* **Narrow windows show the coding error most**: an automatic exact request at a narrow window is an option to
  compare, its threshold set by readers.
* **Tiles**: AV1 tiles wait (2×2 not ready by their rule); HTJ2K at the screen's resolution is the codecs line's (above).
* Two `demo-check.mjs` mutants that ask a group ahead survive, cause not traced.

### Optimal quality: PRs

| PR | what | state |
| --- | --- | --- |
| #368 | the integrity and coding-error check | draft; the owner's |
| #358 | the proposals' rounds (`claude/proposals`) | draft |
| #359 | the phone protocol's second amendment, not on the tip | draft; reaches `main` only if carried |
| #340, #350, #356, #360–#365 | stale drafts; the tip carries #356 and #360–#365 | open; closes are the owner's |

### Optimal quality: owed runs

The next phone round ([`client.md`](client.md) §Owed runs), its link calibrated and its theory first; #368 on a phone;
the coding error converted to display levels at the current window, against the quality study's rows.
The round is pre-registered in [`../phone-rows/next-round.md`](../phone-rows/next-round.md); its review's author
findings fixed in place and re-reviewed 2026-11-15 (its §Re-review: every finding closed, no blocker; three minors).

### Optimal quality: waits for the owner

Taking #368 and its open choices (the unchecked label, block or paint, the mask); which ingest writes the pair, the
signed gap, where Q and G come from, whether the PCS may code optimal quality; the phone run's reading (which stands,
and whether `bbr`'s two failures withdraw it); any merge, close or removal.

### Optimal quality: pointers

`client/viewer/{pair.js,screen.js,demo-check.mjs}`, `ingest/coded-frames/ingest.py`, `scripts/demo-series.sh`,
`server/dev-server.py`, `deploy/README.md` §Run it, README §Demo; [`../devices.md`](../devices.md) §7 and §8;
[`../glossary.md`](../glossary.md); `docs/reviews/` (freeze-e2e, e2e-3, demo-e2e-2, demo-tests-mobile, demo-redteam,
demo-blind); `claude/phone-rows:docs/phone-rows/`; `claude/proposals:docs/lines/proposals.md`;
`claude/merge-plan:docs/reviews/merge-plan.md`. What a presenter should have known before the demo, fixed after it (the
names, the check hooks on the image, `viewer.js`'s lab lines, what PR 250 brings to `main`, the committed WASM,
`framesSha256`): `e5b20cba:docs/lines/optimal-quality.md` §Known before the demo, fixed after it; the names' part is
`client/README.md` §Optimal quality, exact on request.
