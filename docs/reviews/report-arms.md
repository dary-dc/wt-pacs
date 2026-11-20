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

## Cells review (REPORT-CELLS-REVIEW, 2026-11-20)

REPORT-CELLS-REVIEW of `claude/work-ledger:docs/queue-2026-11-14.md`, at `56d27bb7`: the eight commits
`115a3529`..`56d27bb7` (REPORT-CELLS). Written by a session that built none of the rig, its arms or the cells. The
questions are the standing rule's: does each new test fail without its change, does the change touch nothing else,
and does each cell read what `claude/report-plan:docs/client/evidence/report-plan.md` §7.2–§7.4 pre-registers.

**Fixtures and limits.** One 4-vCPU cloud container with no GPU. Headless Chromium 153 (Playwright's build) for one
clock probe. No nginx, Firefox or `--tun` run here: their evidence is REPORT-CELLS' own smoke rows
(`claude/work-ledger:docs/queue/REPORT-CELLS-smoke.jsonl`, one round each, not counted), read here and not rerun. The
rig's series is still the contract's grey-16 frame ×32, not `dbts_c1`. `scripts/gate.sh` was not run (REPORT-CELLS ran
it in full at `56d27bb7`, and this review changes only this file). Run instead were the five new or changed node
tests, `scripts/comment_budget.sh` and the mutants below.

### Verdict

**Two blockers, both in readings that REPORT-RUN-2 cannot correct afterwards.** By amendment 17, REPORT-CELLS-FIX and
REPORT-CELLS-FIX-REVIEW are appended to the queue, and REPORT-RUN-2 waits on the re-review.

| # | where | blocker | fix |
| --- | --- | --- | --- |
| B1 | `lab/report-arms/receivers.mjs:55–68`, `:71–72`; `nginx/nginx.mjs:17` | Cell R's generator posts from one address, so NGINX's `/report/load` per-address limit (`limit_req zone=report burst=20`, 10 r/s, keyed on `$binary_remote_addr`) refuses most of every load burst over 10 a second. RECEIVER behind nginx has no such limit. REPORT-CELLS' own smoke (*measured*, 2 s bursts): NGINX load at 100/s gave `{"204": 40, "429": 160}`, and at 1 000/s `{"204": 40, "429": 1960}`. RECEIVER wrote all 200 and all 2 000. So `cpuPer1000` sets NGINX refusing against RECEIVER writing. §7.5 rule 4 ("RECEIVER's validation against NGINX's cost") would then compare a limiter with a writer, and NGINX meets R's bar at 100/s by refusing. Separately, `lines()` counts every access-log line, refused or not, as written: the same smoke shows `lines: 200` beside 160 refusals. | Generate from many source addresses, each under the limit. On this host a socket bound to any address in `127.0.0.0/8` reaches a `127.0.0.1` server and is seen as that address (*measured* here with `127.0.0.2`, `127.0.0.77`, `127.1.2.3`). At rate *r*, ⌈*r*/5⌉ addresses each sending under 5 r/s would do. Or keep one address, and report NGINX's load row as limited and judge it nowhere. Either way, `lines` should count appended lines only (status 2xx), as `nginxCounters` already does. A test first for each. |
| B2 | `lab/report-arms/page.js:258–268`, with `beacon/floor.js:10`, `keepalive/floor.js:11` | Cell L's floor sends the arm's **safety** bytes (`floor: "safety"`) through the floors, which post to `${base}/load`. The arm's own safety reports go to `${base}/safety` (`beacon/beacon.js:10`). §7.2: "the raw call alone with the arm's bytes". At RECEIVER, which the delivery cells use, `/report/load` checks a safety record against the *load* field list. It drops and warns about every safety-only field (`frame`, `route`, `check`, `expected`, `actual`, …; `receiver/src/lib.rs:50–51`, `:193–196`), so `counters.outside` rises in rows with no mutant. It also skips the `sync_data` that only safety lines pay (`lib.rs:233–234`). On this host, a 1.5 KB append plus `fdatasync` costs 0.16 ms at p50 and 0.24 ms at p90 (*measured*, 200 writes, Python). That is about a tenth of the 1.1–1.8 ms L p50s in the smoke, and it lands entirely in "the gap". The beacon test pins the floor to `/report/load` ("floor: one beacon to the same path", `beacon.test.mjs:105`), which was right for C's load bytes and is wrong for L's. | The floor posts to its body's own kind (`/load` or `/safety`). A test per floor that a safety body goes to `/safety`. |

### Each new test fails without its change

| test | change reverted, or mutated here | result |
| --- | --- | --- |
| `lab/faultbench/fault.test.mjs` | `fault.js` at `115a3529~1` (no channel) | fails: "stamped as the faulted decode returns", "one fault heard" |
| `run.test.mjs` | `run.mjs` at `115a3529~1`, and at `115a3529` (before `relayNetns`) | fails at import (the new exports are missing) |
| `cells.test.mjs`, `receivers.test.mjs`, `bidi.test.mjs` | new modules. Mutated here instead: p99's rank `floor`; an empty assembly opening a span; the floor's median taken at p99; a third `/proc` field added to CPU; the ticks shifted by 1 ms; `undefined` not read as null | each killed |
| `run.test.mjs` `killAfterFault` | the wait not clamped at 0 | killed |
| `fault.test.mjs` | the stamp on `Date.now()` | killed |

The mutants REPORT-CELLS lists in `lab/report-arms/README.md` §The cells added by REPORT-CELLS were not all repeated
here. Four mutants of this review's survive:

* `latencies`: `t < was.t` dropped, so the first line read is kept, not the earliest. The test feeds the copies in
  time order. The rig concatenates several files per load (`run.mjs:491–494`), so order is not guaranteed. Minor m1.
* `latencies`: `f <= r.at` changed to `f < r.at`. Equivalent: a record is stamped on the page after its fault returns
  from the worker.
* `killAfterFault`: `late: learned > ms` changed to `>=`. A boundary that cannot be distinguished at the rig's
  resolution.
* A first try against `receivers.js`, a file that does not exist, is void and not counted.

### Each cell against §7

* **D5** (`run.mjs:473–478`, `:489`): the kill is timed from the decoder's fault, as the verdict review asked. Two
  minors:
  * m2. `atKill` is read, then `rig.safety` is read in a second `evaluate`, and only then does `ENDINGS.D5a` crash
    the page. The kill therefore falls one more CDP round trip after the recorded `atKill`, and a report handed on in
    that window is missed by `safetyHanded`. The smoke's `atKill` was 51.8–53.5 ms; the kill was later by an unmeasured
    round trip. The fix: read both in one `evaluate`, then crash.
  * m3. `fault.js` stamps the moment the flipped decode *returns*, before the check hashes it. §7.3 says "after the
    mismatch is found". On the grey frame the hash is short and the difference is negligible; on `dbts_c1` it is one
    frame's XXH3. The stamp could be named as the decode's return in §7.8's style, or moved after the check.
  * `late` compares only `learned`, so `atKill > ms` is never flagged (folded into m2).
* **L** (`page.js:286`, `run.mjs:422–426`, `cells.js:70–84`): 20 faults 1 s apart after the fill, and the fill's own
  fault, joined to the latest fault at or before each record's `at`. This matches §7.3. Minors:
  * m4. Each `rig.refault()` re-enters `done()` (`page.js:69–75`): `rig.frames` has passed `n`, so `load.fill` and
    `rig.fillMs` are rewritten at every later fault, and `load.frame` adds frame 10 again. `row.fillMs` is read before
    the faults (`run.mjs:487`), so no L reading moves. The L rows' own load record carries a fill time about 20 s too
    long and a frame list with duplicates. No bar reads it, but nobody should mistake it for one.
  * m5, the clocks. The fault is stamped as `performance.timeOrigin + performance.now()` in the decoder worker, and
    the append as the receiver's wall-clock `Date.now()` in whole milliseconds. In Chromium 153 here, across 10 fresh
    launches with 50 reads each, `Date.now() − (timeOrigin + now())` on the page spanned −1.1 to +0.1 ms, and the
    worker's stamp lay within ±0.9 ms of the page's `Date.now()` (*measured*). L's p50s in the smoke are 0.9–1.8 ms, so
    the bars (250 ms, 1 s) are unaffected. §7.5 rule 2's 10 % lead on L's busy p99, however, cannot be decided below
    about 10 ms. Say so in the run's amendment, or stamp both ends on one clock.
* **The floor** (`page.js:257–269`): B2, above. KEEPALIVE's worker floor and SESSION's floor are named in the README
  as not wired. With KEEPALIVE's safety sent from its worker (§7.2) but its floor sent from the page, its L gap mixes
  two senders. The run's amendment should name that gap as not comparable.
* **C** (`cells.js:94–108`, `page.js:244–250`): `meter` counts assembly to the carrier's return, and each page-side
  safety send once. The first exact paint is named as not offered. Nothing found.
* **Y** (`cells.js:125–128`): m6. `bodies` measures `JSON.stringify` of the record *as the receiver kept it*. That is
  UTF-16 length after RECEIVER has dropped fields outside the list and capped its strings. It is not "their bytes as
  received" (`README.md`, cell Y). For Y's 16 KiB bar, the body as sent is the one that counts. Name it as such, or
  take NGINX's `$content_length` (`n`), which its log already carries. The relay's wire bytes are named as not
  built.
* **R** (`receivers.mjs`): B1. Beyond it, CPU is read in 10 ms ticks (`HZ = 100`). That is coarse for 2 s smoke
  bursts and fine for §7.3's 60 s bursts. The server's row is named as not built.
* **D6** (`run.mjs:337–346`, `:413–414`): the relay is at 10 ms one way in each direction ("--delay-ms is ONE WAY and
  applies to each direction", `link_impair.py:21`), 50 Mbit, 200 packets, drop. The blackout is at fill end + 4 s,
  hide at + 5 s and navigate at + 6 s, as §7.3 has it. m7. Firefox inside `--tun` (`bidi.mjs` `secure`, through
  `dom.securecontext.allowlist`) was not smoked: the smoke's Firefox rows are D1–D5a, D7–D9, L and C, with no D6. The
  README's old line "both engines inside `--tun`" now reads "WebKitGTK inside `--tun`", so this gap is no longer
  named. Name it again.
* **Firefox** (`bidi.mjs`, `bidi.check.mjs`): the levers are as §7.6 checked by hand. Its limits are named: no long
  tasks, no freeze, D7 through the sink is not a bfcache test, and the crash takes every content process. Nit: the
  default `FIREFOX` path (`bidi.mjs:9`) is this kind of container's scratch path. `FIREFOX_PATH` should be required.

**Nothing else changed.** Outside `lab/report-arms/`, the diff touches `lab/faultbench/decode/fault.js` (the stamp and
its channel; other users of the bench only gain an unread `BroadcastChannel`), `lab/faultbench/fault.test.mjs`,
`scripts/gate.sh` (four test lines added) and `docs/lines/client.md`. Nothing under `server/` or `client/`.
`scripts/comment_budget.sh`: ok.

## Cells re-review (REPORT-CELLS-FIX-REVIEW, 2026-11-20)

REPORT-CELLS-FIX-REVIEW of `claude/work-ledger:docs/queue-2026-11-14.md`, at `cc585f7b`: the four commits
`fb3f15e5..cc585f7b` (REPORT-CELLS-FIX: `e3914772` B2, `8ac91c4e` B1, `dd58e156` the minors, `cc585f7b` the line doc).
Written by a session that built none of the cells, wrote neither the cells review nor the fix.

**Fixtures and limits.** One 4-vCPU cloud container with no GPU; Node 22.23.5. No browser, nginx or RECEIVER run
here: there is no nginx ≥ 1.31.5 on this host, so `nginx/nginx.test.mjs` fails to start (the gate skips it by name),
and the fix's NGINX smoke (`claude/work-ledger:docs/queue/REPORT-CELLS-FIX-smoke.jsonl`, one round, not counted) is
read, not rerun. The source-address wiring was checked instead against a plain `node:http` server on `127.0.0.1`.
`scripts/gate.sh` was not run in full (REPORT-CELLS-FIX ran it at `cc585f7b`; this review changes only this file and
the line doc). Run: the gate's `lab/report-arms/` and `lab/faultbench` node tests, `scripts/comment_budget.sh`,
`scripts/check_links.py`, the reverts and mutants below.

### Verdict

**No blocker open.** B1 and B2 are closed; REPORT-RUN-2 may start when its not-before comes. Four minors (n1–n4),
none of which moves a reading REPORT-RUN-2 cannot check from its own rows.

### Each fix against its blocker

* **B1, closed.** `sources(rate)` gives ⌈*rate*/5⌉ distinct addresses in `127.1.0.0/16`, and `burst` sends the *k*-th
  report from address *k* mod *n*, so each address sends at most 5 a second against NGINX's `rate=10r/s burst=20
  nodelay` keyed on `$binary_remote_addr` (`nginx/nginx.mjs:17`, `:50`). Checked here (*measured*): 2 000 posts through
  `sources(1000)`'s 200 agents reached a `127.0.0.1` server from exactly those 200 peer addresses, 10 each, all `204`.
  The fix's smoke (*measured*, nginx 1.31.5): NGINX wrote 2 000 of 2 000 at 1 000/s, no `429`. `lines()` now counts
  through `appended`: NGINX's lines with a 2xx `s` (`"s":"$status"`, a string, `nginx.mjs:8`) and RECEIVER's lines,
  which carry no `s` (`receiver/src/lib.rs:204`). nginx in front of RECEIVER logs only to `report-fallback.log`, which
  `lines()` does not read, so nothing is counted twice. `appended` agrees with `nginxCounters`' own 2xx rule.
* **B2, closed.** Both floors post to `${base}/${JSON.parse(body).kind}`, parsed before `at` is taken. The page's two
  floor bodies are `Load.record()` (`kind: "load"`, `record.js:38`) and `safetyRecord` (`kind: "safety"`, `record.js:72`),
  so L's floor now reaches `/report/safety` and C's `/report/load`. The KEEPALIVE test's old load body gained its
  `kind`, as it must now.
* **Minors.** m1 tested (below). m4: `done()` returns once `rig.state` is `"filled"` (set only there, `page.js:74`), so a
  refault no longer rewrites `load.fill` or `rig.fillMs`. m3, m6, m7 named in the README as asked. m2, m5, m4's
  duplicate frames and the `FIREFOX_PATH` nit are listed in PR 395's body for REPORT-RUN-2's amendment, as the brief
  allows for what is more than one line.

### Each new test fails without its change

| change reverted, or mutated here | test | result |
| --- | --- | --- |
| both `floor.js` at `fb3f15e5` | `beacon.test.mjs`, `keepalive.test.mjs` | both fail |
| `beacon/floor.js` alone, `keepalive/floor.js` alone | its own test | fails; the other passes |
| `receivers.mjs` at `fb3f15e5` | `receivers.test.mjs` | fails at import (`sources`, `appended` missing) |
| `t < was.t` dropped in `latencies` (m1) | `cells.test.mjs` | killed |
| ⌈*rate*/10⌉ and ⌈*rate*/6⌉ addresses; `128.1.…` | `receivers.test.mjs` | each killed |
| `appended`: every status counted; RECEIVER's lines dropped | `receivers.test.mjs` | each killed |
| the floor's path fixed to `"safety"` (BEACON), to `"load"` (KEEPALIVE) | its own test | each killed |
| `burst` sends every report from `agents[0]` | any | **survives** (n1) |
| `lines()` back to counting every line | any | **survives** (n1) |
| m4's guard dropped | any | **survives** (n2) |

### Minors

* **n1.** The two wirings of B1 are tested only through their helpers: `burst`'s choice of agent and `lines()`'s call
  of `appended` survive every test. Either broken shows in the run's own rows (`statuses` would carry `429`s again), and
  with no refusal the two line counts are equal, so neither can pass a counted row unseen. A test of `burst` against a
  local server that records peer addresses (as this review's check did) would close it.
* **n2.** m4's guard has no test, against the standing rule's "a failing test before each fix"; the brief asked a test
  first of B1 and B2 only. Its smoke ran with and without the guard; no bar reads `load.fill` on L rows.
* **n3.** The generator moved from `fetch` to `node:http` keep-alive agents, one per address: at 1 000/s that is about
  200 client connections into nginx where there were few. Both receivers sit behind the same nginx front, so the
  comparison stays fair, but R's per-1 000 cost now includes that connection count. Name it in REPORT-RUN-2's rows.
* **n4.** The cells' smoke ran nginx 1.31.8, the fix's 1.31.5. Both are ≥ 1.31.5, which `client_body_early_read` needs;
  REPORT-RUN-2 should name the one version it runs.

**Nothing else changed.** The diff touches `lab/report-arms/` (README, both floors and their tests, `cells.test.mjs`,
`page.js`, `receivers.mjs` and its test) and `docs/lines/client.md`. Nothing under `server/`, `client/` or
`scripts/`. The gate's report-arms and faultbench node tests: green (`nginx.test.mjs` not run, no nginx here).
`scripts/comment_budget.sh`: ok. `scripts/check_links.py`: the two pre-existing unresolved paths in
`docs/lines/devices.md` (:57, :60) only.
