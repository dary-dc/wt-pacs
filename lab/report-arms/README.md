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
* **The driver** (`run.mjs`): builds the series, starts the server (`telemetry`, the link record on) and the sink,
  then per row one fresh Chromium, the load, three frame changes and a *Lossless* press (the deltas), the row's ending at
  the fill's end + 6 s (D5 at 50 or 500 ms after the mismatch), the wait, and one row of what the read tool finds for
  that load.

## The seam

An arm is `arms/<name>.js`, whose default export takes `{base, load, session, build, …}` and returns:

| call | does |
| --- | --- |
| `load(body)` | send one load record, already a string; called by the timing in the event's own task, nothing awaited before it |
| `safety(body)` | send one safety record at once, whatever the rate |

`off` sends no load report and the safety report by `sendBeacon`, as §7.2 has it; `stub` is a plain `fetch` of each,
no candidate (it loses every hide record at navigation: no `keepalive`). A carrier whose send leaves from a worker
(KEEPALIVE's, SESSION's) needs the downloader and decoder workers' init to carry `{base, load, session, build}` (§7.1);
that change is its build's, behind the same seam.

## Run

```bash
cargo build --release -p series-server --features telemetry -p pack-series
node lab/report-arms/run.mjs --arms off,stub --timing Y --endings D1,D2,D3,D4,D5a,D5b,D7,D8,D9 --wait 60 --out rows.jsonl
node lab/report-arms/run.mjs --arms stub --endings D1 --mutant never-sent        # field-outside, no-reportId, safety-sampled
node lab/report-arms/run.mjs --arms stub --endings D1 --sink-mutant ack-before-write
node lab/report-arms/read.mjs lab/.report-work/sink-*/*.jsonl                  # one line per load
node lab/report-arms/cdp.check.mjs                                              # the Chromium levers, once
```

`CHROME_PATH` overrides the Playwright Chromium. A row: `arm`, `timing`, `ending`, `mutant`, `load`, `reached` (`filled`,
`mismatch`, or the page's error), `fill` (the whole record with the fill arrived), `seqs`, `safety`, `duplicates`,
`unkeyed`, `outside`, `link`, and the sink's counters so far.

## What is built and what is not

| §7 asks | here |
| --- | --- |
| the sink, its counters, the stream binding | the HTTP binding and the counters; the stream binding (one byte after the server's append) is SESSION's build, against the same counters |
| D1–D5, D7, D9 on Chromium | built; their levers checked by `cdp.check.mjs` |
| D8, the session never opens | built as "no server started", with the failure forced on the page at load (`forced=page`), since no fill means no decode to fail |
| D6, the link drop | the blackout lever only; running the browser, sink and server inside `unshare -rn` behind `link_impair.py --tun` is not wired (this host has no iproute2) |
| Firefox's tab kill, WebKit's WebProcess and browser kill, both engines inside `--tun` | the process-tree kill is built and tested on a made-up tree; **not checked on either engine**: neither is on this host. REPORT-RUN checks them first, as §7.6 says |
| the floor probe beside L and C | not built: each carrier's floor is its raw call, so it is each build's, beside its arm |
| cells L (latency), C (page thread), Y (bytes at the relay), R (receivers' cost) | not built: the rows above carry D's readings only |
| the dbts_c1 view | the contract's grey-16 frame as a 32-frame HTJ2K series: the demo volumes are not on this host |

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
