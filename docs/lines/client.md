# Client

Last verified 2026-11-16 (the arms' fixes, the arms' review; KEEPALIVE's and SESSION's arms, the receivers), 2026-11-15 (the reports' rig, BEACON's arm) and 2026-11-14 against `claude/unified-client` `e5b20cba` and `claude/direction`'s line doc of 2026-11-12.
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
* **Two failures from the phone run**, each owed theory, a simulated reproduction, a failing test and its fix as a
  draft PR, then a review: a failed Lossless not retried after a lossy fill; a hidden page losing its AV1 decoder
  mid-group.
* **The load report** (#370, `claude/telemetry-client`): owed a review by a session that did not write it, then its
  cost and delivery runs. The safety report for exactness failures (the 2026-11-14 decision) is not built.
* **The reports' rig**, 2026-11-15 (`lab/report-arms/`, `claude/report-arms`, REPORT-BUILD-HARNESS of
  `claude/work-ledger:docs/queue-client-2026-11-14.md`): the harness `claude/report-plan`'s §7 protocol needs, with the
  arms `off` and `stub` only — the records and one field list, the sink (*one record in, one acknowledgement after the
  append*, its counters), the read tool (dedup by `reportId`, the join by load), the timings H and Y, §7.4's mutants,
  Chromium's endings by raw CDP, a process-tree kill for the other engines, the relay's blackout, the server's link
  line per session under `telemetry`, a page on the fault bench whose forced mismatch sends a safety report. Smoke on
  headless Chromium only. Not built: D6 under `--tun` (no iproute2 here), the floor probes, cells L, C, Y, R; Firefox's
  and WebKit's kills unchecked (neither engine here). Next: the build rows BEACON, KEEPALIVE, SESSION, RECEIVERS.
* **BEACON's arm**, 2026-11-15 (`lab/report-arms/beacon/`, REPORT-BUILD-BEACON): §3.1 as advocated, both timings,
  its floor; one beacon per failure, not per task (the sink takes one record). Found in its smoke: `run.mjs` closes
  the browser at once after each ending, before the browser sends a queued beacon, so D1, D2, D7 and D8 charge every
  keepalive carrier with the rig's loss (a 2 s pause before the close delivered H's record in D1 and D2). A harness
  fix, for REPORT-BUILD-REVIEW and before REPORT-RUN.
* **KEEPALIVE's arm**, 2026-11-16 (`lab/report-arms/keepalive/`, REPORT-BUILD-KEEPALIVE): §3.2 as advocated, both
  timings, its floor. The safety report leaves at once from the decoder worker that found it (the fault bench's
  decoder wrapped, the record riding the frame message), the page holding a copy until the worker's `204` and sending
  it at each hide; OpenTelemetry's 60 000-byte, nine-request accounting on the page. Smoke on headless Chromium only:
  the safety report once in every row, no duplicate; H loses D1 and D2's record to the rig's close-at-once, as
  BEACON-H does. The Y run's server left no link line in any row (H's did): the harness's, unexplained, for
  REPORT-BUILD-REVIEW.
* **SESSION's arm**, 2026-11-16 (`lab/report-arms/session/`, REPORT-BUILD-SESSION): §3.3 as advocated, timings 1
  (at once, batched per second), Y and H, its floor. Every record is one bidirectional stream on the series' session,
  held in the downloader until the server's one byte and sent again on the next session; the safety report goes
  decoder → downloader → stream, never through the page. The receiver is the server's, a `telemetry` build only
  (`lab/server-telemetry/src/session_report.rs`), with the sink's counters. Smoke on headless Chromium only: SESSION-1's
  fill record arrived in every row but D8, the safety report in every row but D8 (no session, as §7.3 predicts); H lost
  its one record wherever the hide raced the session's end (D1, D2, D5, D7).
* **The receivers**, 2026-11-16 (`lab/report-arms/nginx/`, `lab/report-arms/receiver/`, REPORT-BUILD-RECEIVERS): §3.5
  as advocated. NGINX on nginx 1.31.8's early read, one access line a record, POST only, load reports rate-limited;
  RECEIVER a workspace crate behind the same nginx (field check, UID scrub, string cap, day cap for load reports,
  safety reports synced and raised), nginx's line kept as its fallback on non-2xx. Found: the advocate's `return 204`
  answers before `limit_req` runs, so its rate limit never applied; `try_files … =204` instead. `run.mjs --receiver`
  puts either in front of the page. Next: REPORT-BUILD-REVIEW, then REPORT-RUN.
* **The arms' review**, 2026-11-16 ([`../reviews/report-arms.md`](../reviews/report-arms.md), REPORT-BUILD-REVIEW): five
  blockers. In the driver: the browser closed before the wait (the H losses of the smokes), a server binary that may not
  be a `telemetry` build (the missing link lines, likely), no rounds or interleaving (§7.2). SESSION's receiver: its
  ack-after-append untested and no *ack before write* lever. The deploy image: the receiver crate not copied. 14 minors.
  Each arm otherwise matches its design; the floors time the raw call alone. Next: REPORT-BUILD-FIX, its re-review,
  then REPORT-RUN.
* **The arms' fixes**, 2026-11-16 (REPORT-BUILD-FIX): B1–B5 closed on `claude/report-arms`, each with its test and
  mutants. The driver waits with the browser alive, then closes it; it takes its binaries from `$CARGO_TARGET_DIR`
  and refuses a server without `telemetry`; it runs `--units arm:timing` (and `off'`) over `--rounds` in Williams
  order, each row with its `round` and `predecessor`, and `balanced()` per cell. SESSION's receiver answers through
  `Receiver::file`, tested, with an *ack before write* lever. The image copies the receiver crate, and
  `deploy/workspace_test.sh` checks it. Smoke, BEACON-H on headless Chromium only: the fill record now arrives in D1,
  D2, D3, D4, D7 and D9. Next: REPORT-BUILD-FIX-REVIEW, then REPORT-RUN.

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
