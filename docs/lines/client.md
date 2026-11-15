# Client

Last verified 2026-11-15 against `claude/unified-client` `e5b20cba` and `claude/direction`'s line doc of 2026-11-12.
The product: [`../ARCHITECTURE.md`](../ARCHITECTURE.md) §The product. The design, its rules, decisions and open
questions: [`../client/design.md`](../client/design.md); the findings: [`../client/evidence/`](../client/evidence/).

## Goal

The browser client a 2D viewer will sit on: fast fills and low on-demand latency on a phone over lossy wireless, every
exact frame bit for bit, and only checked claims on screen.

## In flight

* **The unified branch** `claude/unified-client` (the client, optimal-quality and native lines): the demo tip with the
  cleaning and the renames merged; one `info.path` left in `lab/faultbench/index.html` (now `info.route`), a finding in
  #382. Reaches `main` through #367 then #250, on the owner's word ([`coordination.md`](coordination.md)).
* **The documentation round** of 2026-11-14 on `claude/docs-client` (#384, a draft into `claude/unified-client`): one home
  for the client's design, evidence and work state, done for round 1 on 2026-11-15: structure, fold, page
  ([`../client/design.html`](../client/design.html)), review and its fixes (#384 §Review, §Fix). Merging it is the
  owner's word; waiting for the owner, the six contradictions in [`../client/design.md`](../client/design.md) §Open.
  **The next round folds**, in the same structure, one `docs/<subject>/` each: codecs (`docs/av1/`, `docs/lines/codecs.md`
  and its σ, decode-ratio and Q items the fold left), transport (`docs/transport/`, `docs/WIRE.md`, the link-conditions
  line), the server and disk (`docs/adr/disk-access.md`, the read path), metadata; and the other client ADRs
  (`docs/adr/exactness-in-production.md`, `claude/telemetry-client:docs/adr/telemetry-in-production.md`) into
  `docs/client/evidence/`. Also left by this round: `docs/decode/README.md`'s per-engine statements (its lines
  1828–1861, 2016, 2886) found by two writers; the glossary's *display level*, *reconstruction digest*, *transport
  file*; `client/README.md`'s results not yet moved to evidence; the in-file arm labels (M1–M5, S1–S3) kept by the review.
* **Decode on a phone's browser**, theory only, 2026-11-15 (`docs/decode/mobile/`, one file per option, then a
  comparison): AV1 in software ([`../decode/mobile/av1-software.md`](../decode/mobile/av1-software.md)) is the one
  route checked at full precision on every engine today and bounds the phone's fill; its levers (decoder count,
  `optimizeForLatency`, tiles, post-filters, 8 bits, a threaded dav1d-WASM) are unmeasured on a phone, its §8 the cells.
  AV1 in hardware, unchecked ([`../decode/mobile/av1-hardware-unchecked.md`](../decode/mobile/av1-hardware-unchecked.md)):
  zoom, pan, rotate, flip, invert and window/level all work, at 8 bits of input (2.0–7.4 display levels a step at the
  header windows; above the noise rule's bar at today's Q, 1.02–1.09); values become intervals; only at full range;
  whether the S23 has the decoder and takes 2560 × 3328 is unknown; owed, five phone asks and one cloud cell (its §9).
* **The cache survey**, theory only, 2026-11-14
  ([`../client/evidence/cache-options.md`](../client/evidence/cache-options.md)): leaning OPFS as built; owed, a
  phone's cold read and check and sustained write of a 17 MB frame (its §5). The plan to choose the store empirically,
  by the method now in `CLAUDE.md` §Measurement: #385.
* **Two failures from the phone run**, each owed theory, a simulated reproduction, a failing test and its fix as a
  draft PR, then a review: a failed Lossless not retried after a lossy fill; a hidden page losing its AV1 decoder
  mid-group.
* **Decode on a phone's browser**, theory only, 2026-11-15
  ([`../decode/mobile/new-options.md`](../decode/mobile/new-options.md)): three options beyond the listed six, each
  with a row: a hardware frame inverted from its 8-bit picture and checked against its digest (220 levels); a lossy
  HTJ2K view; the view coded from the content's rectangle. Found: `dbts_b1` and `dbts_c1` need AV1 level 5.0, above
  what Android asks of a hardware decoder. Owed: three phone asks and three cloud byte cells (its §7); the second
  picture for more than 8 bits (its §4) is the owner's to open. HTJ2K alone, in software ([`../decode/mobile/htj2k-software.md`](../decode/mobile/htj2k-software.md)):
  exact and checked on every engine today; its phone decode unmeasured (78–127 ms a `dbts_b1` frame predicted), its
  bytes 4.6–14.6× the view's; the shipped OpenJPH 0.31.0 predates upstream's CVE fix of 0.33.0 (the bump is the owner's).
  The GPU option ([`../decode/mobile/gpu-compute-decode.md`](../decode/mobile/gpu-compute-decode.md), 2026-11-15):
  the lab's WebGPU HTJ2K decoder is already exact; checked and full precision on the reversible path only; its cost is
  the exact series' bytes (4.63× the view on `dbts_b1`); owed, four phone cells (its §9) and a WebGPU painter's design.
  Other codecs (HEVC, VP9, H.264; [`../decode/mobile/other-codecs.md`](../decode/mobile/other-codecs.md), 2026-11-15):
  no browser returns their hardware samples above 8 bits either; at 8 bits they are checkable like AV1, and add only
  a likelier decoder and Android's UHD (level 5.1) HEVC-or-VP9 requirement. Owed: three phone asks (its §6), bytes
  unmeasured.
  The inverted hardware frame ([`../decode/mobile/hw-inverted.md`](../decode/mobile/hw-inverted.md), 2026-11-15): no
  engine lets the page switch its upload's conversion off; studio swing on 16…235 is the one form all invert;
  one-to-one is likely, not specified (fp16 merges a pair); the check reads back and hashes half today's bytes.
  Measured on 19 volumes: 1.16–2.49× today's bytes at the bar, but the coded luma overshoots 16…235 on every frame,
  so the form needs headroom; a second picture reaches today's quality at 1.03–1.62×. Owed: four phone asks (its §12).
  The content's rectangle ([`../decode/mobile/content-crop.md`](../decode/mobile/content-crop.md), 2026-11-15, one
  cloud cell, measured): a lossless rectangle under 0.90 of the frame exists on 3 of the 19 DBT volumes (`dbts_b1`
  0.50, `dbts_b3` 0.73, `dbts_b2` 0.83; systems A and C already store the breast's box); bytes unchanged
  (0.997–1.002); decode 0.85 (AV1) and 0.76 (HTJ2K) of whole on `dbts_b1`; no volume changes AV1 level. Owed, one
  phone ratio on `dbts_b1` (its §8).
  A lossy HTJ2K view ([`../decode/mobile/htj2k-lossy.md`](../decode/mobile/htj2k-lossy.md), 2026-11-15, three cloud
  cells, measured): at the noise rule's 1.00 bar 0.85–1.47× the AV1 view's bytes (median 1.05) with 1.13× its
  in-window error; at the view's Q 8 G 8 error 1.28–1.45× (median 1.36), 19 DBT volumes. Its WASM decode is 1.12–1.21×
  the lossless frame's (not faster) and 0.41–0.50× dav1d-WASM's view. Checked only from the shipped WASM build: node
  and Chromium agree, native x86 differs by ±1. Owed, three phone cells (its §10).
  The comparison ([`../decode/mobile/README.md`](../decode/mobile/README.md), 2026-11-15, documents only): one table
  across the nine files; only software and GPU-compute routes keep full precision today, hardware is checked only at
  8 bits by inversion, AV1 software is the only row timed on a phone; leaning: AV1 software stays the route of record
  until cell 1, M20 and M1–M7 report. Owed: asks M4–M22 in `claude/phone-protocol:docs/phone-rows/next-round.md`.
  Reviewed 2026-11-15 (#397 §Review): two blockers, AV1 software is not full precision on 12-bit series (the depth
  cut) and Safari returns 8-bit hardware samples as `NV12` without inversion; Firefox's narrow range holds on desktop
  only. Fixed 2026-11-15 (MOBILE-DECODE-COMPARE-FIX, `84dbdef2`, `54222b48`): both blockers corrected in place, findings
  3–6 in the option files, minors 7–17 in the README. Re-reviewed 2026-11-15 (#397 §Re-review): both blockers
  closed, no blocker open; the asks M4–M22 stand.
* **The load report** (#370, `claude/telemetry-client`): owed a review by a session that did not write it, then its
  cost and delivery runs. The safety report for exactness failures (the 2026-11-14 decision) is not built.

## PRs

| PR | what | state |
| --- | --- | --- |
| #367, #250 | the demo tip into `claude/core`, then `claude/core` into `main` | open; the owner's word |
| #382 | the unified branch's review record | open |
| #370 | the client load report | draft; review owed |
| #368 | the integrity and coding-error check on the label ([`optimal-quality.md`](optimal-quality.md)) | draft; the owner's |
| #369 | a separate proposal, kept out of the unified branch | draft |
| #298 | the asking patterns ([`../client/evidence/what-a-view-asks-for.md`](../client/evidence/what-a-view-asks-for.md); the ADR is on `claude/core-asking-plan` only) | proposed |
| #285 | the cache's writer arms, run: no arm passes on either engine | open |
| #289, #299, #302, #303 | a second fold; a frame decoded twice; a repaint before the frame is held; the one-pass AV1 merge | open, not in `core` |

## Owed runs

* **The next phone round**: its amendment written by a session that will not run it ([`../devices.md`](../devices.md)
  §7), recording the decoder route and per-frame arrivals and varying the decoder count; it decides which view is the
  target and what bounds a fill.
* **The delivery comparison**: recorded in [`../client/design.md`](../client/design.md) §Open with its theory; its
  protocol is not written.
* dav1d fetched only where WebCodecs refuses (a protocol with an A/A arm, not started); a wake before `l` asks (its
  phone row); the WebGL painter on a real GPU (the owner's machine); Firefox and WebKit.
* Each of the view worker's open questions ([`../client/design.md`](../client/design.md) §Open) has its deciding run
  in its evidence file; none is queued.

## Waits for the owner

Any merge, close or removal (the frame clock's: `git revert 24b80bcd`, [`coordination.md`](coordination.md) §Open 7);
which view is the target; the contradictions the fold left open ([`../client/design.md`](../client/design.md) §Open: the
stride ADR against never skipping, the cache file's questions 3 and 4); the coded-bytes digest; turning the cache or telemetry on, and telemetry's rate, sink and retention; a series
without digests; the settings awaiting a default ([`../client/design.md`](../client/design.md) §Open); anything
structural.

## Pointers

`client/README.md` (§Optimal quality, exact on request; §The viewer), `docs/CLIENTS.md`, `docs/WIRE.md`, `docs/decode/`,
[`../adr/exactness-in-production.md`](../adr/exactness-in-production.md), `claude/telemetry-client:docs/adr/telemetry-in-production.md`;
`docs/reviews/view-worker-check.md`, `docs/reviews/freeze-e2e.md`, `docs/reviews/experiments-off.md`;
`claude/phone-rows:docs/phone-rows/README.md`, `claude/phone-rows:docs/reviews/phone-blind-read.md`,
`claude/proposals:docs/lines/proposals.md`, `claude/lines-ready:docs/reviews/lines-ready.md`; the work ledger,
`claude/work-ledger:docs/queue/`.
