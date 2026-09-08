# Improvements outside the transport and disk lanes — second pass, 2026-09-08

**Branch:** `claude/project-improvements-lab-pmohec` · **Status:** analysis; every item is a
candidate with its evidence, nothing below is landed as code. The first pass and its landed
commits are in [`improvements-2026-09-06.md`](improvements-2026-09-06.md); the complete session
state is [`session-ledger-2026-09-06.md`](session-ledger-2026-09-06.md) (§7 is this pass).

**Scope rule, unchanged.** Transport policy (stream mode, QUIC knobs, the send path, the session
loop, the shaped rig) is lane L1 (`cursor/l1-loss-run-dbae`); disk access (prefault, `pread`,
the read path, `frame_store.rs`) is `claude/disk-access-adr-validation-saz6m8`. Nothing here
touches a file either lane changes, except where a line says "by reading, lane-owned".

**Method.** The whole tree was read (server, both clients, the recorder, the shared crates, the
lab drivers outside the lanes, the docs), then every defect suspected from reading was
reproduced on this runner before it was written down; performance claims were measured with the
drivers already in `lab/`, interleaved A/B where a comparison is made. Tier is **T2-local**
(one 4-core VM, localhost, no shaping); relative comparisons only.

**What was verified on the tree first** (HEAD `b9f6bbb`): `cargo build/test/clippy --workspace`
(3 L1-owned warnings, 1 in a telemetry-feature test); `cargo fmt --check` (one diff, T3);
TS bundles, `tsc` on product and recorder, the recorder unit tests, the client absence check;
in Chromium 141 both arms pass frame0 + bulk and 64/64 back-to-back refusals — and, for the
first time on this branch, the WASM package was built with `wasm-opt` (`wasm-pack` 0.15 and
`binaryen` installed from npm on this runner; the 2026-09-06 pass could not get them).

| # | Kind | Claim | Proof |
| - | - | - | - |
| D1 | defect, telemetry | the second sequential session in one telemetry server process truncates the row file; the first session's rows and session row are gone from disk and from the report | two harness sessions, one process: rows file 93 968 → 92 240 B, `server_sessions` = `[2]`, `integrity.rows_opened` 2 907 vs 1 441 rows in file |
| D2 | defect, TS client | a single ask whose control write fails leaves its waiter armed for 15 s and orphans a rejected promise (unhandled rejection) | Node stub run: `inFlight: 1` after the failure, re-ask says "already requested", process dies on the unhandled rejection |
| D3 | defect, both clients | duplicate indices in a bulk ask: TS orphans a waiter and asks the server twice; WASM (by reading) arms one waiter, returns an error, and every later bulk ask fails "previous bulk still pending" | Node stub run (TS); `session.rs` `start_frames` (WASM) |
| D4 | defect, dev tooling | `server/dev-server.py` serves `server/dev-cert/key.pem` and `.git/` | `curl` → 200 |
| D5 | log hygiene, product | every normal client close is a WARN; every refused frame is a WARN line | server log from the browser e2e |
| D6/D7 | lab nits | `refusals_e2e.mjs` cannot run without `wt`/`hash` args; `verify_e2e.py` carries a dead Chromium path | driver output; source |
| T1–T7 | tooling | no CI; the gate skips four crates, clippy and fmt; editor `tsconfig` is broken; global `rustflags`; wasm prerequisites undocumented; two TS build recipes | source, command output |
| Docs | drift | a dangling commit reference in `lab/README.md`; a stale review row; a v1 comment | `git cat-file` |
| Tests | gap | the product TypeScript client has no unit tests; the stub-`WebTransport` used for D2/D3 shows they run in plain Node | `lab/bench/ts_session_stub.mjs` |
| P1 | performance, build | release profile `lto = "fat"`, `codegen-units = 1`: binary −26 %; serving-path effect measured below | interleaved A/B, 4 cells × 3 repeats |
| P2 | performance, WASM | package size and `init()` time across release-profile variants, all with `wasm-opt` | sizes; Chromium timing |
| P3 | metrics | the client recorder's own main-thread cost, both arms | Chromium profile, telemetry on vs off |

---

## D1 · Telemetry: the second sequential session truncates the row file

**Where.** `server/src/record/tap.rs` `Drop for Tap` calls `shutdown_sink()` when `ACTIVE_TAPS`
reaches zero; the drain thread then writes the final report and exits. The next sampled session
calls `Tap::for_session` → `ensure_sink(path)` (`sink.rs`), which finds the sender cell empty,
starts a new drain thread, and `RowFile::create` does `File::create` on the same
`telemetry-server.rows` — truncating it. The new final report is built from the truncated file.

**Proof.** One telemetry server (`--stream-mode shared`, `frames_32k`), two `window-harness`
saturate sessions one after the other, same `WTPACS_TELEMETRY_PATH`:

| after | `server_sessions` | `run_end.rows_in_file` | `integrity.rows_opened` | `integrity.sessions` | rows file |
| - | - | - | - | - | - |
| session 1 | `[1]` | 1 468 | 1 467 | 1 | 93 968 B |
| session 2 | `[2]` | 1 441 | **2 907** | **2** | **92 240 B** |

The report after session 2 says two sessions started and 2 907 rows were opened, and carries
1 441 rows and one session row. Session 1 cannot be rebuilt offline either: `--telemetry-report`
reads the same file. Server log: `sink started … report written … sink started … report written`.

**Variant, by reading.** A session that starts while the last one is ending can pass
`ensure_sink` (sender still present), then get `None` from `clone_sender()` after
`shutdown_sink` ran; `flush_batch` returns early when `tx` is `None`, so its rows are neither
written nor counted as drops. Not reproduced (a timing window); same root cause.

**Does it touch existing evidence?** No. Every driver in `lab/scripts` that harvests the
server report starts one server per cell (`telemetry_e2e_baseline.sh`, `sendpath_ab_bench.sh`,
`rss_timeline.sh`, `callgrind_run.sh`) and `verify_e2e.py` restarts the server per run. The
numbers on file stand. The contract that is broken is the one the code itself states:
`server_sessions[]` "one row per session", the process-wide `t_ask_us` origin "so rows from every
session in a run share one axis", `integrity.sessions` counting across sessions.

**Fix, proposed (not landed).** Tie the sink to the process, not to the last Tap: open the row
file once per process; when the last Tap drops, flush and write a `run_end` report (the harvest's
signal) but keep the channel and the file; `flush_on_exit` unchanged. About 15 lines in
`sink.rs`/`tap.rs`. Regression test: two Taps created and dropped in sequence in one process, the
rows file then holds two session records (the existing sink test owns the process global; the
new case joins it).

## D2 · TS client: a failed single ask leaves its waiter armed, and an orphaned rejection

**Where.** `client/transport-ts/session.ts` `requestExactFrame`: `armWaiter` first, then
`await this.sendFod(...)`. When the control write rejects, the method rejects with the write
error, and the waiter — with its 15 s timer — stays in `waiters`. C7 (2026-09-06) fixed exactly
this on the bulk path (`startExactFrames` fails every waiter at once); the single-ask path is the
interactive product path and was not covered. A second consequence: `armWaiter` answers a
duplicate index with `Promise.reject(...)`; when `sendFod` then throws, nothing ever awaits that
promise, so the browser fires `unhandledrejection` (Node without a handler exits with code 1;
the driver installs one and prints the event).

**Proof.** A stub `WebTransport` whose control writer rejects every write, product bundle,
Node 22 (`lab/bench/ts_session_stub.mjs`, scenario 1):

```text
ask 1 rejected: control write failed (14 ms)
stats after the failed single ask: {"inFlight":1,"droppedEarlyMedia":0,"frameErrors":0} ← inFlight should be 0
ask 2, same frame, rejected: control write failed
bulk waiter rejected: frame 9 unavailable: control write: Error: control write failed (15 ms)
stats after the failed bulk ask: {"inFlight":1,"droppedEarlyMedia":0,"frameErrors":1} ← the bulk path fails its waiter at once (C7)
UNHANDLED REJECTION: frame 7 already requested
```

The bulk path (frame 9) fails its waiter at once, as C7 intended; the single path (frame 7)
keeps `inFlight: 1` and dies on the orphaned duplicate rejection.

**WASM, by reading.** `request_frame` hands the payload to the writer task through an unbounded
channel; when the write fails the task ends and the channel closes. The waiter of the ask that
failed stays until its 15 s timeout; every later ask fails fast ("channel closed") and removes its
own waiter. Same leak, one ask wide. Not run.

**Fix, proposed.** In `requestExactFrame`, fail the waiter when the write rejects (the four lines
C7 added to the bulk path); make the duplicate check throw before arming instead of returning a
rejected promise. WASM: `request_frame` already removes its waiter when the channel refuses the
payload; the writer task's failure path needs the same "fail every armed waiter" that C7 gave TS.

## D3 · Duplicate indices in a bulk ask

**TS.** `startExactFrames([3, 3])`: the second `armWaiter(3)` returns a rejected promise that
*replaces* the first in `bulkPending`. The first waiter is orphaned (it holds `inFlight` until
the timeout), the rejected promise fires `unhandledrejection` before anyone can `waitExactFrame`,
and the wire ask still carries `[3, 3]`, so the server sends frame 3 twice and the second copy
lands as `droppedEarlyMedia`:

```text
UNHANDLED REJECTION: frame 3 already requested
asked on the wire: ["{\"op\":\"request_frames\",\"frames\":[3,3]}"] ← the server would send frame 3 twice
first wait: frame 3 already requested
second wait: waitExactFrame: no pending bulk waiter for 3
stats: {"inFlight":1,"droppedEarlyMedia":0,"frameErrors":0} ← inFlight 1 is the orphaned first waiter (until its 15 s timeout)
```

**WASM, by reading** (`session.rs` `start_frames`). The loop arms the waiter and the bulk
receiver for the first `3`, then returns `Err` at the second — leaving one armed waiter and a
non-empty `bulk_rx`. Every later `startExactFrames` on the session then fails with
"previous bulk still pending" until someone calls `waitExactFrame(3)` and sits through the
15 s timeout. The harness never hits it because `runFill` deduplicates (`new Set(steps)`).

**Fix, proposed.** Validate the whole list (duplicates, already-pending) before arming anything,
in both arms; about six lines each.

## D4 · The dev static host serves the private key and the git directory

`server/dev-server.py` is a `SimpleHTTPRequestHandler` rooted at the repository:

```text
/server/dev-cert/key.pem      200 241B
/server/dev-cert/cert.pem     200 664B
/.git/HEAD                    200 55B
```

Dev-only, bound to `127.0.0.1`, and the cert is a 10-day self-signed one — but a private key
over HTTP is the wrong default for a script named in the README's quick start. Fix: refuse
`/server/dev-cert/`, `/.git/`, `/.local/` (or serve only `/harness`, `/client`, `/lab`,
`/study`, `/wt`). Five lines.

## D5 · Log hygiene: normal closes and refusals are WARN lines

From the server log of the browser e2e (both product clients close with `transport.close()`,
neither sends `EndSession`; the native harness does):

```text
WARN exact_server::transport::pipeline: frame refused frame=1000000 reason=frame index 1000000 out of range (3)
… 63 more …
WARN exact_server::transport::server: control read ended err=not connected
```

A normal session end is reported as a warning with an error, and one bad bulk ask writes one
line per refused frame at wire speed. Proposal: the clients send `EndSession` before `close()`
(one line each) and the server logs a closed or reset control stream at `info`; refusals at
`debug` (the telemetry row and the client both carry the reason). Product-facing, tiny.

## D6 / D7 · Lab driver nits

- `lab/scripts/refusals_e2e.mjs` builds `?wt=undefined&hash=undefined` when the two optional
  arguments are omitted, and the page then fails with "hex length must be even". The page itself
  falls back to `/wt/dev-transport.json`; the driver should add the parameters only when given.
- `server/scripts/verify_e2e.py` `DEFAULT_CHROME` is a container-overlay path from another
  machine; it falls through harmlessly. Delete it, keep `CHROME_PATH` and the standard candidates
  (add `/opt/pw-browsers/chromium`, this runner's).

---

## T · Tooling

| # | What | Evidence | Proposal |
| - | - | - | - |
| T1 | **No CI.** Nothing runs on push; "workspace green" in this and the last report is a hand-run claim | no `.github/` | one workflow: `cargo fmt --check`, `cargo clippy --workspace --all-targets`, `cargo test --workspace` (+ `-p exact-server --features telemetry`), TS build + both `tsc` + recorder tests, both absence checks. Timed here: debug build 48 s cold, clippy 24 s, workspace tests a few seconds, TS side ≈ 10 s, release build for the server absence check ≈ 1 min |
| T2 | `scripts/gate.sh` tests `exact-server` (two feature sets) and `window-harness` only; `study-bundle` (F2's proof), `fod`, `frame-envelope`, `telemetry-bench` are never run; no clippy, no fmt | `gate.sh` lines 25–30 | `cargo test --workspace` and the two lints |
| T3 | `cargo fmt --check` fails (one signature in `client/transport-wasm/src/lib.rs`); clippy: `manual_is_multiple_of` in a `report.rs` test under `--features telemetry`, plus L1's three in `window-harness` | command output | fix the two non-lane ones; L1 fixes its own |
| T4 | `client/transport-ts/tsconfig.json` — the file editors pick up — lacks `allowImportingTsExtensions`; `tsc -p tsconfig.json` reports TS5097 on every `.ts` import; the gate uses `tsconfig.check.json` | `tsc` output | move the flag into the base file, delete `check.json` |
| T5 | `.cargo/config.toml` sets `--cfg=web_sys_unstable_apis` under `[build]` (every host build) as well as for the wasm target; the host builds do not need it, and `build.sh` overrides `RUSTFLAGS` anyway | file | keep the target-specific entry only |
| T6 | `wasm-pack`, `wasm-opt` and the `wasm32-unknown-unknown` target are prerequisites the README does not name | README | one "prerequisites" line; `npm i -g wasm-pack binaryen` works on this runner |
| T7 | `package.json` `build` builds the product bundle only; `build.sh` is the real recipe | files | point the npm script at `build.sh` or delete it |

## Docs · drift

- `lab/README.md` line 35 says the raw rows are at commit `e274c26`; that commit no longer
  exists after the branch rewrite (`git cat-file -t e274c26` → not a valid object). The ledger
  already points at `dbe5260` / `dc141e4`. Corrected in this pass (one line).
- `docs/telemetry/review-2026-09-06.md` G2 says `lab/window-harness` "still uses a third rule"
  for p95; `metrics.rs` is nearest-rank now, with the shared N = 20 test. Needs the repo's banner.
- `lab/scripts/telemetry_e2e_baseline.sh` line 121 comment says `server-pipeline-v1`; the code
  is v2 (comment only).
- The ledger's "`docs/` holds no data" is true of this branch's own rows; `docs/measurements/`
  and `docs/disk-access/*.tsv` are lane-owned data. Wording only.
- Forty-odd documents under `docs/`, most of them superseded plans kept with banners, and the
  README links none of them. A `docs/README.md` index (live / superseded / lane-owned) is the
  cheapest navigation improvement in the repository.

## Tests · gaps

- **The product TypeScript client has no tests.** `client/record/test/run.ts` covers the
  recorder only. The stub `WebTransport` used for D2 and D3 runs in plain Node 22 (web streams
  are globals) and drives the whole session state machine: refusals, timeouts, bulk ordering,
  coalesced control reads (the F1 class, which needed a browser to find), control-write failure,
  close. Proposal: `client/transport-ts/test/session.test.ts` with a `FakeWebTransport` whose
  bidi and uni streams the test feeds, wired into the gate. `lab/bench/ts_session_stub.mjs` is
  the proof of feasibility (50 lines, two scenarios).
- WASM: `wasm-bindgen-test` in headless Chromium could run the same cases; heavier; later.
- Small: `fod` has no test for a truncated frame or an unknown `op`; `frame-envelope` none for a
  short payload; `study-bundle` none for the writer's length-mismatch and incomplete errors.

## Observed, no change proposed

- `session.rs` `bulk_ask_ms` is written twice and never read (dead field).
- `wire.ts` `parseLengthPrefixed` and `parse.ts` `parseFodFrames` (`@deprecated`) have no
  callers; `install.ts` `uninstall` is called only from the tests.
- `MAX_FOD_LEN` guards the server; neither client caps the control-message length it will
  buffer (the server is trusted).
- `frame_out.rs` `envelope_len as u32` would wrap for a frame within 4 bytes of 4 GiB —
  unreachable (clients cap at 64 MiB, `pack-study` at `u32`).
- One timer per outstanding ask in both clients (`setTimeout` / `TimeoutFuture`); a bulk of
  *n* arms *n*. Fine at the sizes in play.
- `read_fod_msg` zero-fills a `Vec` of the wire length (≤ 4 MiB); asks are about 30 bytes.
- `RecvBuf::consume` compacts at 64 KiB and moves at most one chunk; `reserve_for` is right
  relative to the cursor.

---

## Performance pass

The 2026-09-06 pass put the server at 99.7 % QUIC + crypto (nothing outside the lanes left) and
the clients at the browser's `read()` glue plus one or two `Uint8Array.set` copies (BYOB the one
remaining lever, bounded, not taken). This pass looked for what that pass could not measure —
build profiles, the WASM package with `wasm-opt`, and the recorder's own cost — and re-checked
the reading-level items above for anything that costs time. Same tier, same discipline.

### P1 · Server release profile: `lto = "fat"`, `codegen-units = 1`

Not a transport knob: the same source, one Cargo profile change, so it applies to whatever L1
lands. Both binaries telemetry builds; `sendpath_ab_bench.sh`, one saturate harness (D = 4,
`--read-bps 0`, 4 s dwell), four cells, three interleaved repeats, medians:

| cell | profile | frames / 4 s | `send_us` p50 | `send_us` p95 | `serve_us` p50 | server CPU µs / frame | VmHWM |
| - | - | - | - | - | - | - | - |
| 32 KB / shared | base | 7 423 | 35 | 162 | 116 | 274 | 11.6 MB |
| 32 KB / shared | lto | 7 316 | 34 | 156 | 117 | 262 | 11.2 MB |
| 32 KB / per-frame | base | 7 229 | 61 | 251 | 139 | 326 | 11.5 MB |
| 32 KB / per-frame | lto | 7 273 | **49** | 224 | 131 | **301** | 11.2 MB |
| 250 KB / shared | base | 4 949 | 112 | 565 | 183 | 1 032 | 30.5 MB |
| 250 KB / shared | lto | 5 175 | **101** | 553 | 169 | **967** | 30.2 MB |
| 250 KB / per-frame | base | 4 279 | 135 | 940 | 226 | 1 019 | 30.4 MB |
| 250 KB / per-frame | lto | 4 383 | **126** | 905 | 212 | **945** | 30.1 MB |

Per-repeat CPU µs / frame, base | lto — the three repeats do not overlap in three of the four
cells: 32 KB per-frame 321 · 327 · 352 | 302 · 293 · 301; 250 KB shared 1 032 · 1 044 · 1 029 |
967 · 968 · 960; 250 KB per-frame 1 019 · 1 015 · 1 021 | 948 · 945 · 932; 32 KB shared
274 · 299 · 266 | 250 · 262 · 268 (overlapping). `send_us` p50 per repeat, 32 KB per-frame:
61 · 60 · 66 | 48 · 49 · 52. No drops, every harness run completed.

Binary: 7 091 696 → 5 251 264 B (−26 %). Developer cost: an incremental release rebuild of the
server after touching `main.rs` goes from 3 s to 37 s (fat LTO re-optimises the whole link).

**Reading.** A 5–8 % reduction in server CPU per frame in every cell, outside the repeat spread
in three of four, with `send_us` p50 down 8–20 % — the QUIC and crypto crates gain from
cross-crate inlining that the app code (< 0.3 % of instructions) cannot. Throughput on localhost
moves inside its own noise (+2 to +5 %), as expected for a transfer-bound rig. Cost: the
build-time line above. This is a `[profile.release]` entry in the workspace `Cargo.toml`, not a
transport change; L1's send-path work compounds with it rather than competing.
Candidate. Not landed: it changes every binary's build and the lanes should agree.

### P2 · WASM package: release-profile variants, all through `wasm-opt`

Eight builds of `client/transport-wasm`, release, `--target web`, every one through
`wasm-opt -O` as `wasm-pack` does by default; sizes of `transport_wasm_bg.wasm`, and the
`import()` + `init()` (fetch, compile, instantiate) time of each package in a fresh Chromium
context, median of 7 (`lab/bench/wasm_variants.sh`, `lab/bench/wasm_init_time.mjs`):

| variant | `.wasm` | gzip −9 | vs default | `init()` median | min |
| - | - | - | - | - | - |
| default (`opt-level = 3`) | 238 819 B | 102 514 B | — | 6.1 ms | 5.3 |
| `lto = "fat"`, `codegen-units = 1` | 232 466 | 99 925 | −2.5 % | 6.1 | 5.5 |
| `opt-level = "s"` | 217 397 | 90 434 | −11.8 % | 5.7 | 5.2 |
| `opt-level = "s"` + lto | 214 938 | **89 895** | **−12.3 %** | 5.8 | 5.1 |
| `opt-level = "z"` + lto | **209 214** | 90 087 | −12.1 % | 5.8 | 5.3 |
| lto + `panic = "abort"` | 232 466 | 99 927 | −2.5 % | 5.8 | 5.0 |
| without `console_error_panic_hook` | 236 616 | 101 757 | −0.7 % | 6.2 | 5.6 |
| lto, without the hook | 229 980 | 98 905 | −3.5 % | 6.1 | 5.8 |

`panic = "abort"` changes nothing (the wasm32 target already aborts). The glue `.js` is
27.5–28.4 KB in every variant.

**Reading.** Size is the only axis that moves, and `opt-level = "s"` is the whole of it: −12 %
on the wire (gzip), with LTO adding half a percent. `init()` is 5–6 ms for every variant — at
230 KB Chromium's baseline compiler does not care. Speed was checked, not assumed: the
`opt-level = "s"` + lto package against the default on the two harness cells above (WASM arm,
recorder off, 3 interleaved runs, medians): on-demand busy 441 vs 443 ms, WASM self time
212 vs 213 ms; fill busy 111 vs 117 ms, wall 123 vs 142 ms. Nothing lost. Candidate:
`[profile.release] opt-level = "s"`, `lto = "fat"`, `codegen-units = 1` for the wasm crate
(a per-package override, or the workspace profile from P1 plus `opt-level` on the package).

### P3 · The recorder's own main-thread cost

Does the recorder change what it measures? Both arms, two cells, the harness with `telemetry=0`
(product bundle, no patch) against `telemetry=1` (the patched `WebTransport`, the Proxy on every
reader and writer, the Tap), under the Chromium sampling profiler at 200 µs
(`lab/scripts/client_profile_groups.mjs`; medians of 2 runs; ms of main-thread self time;
`(program)` is Chromium's own; `tap_read_cost_us` is the recorder timing its own `onMediaRead`):

| cell | arm | recorder | wall | main-thread busy | Δ busy | Δ per frame | `tap_read_cost_us` p50 / p99 |
| - | - | - | - | - | - | - | - |
| on-demand, 32 KB, D = 4, 2 000 frames | TS | off | 622 | 343 | | | |
| | TS | on | 664 | 401 | **+58 ms (+17 %)** | 29 µs | 5 / 42 |
| | WASM | off | 662 | 435 | | | |
| | WASM | on | 660 | 485 | **+50 ms (+11 %)** | 25 µs | 5 / 30 |
| fill, 80 × 250 KB | TS | off | 121 | 84 | | | |
| | TS | on | 134 | 84 | 0 | 0 | 0 / 48 |
| | WASM | off | 140 | 113 | | | |
| | WASM | on | 132 | 113 | 0 | 0 | 5 / 62 |

Inside the "on" runs, the recorder's own functions: `parseFodMessages` 14 ms (TS) / 31 ms
(WASM) per 2 000 asks — every control write is decoded and JSON-parsed a second time to open the
row, which is the seam's design; `nowUs` 5 ms; `onMediaRead` 2–3 ms; the rest is the Proxy traps
(`bindGet` allocates a bound function on every property read through a proxied reader or writer).

**Reading.** In the interactive cell the recorder costs about 25–30 µs of main thread per
frame, 11–17 % of the client's busy time, and moves wall time by at most 7 % (TS; 0 % WASM).
In the fill cell it is invisible: the 250 KB copies dominate. The `tap_read_cost_us` guard in
the report (p50 5 µs) sees only `onMediaRead`, a fifth of the true cost — the report's own
integrity number under-reads the instrument by that ratio. Nothing here changes a decision made
on the 2026-09-06 numbers (all relative, both arms carrying the same instrument), but a reader
of an absolute on-demand figure from a telemetry build should subtract it. Two cheap reductions
if the number ever matters: cache the bound function per (target, property) in `bindGet`, and
take the ask's frame index from the wrapped session call instead of re-parsing the control
write (a seam decision, recorded in the client ADR as "from outside"; not proposed here).

### Checked and found nothing

- **`RecvBuf` compaction, `reserve_for`, the per-ask `Vec` zero-fill, the per-waiter timers** —
  read again with the numbers above in hand; none reaches a profile line.
- **`FrameStore::frame_slice` re-checks bounds `parse_layout` already proved** (disk lane, by
  reading): one compare per frame.
- **The FoD JSON path** stays at the 2026-09-06 null (0.06 % of server instructions; 7–15 µs per
  ask on the client, inherent to `JSON.parse`).
- **`console_error_panic_hook`** costs 2 KB of wasm and nothing at run time; keep it.
- **Server telemetry overhead** was measured by the telemetry track (0.3–2.1 % of the serving
  path after batching); not re-derived.

---

## Decisions requested

1. Land D1 (sink lifetime) — the proposed shape, or per-run files instead?
2. Land D2 + D3 in both arms (TS proven here; WASM by reading, provable in Chromium now that
   `wasm-pack` builds on this runner)?
3. D5: `EndSession` before `close()` in the product clients, and the two log levels?
4. T1: a CI workflow — yes/no, and whether clippy is `-D warnings` once the lane warnings are
   gone.
5. P1 / P2: adopt the profile changes the tables support?

## How to re-run

```bash
# D1
WTPACS_TELEMETRY=1 WTPACS_TELEMETRY_PATH=/tmp/t/telemetry-server.json \
  target/release/exact-server --port 4471 --study lab/fixtures/frames_32k/frames_32k.sbnd --stream-mode shared --bind 127.0.0.1 &
for i in 1 2; do target/release/window-harness --url https://127.0.0.1:4471/ --mode saturate --depth 4 \
  --frame-count 80 --fill-dwell-ms 800 --read-bps 0 --stream-mode shared --ipv4; ls -l /tmp/t; done
# D2 / D3 (product bundle, Node ≥ 22)
node lab/bench/ts_session_stub.mjs client/transport-ts/dist/session.js
# D4
python3 server/dev-server.py --port 8791 & curl -sI http://127.0.0.1:8791/server/dev-cert/key.pem
# P1
CARGO_PROFILE_RELEASE_LTO=fat CARGO_PROFILE_RELEASE_CODEGEN_UNITS=1 cargo build --release -p exact-server --features telemetry --target-dir /tmp/lto
lab/scripts/sendpath_ab_bench.sh out.jsonl base target/release/exact-server lto /tmp/lto/release/exact-server
# P2: sizes, then init time per variant through the static host
lab/bench/wasm_variants.sh && ln -s "$PWD/.local/wasm-variants" client/transport-wasm/variants
node lab/bench/wasm_init_time.mjs http://127.0.0.1:8765 /client/transport-wasm/variants/opt-s-lto 7
# P3: one cell, one arm, recorder off / on
node lab/scripts/client_profile_groups.mjs http://127.0.0.1:8765 ts "telemetry=0&cell=ondemand&stream_mode=shared&d=4&n=2000&frames=80" off.json
node lab/scripts/client_profile_groups.mjs http://127.0.0.1:8765 ts "telemetry=1&cell=ondemand&stream_mode=shared&d=4&n=2000&frames=80" on.json
```
