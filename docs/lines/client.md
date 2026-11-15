# Client

Last verified 2026-11-15 (the reports' protocol) and 2026-11-14 against `claude/unified-client` `e5b20cba` and `claude/direction`'s line doc of 2026-11-12.
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
  for the client's design, evidence and work state. The off-branch inventory was folded 2026-11-14 (40 new evidence
  files, the corrections in place, what was left in #384's body); the page
  ([`../client/design.html`](../client/design.html)) 2026-11-14, with the link check reading `docs/` pages; reviewed
  2026-11-15 (#384 §Review: 11 findings for the fix row, 2 for the owner; the gate stops at `devices.md`'s two
  links); next the fixes.
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
  WebKit's SHA-1 on every frame both ways; a slot freed once a writer holds its copy, proposed for all four. The protocol, pre-registered 2026-11-15 (§8): the shared proposals that enter (a second tab reads, a slot freed once copied, a miss served from what the writer holds, a bounded wait after eviction), eleven cells with bars and predictions, OPFS-SYNC′ the A/A arm, a floor probe beside every run, six mutants; WebKitGTK installable on the host, not yet run. Next, CACHE-BUILD-HARNESS.
* **Two failures from the phone run**, each owed theory, a simulated reproduction, a failing test and its fix as a
  draft PR, then a review: a failed Lossless not retried after a lossy fill; a hidden page losing its AV1 decoder
  mid-group.
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
  protocol is not written. The link profiles and each arm's regime, theory only, 2026-11-14:
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
without digests; the settings awaiting a default ([`../client/design.md`](../client/design.md) §Open); anything
structural.

## Pointers

`client/README.md` (§Optimal quality, exact on request; §The viewer), `docs/CLIENTS.md`, `docs/WIRE.md`, `docs/decode/`,
[`../adr/exactness-in-production.md`](../adr/exactness-in-production.md), `claude/telemetry-client:docs/adr/telemetry-in-production.md`;
`docs/reviews/view-worker-check.md`, `docs/reviews/freeze-e2e.md`, `docs/reviews/experiments-off.md`;
`claude/phone-rows:docs/phone-rows/README.md`, `claude/phone-rows:docs/reviews/phone-blind-read.md`,
`claude/proposals:docs/lines/proposals.md`, `claude/lines-ready:docs/reviews/lines-ready.md`; the work ledger,
`claude/work-ledger:docs/queue/`.
