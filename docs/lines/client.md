# Client

Last verified 2026-11-23 (the engines' path fix; the memory a navigation leaves; the view's default memory bound, its second fix and its re-review; stale client code), 2026-11-22 (the README's *Frames*; the asking model, its fix and re-review; series that are not stacks, theory only, its review, fix and re-review), 2026-11-21 (the OpenJPH bump, #425; the engine review, its fix and the re-review), 2026-11-20 (the engine smoke), 2026-11-19 (the engine matrix), 2026-11-18 (the reports' verdict review), 2026-11-15 (the reports' protocol) and 2026-11-14 against `claude/unified-client` `e5b20cba` and
`claude/direction`'s line doc of 2026-11-12; the owner's decisions of 2026-11-14 to 16 folded 2026-11-17 from
`claude/work-ledger:docs/queue-client-2026-11-14.md`.
The product: [`../ARCHITECTURE.md`](../ARCHITECTURE.md) §The product. The design, its rules, decisions and open
questions: [`../client/design.md`](../client/design.md); the findings: [`../client/evidence/`](../client/evidence/).

## Goal

The browser client a 2D viewer will sit on: fast fills and low on-demand latency on a phone over lossy wireless, every
exact frame bit for bit, and only checked claims on screen.

## In flight

* **The view's memory bound** (VIEW-MEMORY-BOUND, 2026-11-23, `claude/view-memory-bound`, a draft into
  `claude/unified`): the view holds 256 MiB of decoded frames a tab by default, in the series' frames, farthest first
  ([`../client/evidence/what-a-view-asks-for.md`](../client/evidence/what-a-view-asks-for.md) *M, the budget*); the
  size per device class is phase 2's; on V8 the bound is on what the store keeps, not on resident memory (not measured).
  Reviewed 2026-11-23 (PR 435 §VIEW-MEMORY-BOUND-REVIEW): one blocker, the want not cut to the window, so a series
  over the budget is fetched whole and, under the worker view, re-asked outside the window on each step. Fixed 2026-11-23 (VIEW-MEMORY-BOUND-FIX): with no cache the want and the
  page view's fill stop at the window, a test per view; `W_min` not built, said; re-reviewed 2026-11-23 (PR 435
  §Re-review): round one closed, one new blocker: the page view's window never follows the reader, so past the first
  window each step waits for its frame (unit probe). Fixed 2026-11-23 (VIEW-MEMORY-BOUND-FIX-2): past the window with
  no cache the page view's store asks each step's misses as the worker view's does, and the fill's progress counts the
  window's frames held; a test each, mutated. Re-reviewed 2026-11-23 (PR 435 §Re-review 2): every
  finding closed or argued, no blocker open; three minors (a progress test with a cache, `viewer.js` untested, a step
  during the page view's fill now ends the fill's run as the worker view's does).
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
* **Which results hold in which engine** (ENGINE-MATRIX, 2026-11-19, sources only:
  [`../decode/engines.md`](../decode/engines.md)): every row measured or cloud-runnable in Chromium, all but the
  reports in Firefox (its WebCodecs route fails by design, dav1d serves), none measured in Safari, where the view's
  WebCodecs route needs AV1 hardware, WebTransport macOS or iOS 26, and shared memory the embedder's choice.
  ENGINE-SMOKE, 2026-11-20 (§Measured, *measured*, one container, Firefox 160.0.1 and 159.0.1): the demo pair holds in
  Firefox through dav1d, both views; the dispatch rig fails 17 of 781 there, its 8-bit G = 8 groups inexact once
  Firefox's `VideoDecoder` takes them (cause not traced); cell 2's command cannot serve a pair (run instead through
  `demo-pair.sh`); every Chromium offers draft-02 alone; `getStats()` from Chromium 160. ENGINE-REVIEW, 2026-11-21
  (findings in PR 410's body): E1–E26 hold verbatim at their pins; the raw rows carry §Measured; the G = 8 failure is
  the WebCodecs route's alone (the rig's dav1d variant of the same clauses passes on 159 and 160); one blocker, the
  matrix's rows 1, 6, 7, 11 and 12 left uncorrected where §Measured contradicts them. ENGINE-REVIEW-FIX, 2026-11-21:
  those cells and the "So" corrected in place, dated, old text quoted; m1–m4 with them (BCD's Firefox `getStats` note
  quoted and shown stale; 160.0.8173.0 named pre-release; WebKit WebTransport runtime-gated on 26, unconditional
  from 27; `createWritable`'s two settings). ENGINE-REVIEW-FIX-REVIEW, 2026-11-21 (PR 410's body §Re-review): B1 closed, every
  corrected cell matches the raw rows, the four sources re-fetched verbatim, nothing else changed; three nits, one
  outside the fix (Chromium's cell-6 file holds two interleaved D1 runs, two loads of one failing to open). ENGINES-PATH-FIX, 2026-11-23: `engines-smoke/c7-webkitgtk-cache-probe.log` lines 2
  and 3 redacted, a container path made relative to the repository, for `scripts/check_personal_paths.sh`. Next, ENGINES-PAGE.
* **`client/README.md` *Frames*, corrected 2026-11-22** (CLIENT-README-CACHE-FIX): no frame leaves memory, writer
  or not; `FrameStore`'s `budget` is in frames and no caller passes one. The 256 MiB window stays a proposal
  ([`../client/evidence/cache-in-opfs.md`](../client/evidence/cache-in-opfs.md)); the cache stays off.
* **Two failures from the phone run**, each owed theory, a simulated reproduction, a failing test and its fix as a
  draft PR, then a review: a failed Lossless not retried after a lossy fill; a hidden page losing its AV1 decoder
  mid-group.
* **The memory a navigation leaves** (MEMORY-LEAK-TRACE, 2026-11-23,
  [`../client/evidence/navigation-memory.md`](../client/evidence/navigation-memory.md); findings, no fix): the page view's
  frames are `SharedArrayBuffer`s held on the page's thread, which V8 does not count toward collection, so after a
  navigation they stay resident: one renderer 1.6 → 4.1 GiB over four `dbts_b1` loads in headless Chromium 153, the
  view worker flat in the cloud; not the back/forward cache. The cause is established for the cloud page view only:
  on the phone the loads after its two worker-view loads grew +1 452 and +1 528 MiB, where the same order in the
  cloud (`dbts_b1-q8-g8`) adds +7 and −43, so the phone's growth there is unexplained (the URL's view not proof of
  what ran, hardware decode; PHONE-READ-CODE-CHECK open). The releases in reach are the view worker (VIEW-PAGE's
  call) or transferred buffers on the page view (a copy each paint, and an unrun experiment's to adopt).
  Reviewed 2026-11-23 (PR 434 §MEMORY-LEAK-TRACE-REVIEW, one blocker); fixed the same day (MEMORY-LEAK-TRACE-FIX); re-reviewed (§Re-review): B1 open only in the
  row's status Result, so round two (MEMORY-LEAK-TRACE-FIX-2): that Result corrected in place, and the cloud rig's URL
  (no `overlay=1`, no `beacon=`) and unrecorded series stated in the evidence. Re-reviewed again the same day (§Re-review 2): no blocker open.
* **D0's hardware-decode probe** on `claude/hw-probe` (`lab/devices/`, row HW-PROBE-PAGE): built, headless test
  green in Chromium 153 on software paths only (2026-11-14); draft PR #393, reviewed 2026-11-15 (its body §Review):
  every RGB copy and WebGL2 read there fits studio-range expansion even where the frame says `fullRange: true`, so
  the probe's RGB and paint "exact" counts measure the range, not precision. The phone run stays with `phone-tests`.
* **The owner's decisions of 2026-11-14 to 16** (amendments 16–23 of the client queue): in
  [`../client/design.md`](../client/design.md) §Decided, one row each, and the HTJ2K-only path with a reduced first
  picture and the 220-level checked hardware view in §Open; the rows that carry them, PRs 378, 389, 392, 394–397, 400.
* **Series that are not stacks**, theory and sources only, 2026-11-22
  ([`../client/evidence/non-cine-series.md`](../client/evidence/non-cine-series.md), row NON-CINE-OPTIONS): large
  single frames (half the pictures of a DBT exam) keep the exact frame alone, with an exact level picture first as
  the one arm worth a cloud run (its §7, predictions written); ultrasound stills are a stack of exact frames, held
  back by three ingest refusals; over 12 bits waits. Read, not run: the painter makes no test against
  `MAX_TEXTURE_SIZE`. The owner's five calls are its §8.
  *Reviewed 2026-11-22 (NON-CINE-REVIEW, PR 431):* arithmetic and repository claims hold; one blocker, the level
  picture of a 70 µm frame put at level 1 with a share measured on other series while `ffdm_d`'s measured level-2
  cells (7.0–7.5 %, decode ×0.08, first picture ×0.09–0.27) went unused; eleven minors. *Fixed 2026-11-22
  (NON-CINE-REVIEW-FIX):* level 1 (a phone's device pixels) labelled carried, level 2 measured beside it, §7 cut to
  level 1 and V; the minors in place. *Re-reviewed 2026-11-22 (NON-CINE-REVIEW-FIX-REVIEW):* B1 and m1–m10
  closed, no blocker open; four new minors (n1–n4 in PR 431's body: level 2 is a phone's left–right hanging, not a
  laptop's; every handheld must decode AV1, in software if not hardware). Next: the `non-cine-series` page.
* **The device model**, theory only, 2026-11-20 ([`../decode/mobile/device-model.md`](../decode/mobile/device-model.md)):
  a phone's decode, cache and decoder floors from its fast cores' speed and count, a range per price band, and the
  prediction for the 2026-11-21 round pre-registered (HTJ2K at 14–22 ms effective a `dbts_b1` frame with three
  decoders, half the protocol's carried ratio; arm B wire-bound). Reviewed 2026-11-20 (PR 414 body): two blockers;
  fixed the same day, before the 11-21 12:00 deadline: cell 2 derived (8–10 of 16 below 1, *no difference shown*
  unless the link gives over ~760 Mbit/s), the premium view band 33–48 ms. Re-reviewed 2026-11-20 (PR 414 body §Re-review): no blocker open. Owed: the round's read.
* **The frame's fault model**, theory only, 2026-11-22
  ([`../client/evidence/integrity-model.md`](../client/evidence/integrity-model.md)): the frame check covers the
  store to the decoder and nothing replaces it; uncovered with a green label are a damaged display parameter in the
  metadata, a held frame damaged after its check, a stale texture and frame *j* painted for *i*; a withheld frame
  leaves the previous frame's picture (read in code); three failures share *Lossless check failed*. Reviewed
  2026-11-22 (PR 429 body): one blocker, eleven minors. Fixed 2026-11-22: a refused frame is asked again by the next
  want after every failure, unbounded, on both refs (read in code; the store's half in a scratch run), a finding
  against amendment 22 (§6, fault-bench cell 12). Re-reviewed 2026-11-22 (PR 429 body §Re-review): every finding closed,
  no blocker, two nits; next the `frame-integrity` decision page; six calls
  for the owner in its §9, twelve fault-bench cells in its §8.
* **What a view asks for, a model**, theory only, 2026-11-22 ([`../client/evidence/ask-model.md`](../client/evidence/ask-model.md),
  `claude/ask-model`): one key, a frame's need time, orders the want, the store's letting go and the transport's
  commitment; with no slice skipped each side is asked nearest-first whatever the reader does; `waitAhead` stays
  off for DBT (k is the frames committed, not 8), `span` and `holdEveryOther` have no state to act on. Reviewed
  2026-11-22 (PR 430 body §ASK-MODEL-REVIEW): two blockers, P1's legs fit the window so its arms cannot differ, and
  the window behind a back-and-forth reader not shown under the file's own model. Fixed 2026-11-22 (ASK-MODEL-FIX):
  §5 redone as a simulation of the model (derived; `claude/work-ledger:docs/queue/ASK-MODEL-FIX/legs.py`): under
  no skip a scroll's window at a turn is the leg just crossed whatever the split, so the behind split is struck;
  the hold lets go behind first while the reader moves and stays centred while the reader dwells; P1 now has legs
  longer than the window, P1b a dwell at each turn. Re-reviewed 2026-11-22 (PR 430 body §Re-review): no blocker
  open; four minors for the page (P2's one-way order is a start-up transient, the cine gate needs μ, the closed
  form's gap, item 3's optimum not simulated). Owed: the `asking` page; a protocol row for its §7 only on the
  owner's yes.
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
* **The demo check's worker-view flake**, 2026-11-20 ([`../reviews/worker-flake.md`](../reviews/worker-flake.md)):
  reproduced 1 in 100 on `dbts_a1-q8-g16-cut`; the check read the on-demand count before the view worker's progress,
  posted at most every 100 ms, had come. The product is right; the check now reads it once it has come (#419, draft).

## PRs

| PR | what | state |
| --- | --- | --- |
| #426 | UNIFIED-SIMPLIFY, 2026-11-22: P9's moves (the depth cut in `decode/`, one clock helper, the store worker as `client/view/store-worker.js`); P11, S6 found landed; S7 and P3's residue wait on their pages | draft into `claude/unified`; review owed (UNIFIED-SIMPLIFY-REVIEW) |
| #367, #250 | the demo tip into `claude/core`, then `claude/core` into `main` | open; the owner's word |
| #382 | the unified branch's review record | open |
| #401 | stage A of the merge queue: the client line's 62 branches into `claude/merge-a-client` (2026-11-15), the gate and `demo-check.mjs` green; reviewed 2026-11-15, no blocker (`direction`'s line-doc sections owed to the plan's §6 item 5) | draft |
| #370 | the client load report | draft; review owed |
| #368 | the integrity and coding-error check on the label ([`optimal-quality.md`](optimal-quality.md)) | draft; the owner's |
| #429 | the frame's fault model, theory ([`../client/evidence/integrity-model.md`](../client/evidence/integrity-model.md)) | draft; reviewed, fixed, re-reviewed: no blocker open |
| #369 | a separate proposal, kept out of the unified branch | draft |
| #298 | the asking patterns ([`../client/evidence/what-a-view-asks-for.md`](../client/evidence/what-a-view-asks-for.md); the ADR is on `claude/core-asking-plan` only) | proposed |
| #285 | the cache's writer arms, run: no arm passes on either engine | open |
| #425 | OpenJPH 0.31.0 → 0.33.0 in the client's decoder (upstream's CVE-2026-111151 fix), rebuilt from its pins, the same samples on 50 codestreams (2026-11-21); the ingest's encoder stays 0.31.0 | draft; the owner's merge |
| #289, #299, #302, #303 | a second fold; a frame decoded twice; a repaint before the frame is held; the one-pass AV1 merge | open, not in `core` |

## Owed runs

* **The next phone round**: its amendment written by a session that will not run it ([`../devices.md`](../devices.md)
  §7), recording the decoder route and per-frame arrivals and varying the decoder count; it decides which view is the
  target and what bounds a fill.
* **The delivery comparison**: recorded in [`../client/design.md`](../client/design.md) §Open with its theory; its
  protocol is not written. The link profiles and each arm's regime, theory only, 2026-11-14:
  [`../transport/link-profiles.md`](../transport/link-profiles.md) — the view decode-bound above ~83 Mbit/s, HTJ2K
  wire-bound below ~470–660 if its unmeasured phone decode keeps the cloud's ratio; that decode is the first phone cell.
* dav1d fetched only where WebCodecs refuses (a protocol with an A/A arm, not started); a wake before `l` asks (its
  phone row); the WebGL painter on a real GPU (the owner's machine); Firefox and WebKit.
* **The two on-demand mutants REVIEW-E2E2 left alive** (DEMO-CHECK-MUTANTS, 2026-11-20, *measured*, `dbts_a1-q8-g8-cut`
  only, one 4-core cloud container, headless Chromium on SwiftShader, loopback, 3 runs a cell): traced and closed.
  `wantFrom` asking `c + 8` on demand is dead code under `--view page` (the page's controller asks only the current
  frame, on a miss): equivalent there, killed under `--view worker` (32 frames, not 24). `show()` asking `want + 8` on
  a miss lands in group 1 at the open and in group 0 at the jump, so the final count stays 24 and the old check
  passes it; the new check (#418) fails it 3 of 3: before each on-demand step, the frames received may not
  exceed the groups the steps have reached. The same check also fails the other two mutants wherever the old one did.
  Not run: the other 19 series, `--link`, Firefox, a GPU, a phone.
* **Stale client code** (STALE-CODE, 2026-11-23, `claude/stale-code`): measured in headless Chromium, a page opened
  again runs a module older than the one served; `dev-server.py --revalidate` for the device round; the product's
  two ways out cost round trips or a structural change, so they wait for the owner
  ([`../client/evidence/stale-client-code.md`](../client/evidence/stale-client-code.md)). Reviewed 2026-11-23 (PR 437
  §STALE-CODE-REVIEW): no blocker, both tables reproduced; the flag reaches no round until `claude/phone-run` carries it.
* Each of the view worker's open questions ([`../client/design.md`](../client/design.md) §Open) has its deciding run
  in its evidence file; none is queued.

## Waits for the owner

Whether the product's modules are revalidated on every open (`no-cache`, one line) or served under a build key, now
that a browser can run older client code than the server serves for a tenth of the build's age (2026-11-23,
[`../client/evidence/stale-client-code.md`](../client/evidence/stale-client-code.md)).
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
