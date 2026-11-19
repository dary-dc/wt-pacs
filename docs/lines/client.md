# Client

Last verified 2026-11-14 against `claude/unified-client` `e5b20cba` and `claude/direction`'s line doc of 2026-11-12.
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
  for the client's design, evidence and work state; the off-branch inventory folded next, then the page, a review and
  its fixes.
* **The cache survey**, theory only, 2026-11-14
  ([`../client/evidence/cache-options.md`](../client/evidence/cache-options.md)): leaning OPFS as built; owed, a
  phone's cold read and check and sustained write of a 17 MB frame (its §5).
* **The cache plan**, 2026-11-14 ([`../client/evidence/cache-plan.md`](../client/evidence/cache-plan.md)): four
  survivors of a sourced screen (OPFS sync, OPFS async, IndexedDB, Cache Storage), each given its best design and an
  advocate before a pre-registered run; the rows in `claude/work-ledger:docs/queue-client-2026-11-14.md`. Its §7, the four designs, written 2026-11-14 before any build: one store worker each, the decoders posting
  slot numbers; OPFS sync writes from the slot with no copy in script; IndexedDB and Cache Storage keep a Firefox private
  window's data where OPFS is off, and cannot say whether a series fits before writing it. Next, an advocate per design. OPFS sync's advocate (2026-11-14): reads before
  write pieces, `truncate` at open, and a second tab that reads, proposed for all four. OPFS async's advocate, 2026-11-14 (§7.2): a file per group of frames up to 8 MiB (a ~17 ms cost a file on Firefox makes a file a frame miss the fill at 512²), a buffer a write in flight, Chromium's quota refusal before close traced; eight disadvantages left, two shared-rule proposals. IndexedDB's advocate (2026-11-14): the value a
  `Blob` (no Snappy pass, no 17 MB SQLite row), one write transaction in flight with reads first, `estimate()` at open.
  Cache Storage's advocate (2026-11-14): a reused or streamed body, `estimate()` at open, Gecko's Snappy and CRC32C and
  WebKit's SHA-1 on every frame both ways; a slot freed once a writer holds its copy, proposed for all four. The protocol, pre-registered 2026-11-15 (§8): the shared proposals that enter (a second tab reads, a slot freed once copied, a miss served from what the writer holds, a bounded wait after eviction), eleven cells with bars and predictions, OPFS-SYNC′ the A/A arm, a floor probe beside every run, six mutants; WebKitGTK installable on the host, not yet run. Next, CACHE-BUILD-HARNESS. The run, 2026-11-18/19 (§9, *measured*, one 4-vCPU container, feeders not decoders): no arm passes on Chromium 153 or Firefox 159, every arm failing L's PSS bar at 512² on both; OPFS-SYNC and OPFS-ASYNC pass R, W and O where IDB and Cache Storage miss R and O on Firefox; Chromium's OPFS-SYNC second tab ended with 3 frames not exact over 4 rounds, unreported by its re-check; WebKitGTK 2.52.6 not run (no `SharedArrayBuffer`, no OPFS). The verdict review, 2026-11-19 (§10): §9 recomputes cell for cell (one correction: Firefox saturated at S2 and S3 4×); no passer on either engine, by rule 3. IDB's and Cache Storage's read losses are their APIs' (the floor at or over the bar); the PSS failures at 512² sit within the A/A pair's own PSS spread; Chromium IDB's ~1.2 GiB is theory, a `Blob` held per frame; T's three are failed re-reads or mismatches, which the rows cannot separate, not shown to be wrong frames painted. Owed: §10.4's run (PSS by process, IDB `value=buffer` on Chromium, T's record, OPFS-ASYNC one handle a group). The cache stays off.
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
| #298 | the asking patterns | proposed |
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
which view is the target; turning the cache or telemetry on, and telemetry's rate, sink and retention; a series
without digests; the settings awaiting a default ([`../client/design.md`](../client/design.md) §Open); anything
structural.

## Pointers

`client/README.md` (§Optimal quality, exact on request; §The viewer), `docs/CLIENTS.md`, `docs/WIRE.md`, `docs/decode/`,
[`../adr/exactness-in-production.md`](../adr/exactness-in-production.md), `claude/telemetry-client:docs/adr/telemetry-in-production.md`;
`docs/reviews/view-worker-check.md`, `docs/reviews/freeze-e2e.md`, `docs/reviews/experiments-off.md`;
`claude/phone-rows:docs/phone-rows/README.md`, `claude/phone-rows:docs/reviews/phone-blind-read.md`,
`claude/proposals:docs/lines/proposals.md`, `claude/lines-ready:docs/reviews/lines-ready.md`; the work ledger,
`claude/work-ledger:docs/queue/`.
