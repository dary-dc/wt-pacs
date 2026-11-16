# Review: the reports' rig and arms (`claude/report-arms`, PR 395)

REPORT-BUILD-REVIEW of `claude/work-ledger:docs/queue-client-2026-11-14.md`, 2026-11-16, at `50a7e184` (36 commits over
`claude/docs-client`). Written by a session that wrote none of the rig, the arms or their designs. Measured against
`claude/report-plan:docs/client/evidence/report-plan.md` §3.1–§3.5, §4 and §7. The questions are the standing rule's:
does each test fail without its change, does each arm match its design and touch nothing else, and does each floor
measure the raw call alone.

**Fixtures and limits.** One 4-vCPU cloud container with no GPU and loopback only. Headless Chromium 153 is the only
engine: no Firefox, no WebKitGTK, no `--tun`. The rig's own series is the contract's grey-16 frame ×32, not `dbts_c1`.
Rig runs used `--wait 25–30` with 1–2 loads a row, so they are smoke, not results. nginx 1.31.8 was built from
nginx.org's tarball for the receivers' slice only. No docker; the image's workspace stage was simulated with
`cargo metadata --offline` over the Containerfile's own `COPY` list.

## Verdict

**Five blockers.** Four stop REPORT-RUN from running §7 as written: B1–B3 in the driver and B4 in SESSION's receiver.
B5 breaks the deploy image. By amendment 17, REPORT-BUILD-FIX and REPORT-BUILD-FIX-REVIEW are appended to the queue,
and REPORT-RUN waits on the re-review.

| # | where | blocker | fix |
| --- | --- | --- | --- |
| B1 | `lab/report-arms/run.mjs:107–113` | `finally { b.close() }` SIGKILLs the browser right after each ending, and the wait starts only after that. A beacon or keepalive fetch queued at the hide never leaves. D3 and D5 (renderer killed) also become "renderer and browser killed", and D2's second tab dies with the first. §7.3 asks for the ending, then the wait, with the browser alive. Reproduced: BEACON-H × D1 gave no fill record; with the wait moved before the close (tried in place, then undone), BEACON-H × D1, D2, D7 gave 6/6 delivered. This is the cause of BEACON's and KEEPALIVE's H losses in D1/D2 and of Y's lost hide deltas in their smokes. | Wait inside the `try`, after the ending, then close. D4 is unchanged. |
| B2 | `run.mjs:42` | Runs whatever is at `ROOT/target/release/series-server`, ignores `CARGO_TARGET_DIR` (which `:75` honours for the receiver), and never checks that the binary is a `telemetry` build. `scripts/check_lab_absent.sh:18`, which the gate runs, builds the default server into that same path. After it, every row has no link line and no server counters, silently, and SESSION's receiver is gone. Reproduced: KEEPALIVE-Y × D1, D2 had `link: false` after the absence check and `link: true` on a telemetry build. This fits KEEPALIVE's "the Y run's server left no link line in any row" and SESSION-Y × D2's missing line; for those runs it is likely, not proven. | Honour `CARGO_TARGET_DIR`. Refuse to start unless the server says it is a `telemetry` build, or fail a row that opened a session and left no link line after the wait. |
| B3 | `run.mjs` (the loop, `--timing`) | §7.2: "Williams order per round (`lab/order.mjs`, `williams(9)` …); each row carries its round, arm and predecessor, and `balanced()` is reported per cell … one whole period, 18 rounds". The driver loops endings × arms once. It has no rounds, no order and no predecessor, and takes one `--timing` per run, so BEACON-H and BEACON-Y (or SESSION-1/Y/H) cannot share a run. `off′` cannot be told from `off`. `CLAUDE.md`: "Interleave the variants." | Arms as `arm:timing` units (`beacon:H`, `off'` …), a `--rounds` loop over `lab/order.mjs`, `round` and `predecessor` in every row, `balanced()` in the output. |
| B4 | `lab/server-telemetry/src/session_report.rs:159–169`, tests `:237–259` | The tests claim the line is written "before the stream's byte is sent" and that a failed write means "the stream gets no byte". Both call `Receiver::append` only; the order lives in `run()`, which no test reaches. Two mutants at `:159` survive: the byte sent though the append failed, and the append never called with the byte still sent. The server receiver also has no §7.4 *ack before write* lever (the sink and RECEIVER have one), so cell D cannot run that mutant on SESSION. | Lift take/append/answer out of `run()` into a function that returns answer-or-reset, and test it. Add an env lever for the mutant. |
| B5 | `Cargo.toml:18`, `deploy/Containerfile:12–32` | `lab/report-arms/receiver` joins `members`, but the Containerfile copies each member by name and not this one, so the image's `cargo build --release --locked -p series-server` cannot load the workspace. Simulated: fails at `50a7e184`, passes at `59dfd328~1`. No gate step catches it. | `COPY` its `Cargo.toml` and `src`, as for `lab/server-telemetry`. |

## 1 · Each test fails without its change

All green as shipped: the rig's six node tests, `keepalive.test.mjs`, `session.test.mjs`, `nginx.test.mjs` (nginx
1.31.8), `cargo test -p server-telemetry` (40), `-p report-receiver` (13), and the server's telemetry link test.
`scripts/gate.sh --quick` passed at `50a7e184`. The two existing unresolved paths in `docs/lines/devices.md:57, :60`
were set aside locally for the run, not changed. Skipped by name: the decoders' rebuild and the absence checks
(`--quick`), nginx (not on `PATH` for the gate), numpy for the native painter, lavapipe/Xvfb, the viewer's
cross-codec arm and Firefox, and the web host's check. `check_lab_absent.sh` was run by hand and passed.

The mutants were this review's own. Each was applied alone and the file restored after it.

| slice | run | killed | survived (file:line, change) |
| --- | --- | --- | --- |
| harness (record, sink, read, timing, levers, link) | 32 | 28 | `record.js:29` `!exact` inverted; `read.mjs:43` seqs unsorted (the input is already in order); `link.rs:51` `udp_tx` → `udp_rx` (asserts `> 0` only); `sink.mjs:39` 204 before a synchronous append (equivalent) |
| BEACON | 6 | 6 | — |
| KEEPALIVE | 22 | 20 | `keepalive.js:39` `!busy` dropped (a copy in flight resent at hide); `:44` `pageshow` reset dropped |
| SESSION, page and downloader | 19 | 14 | all three in `adopt.js`, which has no test; `session.js:20` the tick skips `mutate`; `report.js:48` a retry on the same live session (a choice, not pinned) |
| SESSION, server | 10 | 5 | the 16 KiB cap (`:12`); the 512 cap removed, or `>=` (`:150`); both B4 mutants (`:159`) |
| RECEIVER | 16 | 12 | `lib.rs:234` no `sync_data`; `:233` `sync_data` on every kind; `:224` no raise; `:201` no day reset |
| NGINX | 13 | 10 | `client_body_buffer_size 1k` (every real record would go to a temp file and log `"r":""`); `client_body_in_single_buffer` dropped (harmless at buffer = max); `proxy_http_version` dropped |

The builders' own lists (52, 19, 33, 21 + 15, 25, 18 killed) name none of these survivors. Each listed mutant that
was rerun here was killed.

## 2 · Each arm against its design

* **BEACON** matches §3.1 as advocated: one synchronous `sendBeacon` a record; a refused whole record sent once
  without `frames` under the same `reportId`; a refused safety report kept first and resent on 1 s, at a hide, before
  any load record. The README's departure (one beacon a failure, not a task) is true and forced by §7.1.
* **KEEPALIVE** matches §3.2: the worker sends at once and retries once; the page holds the copy until a `204` and
  sends it at each hide; one `reportId`; OpenTelemetry's 60 000 bytes and nine requests. Not built and not listed:
  §3.2's compressed body, and §7.4 pilot (2)'s gzip for KEEPALIVE and SESSION.
* **SESSION** matches §3.3: one bidirectional stream a record, FIN, the server's byte, held until that byte, resent on
  the next session; decoder → downloader → stream; SESSION-1's whole at the fill's end, a delta a second, a hide
  delta. Not listed as departures: the path at receipt lacks `min_rtt` (§3.3: "`rtt`, `min_rtt`, `cwnd`,
  `lost_packets`"), and the body is not compressed.
* **NGINX and RECEIVER** match §3.5, with the README's departures confirmed. One is checked against nginx's docs and
  by mutant: `return` runs in the rewrite phase, before `limit_req`'s preaccess, so `try_files =204` is right. Not
  listed: RECEIVER does not check `v` (§3.5: "parse, check the schema version and the field list"), and
  `open_log_file_cache` is left unset, an undeclared choice that changes NGINX's cost in cell R.
* **The harness** matches §7.1's sink, timings H/Y, the five mutants, §7.6's levers (`cdp.check.mjs` 7/7) and §3.4's
  session-end link line. B1–B3 are the departures that bind. The rest are under Minor.

## 3 · Nothing else touched

Every `server/src/transport/server.rs` line is under `#[cfg(feature = "telemetry")]`. `cargo tree -p series-server`
shows no `server-telemetry` in the default build, and that build and the telemetry check both compile.
`lab/faultbench/decode/frame-buffer.js` and `lab/faultbench/view` are lab-only symlinks. `scripts/gate.sh` only adds
lines. The Cargo changes add a member, not a default member, and B5 is the one breakage. By reading, `page.js`'s seam
leaves BEACON, `off` and `stub` on their old paths; they were not re-smoked after KEEPALIVE's change.

## 4 · Each floor measures the raw call alone

The BEACON, KEEPALIVE and SESSION floors each time only the raw call: `sendBeacon`; one keepalive `fetch`; one stream
with its write, FIN and the server's byte. Each rewrites the ids before the clock starts. None is wired yet (cells L
and C are not built).

* `keepalive/floor.js:11` always posts to `/load`. From the worker, its bytes are a safety record, which RECEIVER
  would file as a load and strip.
* Call-to-append compares the page's `timeOrigin + now()` with the sink's `Date.now()`. §7.3 L asks for "the host's
  monotonic clock".

§7 defines no floor for the receivers.

## Minor (the fix row fixes those that are one line, and lists the rest)

1. `run.mjs:97`: the D1/D7/D8 "other" page is `probe.html` on the sink, and it beacons to `/report/load`, so each
   row's sink counters are not the arm's alone.
2. `mutants.js:4`: `safety-sampled` drops `fromWorker`. Under KEEPALIVE the page then sends the worker's record a
   second time, so the effective rate is about 0.19, not 0.1. The mutant is still caught.
3. `page.js:25, :65`: BEACON's, `off`'s and `stub`'s safety record is built and serialized on the page. §7.1 says
   "serialize where the record is found". Cell C would charge BEACON for what KEEPALIVE does in its worker.
4. §3.4: no link line "at the fill's last frame", and `record.js` never sets the client's `link` (absent, not `null`;
   "null ≠ 0").
5. `run.mjs:99–100`: D5's 50 ms is counted from a 20 ms CDP poll, not from the find. Record both times in the row.
6. `session_report.rs:122`: a stream torn down mid-read counts as `refused.tooLarge`. That is how a SESSION hide
   record lost to navigation would appear in the counters. Count it apart.
7. RECEIVER's `sync_data` and its raise are untested (§3.5: "`204` means written, and for a safety report written to
   the disk"). So are the day cap's reset and the session receiver's 16 KiB and 512 caps. The README says only the
   16 KiB one is untested.
8. No NGINX test body is the size of a real record (about 5–7 KB at Y, and 16 384 B), so the 1 KiB-buffer mutant
   survives.
9. `run.mjs:77`: `--sink-mutant ack-before-write` is silently ignored under `--receiver nginx`, and no row records
   which sink mutant ran.
10. The counters differ across receivers:
    * nginx's 413 in front of RECEIVER reaches no counter;
    * NGINX appends before its object check;
    * NGINX counts a non-POST as received, where the sink and RECEIVER leave it uncounted;
    * NGINX's `refused.path` is always 0.
11. `run.mjs:130`: `--receiver` defaults to `sink`, but §7.2's delivery cells send to RECEIVER. The README's D lines
    use the default.
12. Cell R, when built, would price NGINX's 429s (`limit_req` 10 r/s per address against a 100 and 1 000/s
    generator). RECEIVER's front has no limit. This needs a protocol amendment before R.
13. The untested paths in KEEPALIVE (`keepalive.js:39, :44`) and SESSION (`adopt.js`, `session.js:20`) in the
    table above.
14. Small items:
    * `lab/.report-work` is not ignored;
    * Chromium profiles are left in the temp dir;
    * ports are fixed and random with no bind check (`run.mjs:80`);
    * RECEIVER sends `Content-Length: 0` on a 204 (`main.rs:68`) (RFC 9110 §8.6: a server "MUST NOT");
    * `gate.sh:272` says "six lab crates", and there are now seven.

## What was not run

* Firefox and WebKitGTK (neither is on the host).
* D6 under `--tun` (no iproute2).
* Rows D3–D5, D8 and D9 after B1's trial fix.
* SESSION's Y and H smokes.
* Cell R (no load generator exists).
* The docker image build (simulated only).

## Fixes (REPORT-BUILD-FIX, 2026-11-16)

Made by a session that wrote none of the builds or this review. No arm's design was changed.

| # | commit | test (in the gate) | mutants killed |
| --- | --- | --- | --- |
| B1 | `261f004b` | `run.test.mjs`: the close comes ≥ the wait after the ending; an ending that throws is recorded and the browser still closed | the close before the wait (the old order); no close after a throw |
| B2 | `261f004b` | `run.test.mjs`: a banner without `telemetry=compile-time` is refused; binaries from `$CARGO_TARGET_DIR` | no telemetry check |
| B3 | `261f004b` | `run.test.mjs`: 18 rounds of 9 units, each round every unit once, predecessors the unit before, a whole period balanced, one order repeated not; `off'` its own unit loading as `off` | one order every round; no predecessor; `off'` not loaded as `off`; balance always true; rounds cut |
| B4 | `8f61d5a6` | `session_report.rs`: `Receiver::file` sends the byte only for a written line, resets a failed write or a refusal, the 512 cap, the 16 KiB bound, the *ack before write* lever (`WTPACS_SESSION_REPORT_MUTANT`) | 7/7, the two `:159` survivors among them |
| B5 | `4ca48c26` | `deploy/workspace_test.sh`: the workspace stage copies every member | dropping `COPY common` |

Each test failed on the code before its fix: `run.test.mjs` and the `file` tests could not run (there was no seam),
and `workspace_test.sh` failed on `lab/report-arms/receiver` alone. B2 was checked live as well: after
`check_lab_absent.sh` rebuilt the default server, `run.mjs` refused to start and named the build to make. With the fix,
the image's workspace stage loads in `cargo metadata --no-deps --offline`, simulated over the stage's `COPY` list.
Without the fix it fails on the receiver's manifest.

**Minors fixed**: 2 (`safety-sampled` passes `fromWorker` on; `7f56bc62`, a failing check first); 7 in part (the
session receiver's caps); 9 (`--sink-mutant` refused under `--receiver nginx`; every row names its `sinkMutant`); 14 (`lab/.report-work` ignored; "seven lab
crates"). **Left** for a later row: 1, 3, 4, 5, 6, 8, 10, 11, 12, 13, and in 14 the profiles in the temp dir, the
unchecked ports, and RECEIVER's `Content-Length` on a 204 (its HTTP head has no test to fail first).

**Smoke** (not results): BEACON-H, one load per ending, `--wait 30`, on headless Chromium 153 only. The host was a
4-vCPU cloud container with no GPU, on loopback with no relay. The series was the contract's grey-16 frame ×32, not
`dbts_c1`. D6 was not run. Rows are in `claude/work-ledger:docs/queue/REPORT-BUILD-FIX-smoke.jsonl`.

| ending | D1 | D2 | D3 | D4 | D5a | D5b | D7 | D8 | D9 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| fill record | yes | yes | yes | yes | no | no | yes | no | yes |
| safety | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 |
| link line | yes | yes | yes | yes | yes | yes | yes | no | yes |

D1 and D2 had lost H's record before the fix, and now deliver it. In D5, H sends at a hide that a visible kill never
gives (§7.3 predicts ✗). D8 opens no session. Every row has its link line where a session opened, D5 included.

**Gate**: `scripts/gate.sh --quick` OK in 446 s at `7f56bc62`. wasm-pack 0.15.0 was installed, the WASM client
built, and the OpenJPH and XXH3 vendors fetched. The two pre-existing unresolved paths in `docs/lines/devices.md`
(:57, :60) were set aside locally for the run, not changed. `check_lab_absent.sh` was run by hand and passed. Skipped
by name: the decoders' rebuild and the absence checks (`--quick`), ingest/tools.sh, numpy/pydicom, lavapipe/Xvfb,
nginx (so NGINX's test and the web host's check), Firefox.

## Re-review (REPORT-BUILD-FIX-REVIEW, 2026-11-16)

At `133dc2bb`, by a session that wrote none of the builds, the review or the fixes. **No blocker open**: REPORT-RUN's
needs are met. Each fix was reverted alone, its test run, and the file restored.

| # | reverted | its test |
| --- | --- | --- |
| B1 | the close before the wait in `drive` | `run.test.mjs` fails ("closes after the wait"). Live, BEACON-H × D1, D2, 2 rounds, `--wait 30`: 1/4 fill records with the revert, 4/4 with the fix |
| B2 | the banner check | `run.test.mjs` fails ("a build without telemetry is refused"). Live: a default build at `$CARGO_TARGET_DIR` is refused, by that path |
| B3 | one order every round; no predecessor; `off'` loading as `off'` | `run.test.mjs` fails on each |
| B4 | `file` sending the byte though the append failed; the append never called; the lever removed; the cap at 513 | `cargo test -p server-telemetry` (45) fails on each |
| B5 | the receiver's two `COPY` lines | `deploy/workspace_test.sh` fails on `lab/report-arms/receiver` alone |

Minor 2's fix, reverted, fails `timing.test.mjs`. **Nothing else changed**: outside the rig, the diff from `b525eead`
touches `deploy/`, `scripts/gate.sh` (lines added, one step renamed), `.gitignore` and the docs; nothing under
`server/` or `client/`. The smoke's D1 and D2 BEACON-H rows (`REPORT-BUILD-FIX-smoke.jsonl`) carry the fill record, and
so did this review's own rows (`claude/work-ledger:docs/queue/REPORT-BUILD-FIX-REVIEW-smoke.jsonl`).

Minors, none blocking:

1. `run.test.mjs` does not reach the CLI block: dropping `round` and `predecessor` from the rows, or running one
   round whatever `--rounds` says, passes. Rows shown right here, live. Also untested: `bin()` honouring
   `$CARGO_TARGET_DIR` (B2's first half; right here, live).
2. `run()` ignoring `file`'s answer passes `cargo test`: the glue between them is one `if`, and only a live SESSION
   row shows it.
3. `deploy/workspace_test.sh` checks only the manifest. A stage that copies a member's `Cargo.toml` without its `src`
   passes the test. Cargo then cannot load that workspace: checked with `cargo metadata` on a two-member scratch
   workspace.
4. Each row's `counters` are the sink's running totals since the run started, not that row's. The read tool, or
   REPORT-RUN, has to take differences.

**Fixtures and limits.** One 4-vCPU cloud container with no GPU, loopback, no relay. Headless Chromium 153 only. The
series was the contract's grey-16 frame ×32, not `dbts_c1`. Rows were BEACON-H and `off` × D1, D2, 2 rounds,
`--wait 30`: smoke, not results. Not run: `scripts/gate.sh`. Run instead were the rig's ten node tests,
`cargo test -p server-telemetry -p report-receiver`, `deploy/workspace_test.sh` and `scripts/comment_budget.sh`.
The fix row ran `--quick` at `7f56bc62`, and only docs changed after it.
