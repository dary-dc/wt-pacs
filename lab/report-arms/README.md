# report-arms

The rig for the reports' carriers and receivers, as `docs/client/evidence/report-plan.md` §7 (`claude/report-plan` at
`cb1c90d8`) pre-registers it. This directory holds the harness, the control arm `off` and a stand-in arm `stub`; each
survivor's arm (BEACON, KEEPALIVE, SESSION) and the receivers (NGINX, RECEIVER) are added by their own build rows,
each in its own directory. Nothing here is a result: the rows these arms leave are smoke.

## The pieces

* **The records** (`record.js`): one `Load` per page load, built where the values are and serialized there (§7.1):
  the whole record (`seq` 0, or the only one at hidden) and deltas (`seq` 1, 2, … with only the presses, labels and
  errors since the last send, the checks per route as the denominator), and one safety record per failed check. Every
  record carries `v`, `kind` and a `reportId`; the fields are the ones `report-fields.json` lists.
* **The field list** (`report-fields.json`): one file for `load`, `safety` and the server's `link` line, read by the
  records' test, the read tool and the server's test alike, so the *field outside the list* mutant meets one list.
* **The sink** (`sink.mjs`): *one record in, one acknowledgement after the append*. `POST /report/load` and
  `/report/safety`, one JSON object of at most 16 KiB, appended as one line `{t, r}` to `<kind>.jsonl`, then `204`; `400`
  for anything but one object, `413` over 16 KiB, `404` for another kind. `GET /report/counters` gives `received`,
  `appended`, `acknowledged`, `duplicates` (a `reportId` seen before), `byKind` and `refused` by why. It also serves the
  rig's pages cross-origin isolated, so every carrier is same-origin.
* **The read tool** (`read.mjs`): the one join and dedup every receiver is read through (§3.5): the sink's lines,
  NGINX's (`r` a JSON string) and the server's link lines; one entry per load with its records by `seq`, its safety
  reports, second copies dropped and counted (by `reportId`, or by content when a record has none), the fields outside
  the list by name (never their values), and the link line joined by `load`.
* **The timings** (`timing.js`), the same for every HTTP carrier: `H`, the whole record at the first hide, once (PR
  370's build); `Y`, the whole record at the fill's end and a delta at each later hide; `off`, no listener. A hide is
  `visibilitychange` to hidden or `pagehide`, one handler on both; the second event of one hide finds no change, so it
  sends nothing. SESSION's *at once, batched per second* is its own build's.
* **The mutants** (`mutants.js`, and the sink's `--mutant ack-before-write`): §7.4's five. `never-sent` (the carrier
  takes the load record and sends nothing), `safety-sampled` (the rate 0.1 applied to the safety report),
  `field-outside` (a `labOnly` field in every record), `no-reportId`, `ack-before-write` (the sink answers `204` and drops
  the write).
* **The levers**: Chromium by raw CDP (`cdp.mjs`, §7.6: a Playwright page never hid nor entered bfcache): hide
  (`Browser.setWindowBounds` minimized), navigate, close (`Target.closeTarget`, a second tab kept open), back
  (`Page.navigateToHistoryEntry`), freeze (`Page.setWebLifecycleState`), crash (`Page.crash`), and a `SIGKILL` of the
  spawned browser. For engines without a renderer-kill command (`levers.mjs`): a `SIGKILL` of the descendant of the
  spawned browser whose command line matches (Firefox's tab process, WebKit's WebProcess). The link drop: `blackout <ms>`
  to `lab/scripts/link_impair.py`'s `--control-port`.
* **The server's link record** (`lab/server-telemetry/src/link.rs`, §3.4): with `WTPACS_LINK_RECORD_PATH` set, in a
  `telemetry` build only, one line per WebTransport session at its end: quinn's `rtt`, `cwnd`, `congestion_events`,
  `lost_packets`, `lost_bytes`, `sent_packets`, the least RTT of samples every 100 ms (quinn keeps no minimum), the bytes
  sent and the duration, keyed by the `load=` token of the session's URL (1–64 of `[0-9A-Za-z-]`, else no line). The
  line is written when the server sees the connection close: after a killed browser, at the idle timeout (~20 s on
  loopback in the smoke), inside §7.3's 60 s wait.
* **The page** (`index.html`, `page.js`): one load through the product's downloader with the fault bench's decoder
  (`lab/faultbench/decode/`, `fault=sample` at frame 10: the first decode's sample flipped, the second decode rescues
  it), one arm behind the seam, the load report on the arm's timing, the safety report at once from the page on every
  failed or rescued check. `run.mjs` drives it through `window.rig` (`state`, `load`, `safety`, `press()`).
* **The driver** (`run.mjs`): builds the series, starts the server (`$CARGO_TARGET_DIR`'s, refused unless its banner
  says `telemetry=compile-time`) and the sink, then per cell (an ending) `--rounds` rounds over `--units` in Williams
  order (`lab/order.mjs`). A unit is `arm:timing` (`beacon:H`, `session:1`), or `off` and its A/A twin `off'`, which
  loads as `off`. Per row one fresh Chromium, the load, three frame changes and a *Lossless* press (the deltas), the
  row's ending at the fill's end + 6 s (D5 at 50 or 500 ms after the mismatch), the wait with the browser alive, its
  close, and one row of what the read tool finds for that load, with its `round`, `predecessor` and mutants. Each cell
  ends with a line `{cell, rounds, balanced}`, `balanced()` per unit.

## The seam

An arm is `arms/<name>.js`, whose default export takes `{base, load, session, build, …}` and returns:

| call | does |
| --- | --- |
| `load(body)` | send one load record, already a string; called by the timing in the event's own task, nothing awaited before it |
| `safety(body, fromWorker)` | send one safety record at once, whatever the rate; `fromWorker`: the arm's decoder worker sent it already |
| `worker` (optional export) | the arm's decoder worker, given the fault bench's query and §7.1's init constants |

`off` sends no load report and the safety report by `sendBeacon`, as §7.2 has it; `stub` is a plain `fetch` of each,
no candidate (it loses every hide record at navigation: no `keepalive`). A carrier whose send leaves from a worker
(KEEPALIVE's, SESSION's) needs the downloader and decoder workers' init to carry `{base, load, session, build}` (§7.1);
KEEPALIVE's build carries them in its worker's query (below), so the product's init message is unchanged.

## Run

```bash
cargo build --release -p series-server --features telemetry -p pack-series
node lab/report-arms/run.mjs --units "off,beacon:H,beacon:Y,keepalive:H,keepalive:Y,session:1,session:Y,session:H,off'" \
  --endings D1,D2,D3,D4,D5a,D5b,D7,D8,D9 --rounds 18 --wait 60 --out rows.jsonl
node lab/report-arms/run.mjs --units stub:Y --endings D1 --mutant never-sent     # field-outside, no-reportId, safety-sampled
node lab/report-arms/run.mjs --units stub:Y --endings D1 --sink-mutant ack-before-write   # not with --receiver nginx
node lab/report-arms/run.test.mjs                                               # the driver's rules
node lab/report-arms/read.mjs lab/.report-work/sink-*/*.jsonl                  # one line per load
node lab/report-arms/cdp.check.mjs                                              # the Chromium levers, once
cargo build --release -p report-receiver
NGINX_BIN=<nginx ≥ 1.31.5> node lab/report-arms/run.mjs --units beacon:Y --endings D1 --receiver receiver   # or nginx
NGINX_BIN=<nginx ≥ 1.31.5> node lab/report-arms/nginx/nginx.test.mjs
```

`CHROME_PATH` overrides the Playwright Chromium. A row: `arm`, `timing`, `ending`, `mutant`, `load`, `reached` (`filled`,
`mismatch`, or the page's error), `fill` (the whole record with the fill arrived), `seqs`, `safety`, `duplicates`,
`unkeyed`, `outside`, `link`, and the sink's counters so far.

## What is built and what is not

| §7 asks | here |
| --- | --- |
| the sink, its counters, the stream binding | the HTTP binding in `sink.mjs`; the stream binding (one byte after the server's append) in `session_report.rs`, the same counters in `server-counters.json` |
| D1–D5, D7, D9 on Chromium | built; their levers checked by `cdp.check.mjs` |
| D8, the session never opens | built as "no server started", with the failure forced on the page at load (`forced=page`), since no fill means no decode to fail |
| D6, the link drop | the blackout lever only; running the browser, sink and server inside `unshare -rn` behind `link_impair.py --tun` is not wired (this host has no iproute2) |
| Firefox's tab kill, WebKit's WebProcess and browser kill, both engines inside `--tun` | the process-tree kill is built and tested on a made-up tree; **not checked on either engine**: neither is on this host. REPORT-RUN checks them first, as §7.6 says |
| the floor probe beside L and C | each carrier's own, beside its arm: `beacon/floor.js`, `keepalive/floor.js`, `session/floor.js` |
| cells L (latency), C (page thread), Y (bytes at the relay), R (receivers' cost) | not built: the rows above carry D's readings only |
| the dbts_c1 view | the contract's grey-16 frame as a 32-frame HTJ2K series: the demo volumes are not on this host |

## BEACON (`beacon/`, row REPORT-BUILD-BEACON)

§3.1 as its advocate left it, behind the seam as `arms/beacon.js`; it runs both timings, `beacon:H` (BEACON-H, PR
370's build) and `beacon:Y` (BEACON-Y, the hybrid), from `timing.js`.

* **Load record**: one `sendBeacon(<base>/load, string)` inside `load()`, nothing awaited. A `false` on a record with
  `frames` sends it once more with `frames: null, truncated: true` and the same `reportId` (PR 370's resend); a refused
  delta has no frames to drop and is not sent again.
* **Safety report**: one beacon at once to `<base>/safety`. A `false` keeps it whole and first in line, and sends it
  again on a 1 s timer (one timer at a time), at the next hide (`visibilitychange` to hidden or `pagehide`), at the next
  safety report, and before any load record.
* **Floor** (`beacon/floor.js`, §7.2): one `sendBeacon` of the arm's own string under a fresh load id and `reportId`
  of the same lengths, so its bytes equal the arm's and the read tool files it apart; it returns `{load, at, ok,
  callMs}`, the sink's line time minus `at` being the call-to-append time. Cells L and C, which would run it, are not
  built.
* **Not as §3.1 wrote it**: "failures found in one task go in one beacon" would put several records in one body,
  which the sink's *one record in* (§7.1) refuses; each failure is its own beacon here, in order. In this rig each
  mismatch arrives in its own message task, so the two do not differ in the cells as built.

| test | mutants killed |
| --- | --- |
| `beacon/beacon.test.mjs` | 19/19: no resend without frames; the resend keeps frames; not marked truncated; a delta resent; pending not sent before a load record; a refused safety report dropped; no timer; the timer at 5 s; never re-armed; a timer per refusal; no flush at hidden; none at `pagehide`; the hidden check inverted; safety to the load path; safety truncated on resend; the floor keeps the load id; keeps the `reportId`; another path; padded bytes |

## KEEPALIVE (`keepalive/`, row REPORT-BUILD-KEEPALIVE)

§3.2 as its advocate left it, behind the seam as `arms/keepalive.js`, both timings from `timing.js` (KEEPALIVE-H,
KEEPALIVE-Y). Every send is `fetch(url, {method: "POST", keepalive, body})` with `Content-Type: application/json`;
delivered means `204`.

* **Load record**, from the page only: one send inside `load()`, nothing awaited. A send while the page is visible
  (the hybrid's at the fill's end) is retried once after 1 s on a network error or any status but `204`; a send at a
  hide never waits for its answer.
* **The budget**, OpenTelemetry's accounting (§1.4) on the page: the bytes and requests of the page's keepalive sends
  in flight, counted until each settles, safety reports included. A load record that would pass 60 000 bytes or nine
  requests goes without its frames (`truncated: true`, same `reportId`); a record that still does not fit goes as an
  ordinary fetch (`keepalive: false`), which lives only as long as the page. A safety report is never truncated.
* **Safety report, from the worker**: `keepalive/decoder.js` is the fault bench's decoder as it is, with each final
  frame whose check failed (a mismatch rescued or blocked) reported from the worker as it leaves for the page
  (`keepalive/worker.js`): sent at once, retried once after 1 s, the page told on the `204` by a `BroadcastChannel`
  keyed by the load id. The record rides the frame message as `report`; `page.js` passes it to `safety(body, true)`,
  so both copies share one `reportId`.
* **Safety report, from the page**: the worker's copy is held, not sent, until its `204` (or the page's own) settles
  it; at each hide (`visibilitychange` to hidden or `pagehide`) the page sends every held copy not in flight. A
  failure found on the page itself (D8's forced one) is sent at once, retried once after 1 s, and held the same way.
* **The worker's init constants** (§7.1): `page.js` puts `base`, `load`, `session`, `build`, `codec`, `source` and the
  mutant in the query of the arm's decoder worker (`worker` exported by the arm; the fault bench's decoder otherwise),
  so the product's init message is unchanged. The mutants act in the worker as on the page.
* **Floor** (`keepalive/floor.js`, §7.2): one bare keepalive fetch of the arm's own bytes under a fresh load id and
  `reportId` of the same lengths, from the page or a decoder worker; it returns `{load, at, done, callMs}`, `done` the
  answer. Cells L and C, which would run it, are not built, so neither placement is wired.
* **Not as §3.2 wrote it**: a decode that fails outright (`failed`, no frame) is reported by the page only, as for
  every arm; only a failed check leaves from the worker. The 60 000-byte and nine-request bounds are OpenTelemetry's
  as §1.4 quotes them, not read in an engine's source; past them the ordinary fetch is this build's choice.

| test | mutants killed |
| --- | --- |
| `keepalive/keepalive.test.mjs` | 33/33: keepalive never set; no request cap; no byte budget; no truncation past it; the budget never released; a hide load send retried; a load retried forever; retried at 5 s; the page's own safety report never retried; retried forever; a `204` not settling; no flush at hide; none at `pagehide`; a show counted as a hide; the worker's acknowledgement ignored; an acknowledged record held again; the page sending the worker's copy at once; the worker's copy not held; hiding not tracked for the load record; the worker's report to the load path; acknowledged after a failed send; never retried; retried forever; the rescuing route named; no expected digest; record mutants not applied in the worker; carrier mutants not applied; a preview reported; a rescued frame not reported; the floor keeping the load id; keeping the `reportId`; without keepalive; padded bytes |

## SESSION (`session/`, row REPORT-BUILD-SESSION)

§3.3 as its advocate left it, behind the seam as `arms/session.js`, its three timings: `session:1` (SESSION-1, at
once, batched per second), `session:Y` (SESSION-Y, the hybrid) and `session:H` (SESSION-H, at hidden), the last two
from `timing.js`.

* **The path**: page → downloader → one bidirectional stream of the series' WebTransport session per record, the
  record then FIN; the server reads to FIN, appends the line, then writes one byte and FIN. The record is held in the
  downloader until that byte. `session/downloader.js` is the product's downloader run after `session/adopt.js`,
  which wraps the worker's `WebTransport` (every session the downloader dials, re-dials or recycles is adopted; the
  newest that opens carries what is held) and its `Worker` (a decoder's `report` message is a record).
* **Load record**: the page hands it to the downloader in the call, over a `BroadcastChannel` keyed by the load id.
  SESSION-1 (`schedule` in `session/session.js`): the whole record at the fill's end, a delta each second while
  anything changed, and at a hide (`visibilitychange` to hidden or `pagehide`) the delta since the last tick.
* **Safety report**: from the decoder that found it, to its parent the downloader (`session/decoder.js`, the fault
  bench's decoder as it is; the record built by KEEPALIVE's `reporter`), and from there on a stream; the record rides
  the frame message as `report`, so the page sends no second copy. A failure found on the page (D8's forced one) is
  handed to the downloader like a load record.
* **Held across sessions**: a record whose stream ends without the byte waits for the next session that opens; one in
  flight on a recycled session that fails goes again on the current one. Nothing is held past the downloader.
* **The receiver** (`lab/server-telemetry/src/session_report.rs`, a `telemetry` build with
  `WTPACS_SESSION_REPORT_DIR` set): spawned once the control stream is accepted, it takes one report stream at a time
  on its own task; a record is one JSON object of kind `load` or `safety`, at most 16 KiB (else the stream is reset),
  at most 512 a session (this build's cap; the protocol names none). A field `report-fields.json` does not list for
  the record's kind is dropped, warned and counted. The line `{t, r, path}` goes to `server-<kind>.jsonl`, `path`
  the connection's `rtt_us`, `cwnd`, `lost_packets`, `congestion_events` at receipt; the sink's counters (and
  `refused.cap`, `outside`) to `server-counters.json`. `run.mjs` reads both beside the sink's. `Receiver::file`
  decides the stream's answer: the byte only once the line is written, else a reset; with
  `WTPACS_SESSION_REPORT_MUTANT=ack-before-write` it sends the byte and writes nothing (§7.4's mutant, for cell D).
* **Floor** (`session/floor.js`, §7.2): one bare stream of the arm's own bytes and the server's byte, under a fresh
  load id and `reportId` of the same lengths (KEEPALIVE's floor with the stream for the fetch). Cells L and C, which
  would run it, are not built.
* **Not as §3.3 wrote it**: the page reaches the downloader by a `BroadcastChannel`, not a `postMessage` to the
  worker, because `DownloaderClient` keeps its worker to itself; both are one message task. The server does not file
  the series' own name beside a safety report, and no re-check of the stored frame runs (§5: the coded-bytes digest
  does not exist). The 16 KiB bound and the 512 cap are unit-tested; the stream read itself only by the smoke.

| test | mutants killed |
| --- | --- |
| `session/session.test.mjs` | 21/21: load never handed on; the decoder's report handed on again; the page's own safety report dropped; no tick; a tick every 5 s; the tick resends the whole; the hybrid and at hidden tick too; no whole record at the fill's end; no hide delta; acknowledged without the byte; no FIN; written before ready; released when written, not at the byte; held records not resent on a new session; in-flight records written again on a new session; a record in flight written twice; a record failed on a recycled session never rewritten; a closed session kept as current; the decoder's report under another kind; the decoder's hand-off reported as failed; the floor keeping the load id |
| `session_report.rs` tests | 15/15: an array accepted; any kind accepted; too large not counted; fields outside the list kept; counted, not dropped; dropped, not counted; duplicates not counted; no path at receipt; no receipt time; appended counted when the write fails; appended never counted; no counters file; one file for every kind; `byKind` wrong; the counters file not rewritten at the acknowledgement |
| `session_report.rs` `file` tests (REPORT-BUILD-FIX, B4) | 7/7: the byte sent though the append failed; the append never called, the byte still sent; the cap at `>=`; no cap; the 16 KiB bound at `<`; no bound; the mutant lever ignored |

## NGINX and RECEIVER (`nginx/`, `receiver/`, row REPORT-BUILD-RECEIVERS)

§3.5 as its two advocates left it. `run.mjs --receiver nginx` or `--receiver receiver` puts the receiver in front of
the page: the page loads through nginx, which proxies the rig's pages to the sink, so every carrier stays
same-origin; `--receiver sink` (the default) is the harness's own sink. Both file by kind and UTC day,
`<kind>-<YYYY-MM-DD>.jsonl`, and the read tool reads both.

* **NGINX** (`nginx/nginx.mjs`, nginx ≥ 1.31.5, `NGINX_BIN` the binary): `client_body_early_read` for `POST
  /report/load` and `/report/safety` only; 16 KiB in one memory buffer, `413` above it before a byte is read; one
  access line a request, `{"t","s","n","r"}` with `escape=json` and the body as a JSON string, no address; POST only
  (`limit_except`, `403`); load reports limited per client (10/s, burst 20, `429`), safety reports never. Its counters
  (`nginxCounters`) are read from its files: lines with `204` are appended and acknowledged at once (the answer
  precedes the line, §3.5), `403` and `429` lines and the error log's "too large body" are refusals, a line whose `r`
  is not one JSON object is counted `notObject` at read.
* **nginx in front of RECEIVER**: `location /report/` proxied over HTTP/1.1 with request buffering on, and NGINX's
  line written to `report-fallback.log` only when the answer is not 2xx (`if=$loggable`), so RECEIVER down (`502`)
  keeps the body unvalidated.
* **RECEIVER** (`receiver/`, the workspace crate `report-receiver`; tokio, httparse, serde_json, all locked
  already): one request a connection; a body over 16 KiB or not one JSON object refused and counted; a field outside
  `report-fields.json` dropped before the write, counted, warned by name; UID-shaped runs of four or more components
  in `errors[].message` replaced by `<uid>`; every string cut to 512 bytes; one `write` of the line, then `204`; a
  safety report `sync_data`'d first, then raised on stderr (`reportId`, `source`, `frame`, `route`, `engine`); load
  reports past a byte cap a UTC day (`--cap-bytes`, default 1 GiB) answered `204` and dropped, counted `refused.cap`;
  a failed write `500`. `GET /report/counters` gives the sink's counters plus `refused.cap` and `outside`;
  `--mutant ack-before-write` is §7.4's mutant here.
* **Not as §3.5 wrote it**: `try_files /.none =204`, not `return 204`, answers NGINX's report locations: `return`
  answers in the rewrite phase, before `limit_req`'s preaccess phase, so the advocate's rate limit never ran (the
  test's 40 parallel load reports all took `204` until the change). The files are `load-<day>.jsonl` for both
  receivers, not RECEIVER's `reports-<day>.jsonl`: one name for the kind. A UID is a whole run of digits and dots
  between other characters, not a substring of a longer run. The fallback also keeps what RECEIVER answered `400`
  or `404`, since the advocate's map logs every non-2xx. One `Mutex` serializes RECEIVER's records rather than a task
  owning the files: one writer either way. The worker drops root's rights, so the rig's out directory is made
  world-writable for nginx's per-day log path. NGINX's day comes from `$time_iso8601`, local time: the rig runs nginx
  with `TZ=UTC`.
* **Not built**: the hop form on nginx 1.29 (§7.1: not run unless the owner keeps 1.29); the read-time join of
  RECEIVER's files is the read tool's, as for every receiver; cell R's load generator.

| test | mutants killed |
| --- | --- |
| `nginx/nginx.test.mjs` | 18/18: default escaping; the body spliced in; no early read; `return`, not `try_files`; any method; safety rate-limited too; no rate limit; 1 MiB bodies; the fallback logs every answer; no fallback log; the address in the line; one file for both kinds; no day in the file; pages not proxied; too-large not read; rate refusals counted as appended; method refusals counted as appended; `byKind` wrong |
| `receiver/src/lib.rs` tests | 25/25: no size cap; an array accepted; fields outside kept; outside not counted; no UID scrub; three components a UID; no length bound on a UID; leading zeros allowed; any first component; no string cap; nested strings not capped; safety capped too; no cap; the cap's bytes never added; duplicates not counted; one file for every kind; no day in the file; acknowledged when the write fails; the lever missing; a path refusal uncounted; any method; appended never counted; no receipt time; the wrong leap rule; `byKind` wrong |

## Tests and their mutants

Each test was written first and seen to fail, then each mutant below was applied and seen to fail it:

| test | mutants killed |
| --- | --- |
| `record.test.mjs` | 7/7: a delta resends every press; no `reportId`; `seq` never advances; a delta when nothing changed; failures not counted; a UID field in the safety record; the whole record not marking what it sent |
| `sink.test.mjs` | 10/10: no size cap; an array accepted; duplicates not counted; appended not counted; one file for every kind; no receipt time; the ack-before-write lever missing; no root check on statics; not isolated; a path refusal uncounted |
| `read.test.mjs` | 8/8: NGINX's string body not parsed; no dedup; unkeyed copies not found; no join; no field check; the value logged beside the name; unkeyed not counted; a null body read as a record |
| `timing.test.mjs` | 12/12: H sends at every hide; H sends at the fill's end; Y resends the whole at hide; `off` adds listeners; no `pagehide`; a visible change counts as a hide; never-sent sends; safety-sampled sends all; field-outside adds none; no-reportId keeps it; `off` drops the safety report; `off` sends the load report |
| `levers.test.mjs` | 4/4: children only, no grandchildren; every descendant killed; no duration in the blackout; the wrong stat field read as the parent |
| `link.rs` tests | 6/6: no length bound; any character; no query needed; bytes sent from packets; no minimum RTT; no schema version |
| server `a_session_with_a_load_id_leaves_its_link_line` | 2/2: no hook; the load id not read from the session's path |
| `cdp.check.mjs` (Chromium 153, headless) | 3/3: hide leaves the window normal; back reloads the current entry; freeze leaves it active |

Two mutants of `timing.js` survived the first test (a guard against two sends per hide, and a reset at show): each
guarded nothing a delta does not already, so both were removed. The smokes' rows are in the PR body.

Fixtures and limits: a 4-vCPU cloud container without a GPU; headless Chromium 153 only (no Firefox, no WebKitGTK on
this host); the contract's one HTJ2K frame repeated 32 times, not a demo volume; the fault bench's forced mismatch, not
a real decoder fault; loopback with no relay.
