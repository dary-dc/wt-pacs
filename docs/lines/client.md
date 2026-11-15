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
* **The cache survey**, theory only, 2026-11-14
  ([`../client/evidence/cache-options.md`](../client/evidence/cache-options.md)): leaning OPFS as built; owed, a
  phone's cold read and check and sustained write of a 17 MB frame (its §5). The plan to choose the store empirically,
  by the method now in `CLAUDE.md` §Measurement: #385.
* **Two failures from the phone run**, each owed theory, a simulated reproduction, a failing test and its fix as a
  draft PR, then a review: a failed Lossless not retried after a lossy fill; a hidden page losing its AV1 decoder
  mid-group.
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
