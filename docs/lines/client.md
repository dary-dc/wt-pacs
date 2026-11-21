# Client

Last verified 2026-11-21 (the delivery build's review), 2026-11-20 (the delivery build), 2026-11-19 (the delivery protocol), 2026-11-18 (the reports' verdict review), 2026-11-15 (the reports' protocol) and 2026-11-14 against `claude/unified-client` `e5b20cba` and
`claude/direction`'s line doc of 2026-11-12; the owner's decisions of 2026-11-14 to 16 folded 2026-11-17 from
`claude/work-ledger:docs/queue-client-2026-11-14.md`.
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
* **Hardware decode, re-read from sources** 2026-11-14 (HW-DECODE-DEEP, `claude/hw-decode`, a draft into
  `claude/docs-client`): no browser hardware path serves the optimal-quality view with its checks; the Galaxy S23's
  SoC brief lists no AV1 decoder (a republished Qualcomm release says it has one); a device probe for the next phone
  round ([`../decode/hardware.md`](../decode/hardware.md) §11–§17). Reviewed 2026-11-14 (HW-DECODE-DEEP-REVIEW, §18):
  15 of 15 sampled sources hold; only desktop Chromium's 8-bit GREY420 returns samples for the check; no spec defines
  the YUV-to-RGB conversion a GPU hash would need; `prefer-software` has no recorded reason, a line owed beside it.
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
* **D0's hardware-decode probe** on `claude/hw-probe` (`lab/devices/`, row HW-PROBE-PAGE): built, headless test
  green in Chromium 153 on software paths only (2026-11-14); draft PR #393, reviewed 2026-11-15 (its body §Review):
  every RGB copy and WebGL2 read there fits studio-range expansion even where the frame says `fullRange: true`, so
  the probe's RGB and paint "exact" counts measure the range, not precision. The phone run stays with `phone-tests`.
* **The owner's decisions of 2026-11-14 to 16** (amendments 16–23 of the client queue): in
  [`../client/design.md`](../client/design.md) §Decided, one row each, and the HTJ2K-only path with a reduced first
  picture and the 220-level checked hardware view in §Open; the rows that carry them, PRs 378, 389, 392, 394–397, 400.
* **The device model**, theory only, 2026-11-20 ([`../decode/mobile/device-model.md`](../decode/mobile/device-model.md)):
  a phone's decode, cache and decoder floors from its fast cores' speed and count, a range per price band, and the
  prediction for the 2026-11-21 round pre-registered (HTJ2K at 14–22 ms effective a `dbts_b1` frame with three
  decoders, half the protocol's carried ratio; arm B wire-bound). Reviewed 2026-11-20 (PR 414 body): two blockers;
  fixed the same day, before the 11-21 12:00 deadline: cell 2 derived (8–10 of 16 below 1, *no difference shown*
  unless the link gives over ~760 Mbit/s), the premium view band 33–48 ms. Re-reviewed 2026-11-20 (PR 414 body §Re-review): no blocker open. Owed: the round's read.
* **The load report** (#370, `claude/telemetry-client`): owed a review by a session that did not write it, then its
  cost and delivery runs. The safety report for exactness failures (the 2026-11-14 decision) is not built.
* **The reports' options** (2026-11-14, theory and a plan,
  [`../client/evidence/report-plan.md`](../client/evidence/report-plan.md)): carriers BEACON, KEEPALIVE, SESSION and
  receivers NGINX, RECEIVER survive the screen; PR 370's build is one candidate. Chromium has no WebTransport
  `getStats()`, so the phone's link comes from the server's QUIC record. Owed: the REPORT-* rows of
  `claude/work-ledger:docs/queue-client-2026-11-14.md`.
  BEACON's advocate (§3.1, 2026-11-14): the hybrid with a delta per hide as its design, the hide-once build its A arm
  (a departure from the owner's 11-11 brief, the owner's to adopt); `pagehide` beside `visibilitychange`.
  KEEPALIVE's advocate (§3.2, 2026-11-14): Chromium keeps a keepalive past the renderer only from the page ("KeepAlive
  is not yet supported in web workers"), Gecko from both; so the safety report goes from the worker at once and from
  the page at hide until confirmed, deduped by a `reportId`.
  SESSION's advocate (§3.3, 2026-11-14): the downloader worker owns the session and spawns the decoders, so the safety
  report never touches the page; a bidi stream per record, acknowledged after the server's append; records sent at
  once and held until acknowledged. Left: nothing outlives the document on any engine (the session is reset at its
  end), and a load whose session never opens reports nothing.
  RECEIVER's advocate (§3.5, 2026-11-14): its own Rust process from crates already locked, not the OpenTelemetry
  Collector (beta webhook receiver, alpha file exporter, no field check); fields checked against one
  `report-fields.json`, UID-shaped runs scrubbed, `204` after the write; the join and dedup at read, for NGINX alike.
  NGINX's advocate (§3.5, 2026-11-14): the plan's log line was not JSON (checked on nginx 1.24), now the body as a JSON
  string beside `$content_length`; the body read early with no hop on nginx ≥ 1.31.5 (`client_body_early_read`), the
  hop on 1.29; a file per kind; the `204` precedes the line, and the error log names the client.
  The protocol (§7, 2026-11-15, pre-registered, nothing run): nine arms (`off`, `off′`, each carrier × its timings),
  cells D (delivery by nine endings), L, C, Y, R, bars and predictions per arm; SESSION predicted to fail D8 (no
  session) and BEACON/KEEPALIVE-H the visible kill. Levers checked on the host: Chromium only by raw CDP (a Playwright
  page never hides or enters bfcache); Firefox 159 and WebKitGTK 2.52.6 hide and bfcache, their renderer kills not
  yet checked. Phone endings written as asks in the phone protocol.
  The run (REPORT-RUN, 2026-11-16 to 11-18, Chromium 153 only, cell D only, loopback, D6 not run; report-plan.md
  §Results): every HTTP arm passes the safety and load bars in every ending that carries them; SESSION fails D8's safety bar (as
  predicted) and SESSION-H the load bar on navigation; every arm delivered the safety report in D5a. Owed:
  REPORT-VERDICT-REVIEW.
  The verdict review (2026-11-18, report-plan.md §Verdict review): rows recomputed, all agree; BEACON-H/Y and
  KEEPALIVE-H/Y pass cell D (provisional: L, C, Y unbuilt), the Y timing leading by 50 points; BEACON-Y against
  KEEPALIVE-Y, rule 3 and the receivers not decided. D5's kill is timed from the page's send, not the mismatch, so
  D5a never tested its race. Owed: D5 retimed, cells L, C, Y, R, D6, Firefox and WebKitGTK.

## PRs

| PR | what | state |
| --- | --- | --- |
| #367, #250 | the demo tip into `claude/core`, then `claude/core` into `main` | open; the owner's word |
| #382 | the unified branch's review record | open |
| #401 | stage A of the merge queue: the client line's 62 branches into `claude/merge-a-client` (2026-11-15), the gate and `demo-check.mjs` green; reviewed 2026-11-15, no blocker (`direction`'s line-doc sections owed to the plan's §6 item 5) | draft |
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
  2026-11-15: its protocol is `claude/phone-protocol:docs/phone-rows/next-round.md`; its one-press runner is built
  and tested headless on `claude/phone-round` (`lab/devices/README.md` §The round, RUNNER-AUTO), no phone yet; it
  waits for PHONE-LEVERS (cell 1's bench, C2, the decoder count) and a dry run.
  Reviewed 2026-11-15 (`docs/reviews/phone-round.md`): three blockers (a throw after the fill and a server that never
  answers each stop the round; §3's stopping rule not built). Fixed 2026-11-16 (RUNNER-AUTO-FIX, PR 400 §Fix): a
  post-fill throw or hang fails its load, a block that cannot start fails its loads and the round goes on, per-cell
  budgets stop only loads not started. Re-reviewed 2026-11-16 (`docs/reviews/phone-round.md` §Re-review): blockers 1
  and 3 closed; 2 open for servers ready by a printed line (`readyS` does not bound `wait_line`, so a silent QUIC
  server still stops the round unrecorded). Third fix round, the owner's yes (2026-11-16): fixed 2026-11-17
  (RUNNER-FIX-2, PR 400 §Fix 2): `readyS` bounds a printed line too; re-reviewed 2026-11-17 (`docs/reviews/phone-round.md`
  §Re-review 2): closed, no blocker open; PHONE-LEVERS next. Built 2026-11-18 (PHONE-LEVERS, PR 400 §Levers;
  `lab/devices/README.md` §The round): `?decoders`, arm C2's `?exactFill`, cell 1's `?bench`, `roundOrder` with cell
  1 and its drift check; tested headless on the synthetic pair, no phone. Reviewed 2026-11-18
  (`docs/reviews/phone-round.md` §Levers): two blockers, both untested claims (a frame not exact fails no tested load;
  the bench's time pinned only by `> 0`). Fixed 2026-11-18 (PHONE-LEVERS-FIX, PR 400 §Levers fix): a wrong-digest
  exact series fails a bench load and a C2 load by name; the bench's frame time and span pinned to its decoders'
  stamps; minors 3 and 7 (C1 presses Lossless in `roundOrder`). Re-reviewed 2026-11-18 (§Levers re-review): both
  blockers closed, each revert or mutant failing its claim; no blocker open, so PHONE-RUN-OWNER's need is met; the dry
  run next.
* **The delivery comparison**: recorded in [`../client/design.md`](../client/design.md) §Open with its theory; the
  cloud protocol pre-registered 2026-11-19 ([`../client/evidence/delivery-comparison.md`](../client/evidence/delivery-comparison.md),
  row DELIVERY-PROTOCOL): it tests the fill model, not the arms' order (arms A, A′, B, C1, C2; five relay forms; the
  three volumes; predictions from the host's own bytes, decode and wire before any row). Built 2026-11-20
  (DELIVERY-BUILD, PR 406; [`../../lab/delivery/README.md`](../../lab/delivery/README.md)): the driver through the TUN
  relay, K1–K3 and the predictor, the judge; tested and mutated, one smoke round a cell, nothing counted; seven
  findings for the run's §11 amendment in the README. Reviewed 2026-11-21 ([`../reviews/delivery.md`](../reviews/delivery.md)): two blockers, LTE's blackout reaching no fill and a cell with under 8 counted rounds printed as a miss; seven minors. Owed: DELIVERY-BUILD-FIX, its re-review, then DELIVERY-RUN. The link profiles and each arm's regime, theory only, 2026-11-14:
  [`../transport/link-profiles.md`](../transport/link-profiles.md) — the view decode-bound above ~83 Mbit/s, HTJ2K
  wire-bound below ~470–660 if its unmeasured phone decode keeps the cloud's ratio; that decode is the first phone cell.
* dav1d fetched only where WebCodecs refuses (a protocol with an A/A arm, not started); a wake before `l` asks (its
  phone row); the WebGL painter on a real GPU (the owner's machine); Firefox and WebKit.
* Each of the view worker's open questions ([`../client/design.md`](../client/design.md) §Open) has its deciding run
  in its evidence file; none is queued.

## Waits for the owner

Any merge, close or removal (the frame clock's: `git revert 24b80bcd`, [`coordination.md`](coordination.md) §Open 7);
which view is the target; the contradictions the fold left open ([`../client/design.md`](../client/design.md) §Open: the
stride ADR against never skipping, the cache file's questions 3 and 4); the coded-bytes digest; turning the cache or telemetry on, and telemetry's rate, sink and retention; a series
without digests; whether one re-ask of a lost ask is enough (#378); cell 3's guard form before the next phone round (#359);
whether an 8-bit view at 1.14–1.86× the bytes is worth a checked hardware path (#389); the settings awaiting a default ([`../client/design.md`](../client/design.md) §Open); anything
structural.

## Pointers

`client/README.md` (§Optimal quality, exact on request; §The viewer), `docs/CLIENTS.md`, `docs/WIRE.md`, `docs/decode/`;
the browser decode reference, [`../decode/browser.md`](../decode/browser.md) and
[`../av1/webcodecs-profiles.md`](../av1/webcodecs-profiles.md) (#339, sources only, checked 2026-11-10);
[`../adr/exactness-in-production.md`](../adr/exactness-in-production.md), `claude/telemetry-client:docs/adr/telemetry-in-production.md`;
`docs/reviews/view-worker-check.md`, `docs/reviews/freeze-e2e.md`, `docs/reviews/experiments-off.md`;
`claude/phone-rows:docs/phone-rows/README.md`, `claude/phone-rows:docs/reviews/phone-blind-read.md`,
`claude/proposals:docs/lines/proposals.md`, `claude/lines-ready:docs/reviews/lines-ready.md`; the work ledger,
`claude/work-ledger:docs/queue/`.
