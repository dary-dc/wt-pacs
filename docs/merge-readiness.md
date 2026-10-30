# Merge readiness

`claude/av1-unified-mainbase` against what the owner asked of it on 2026-10-14: clean, optimized, completely
functional and improved, simplifications included, with rules for them. An audit (queue row 215, CLEANAUDIT,
2026-10-14, at `cdc77abd`); nothing here is changed but this file.

**The answer, in one line.** The branch fast-forwards `main` and its gate is green. One security hole stands
between it and a deployment: the product page takes code and pixels from any address a link names. Behind that are
two broken options, a half-finished row's build, lab traces in the default binary, product steps that need `lab/`,
and stale docs. All of them can be fixed without losing a capability. The rows that do it are in §Rows to queue.

## Where it stands

* **A fast-forward.** `origin/main` (`c7230a98`, PR #34) is an ancestor: 987 commits, 1 573 files, +102 524 / −5 519.
  The trial merge's 24 conflicts are history: the MAINBASE rebuild removed them
  ([`av1/MAINBASE.md`](av1/MAINBASE.md)). The note that described them, `docs/av1/MERGE.md`, is removed (row
  DOCSTRUE); what of it still holds is §What the branch changes for `main` below.
* **What it adds, by files:** `lab/` 664, `client/` 565 (481 of them golden AV1 frames under `client/contract/av1`,
  2.2 MB), `docs/` 68, `server/` 25, `ingest/` 20, `deploy/` 11, `scripts/` 10.

## What the branch changes for `main`

From the merge note (queue row MERGEPREP, 2026-10-10), what still holds.

* **AV1 beside HTJ2K, not served by default**: its payload format, ingest and decode through WebCodecs or
  dav1d-WASM behind the decoder worker's one contract ([`av1/README.md`](av1/README.md),
  [`av1/payload-format.md`](av1/payload-format.md)). Ingest keeps HTJ2K for every series.
* **A product ingest from DICOM** to a served bundle with per-frame digests (`ingest/from-dicom/`); **the viewer**,
  the product's page at `/`, painted by a WebGL2 painter in a worker; **an unattended deployment** (`deploy/`).
* **The HTJ2K path**, its codestreams byte for byte as before; each change with the measurement that adopted it:

| change | measured | where |
| --- | --- | --- |
| OpenJPH built from pinned sources (0.31.0, single-threaded, 4 MB heap) and checked against a manifest before it is instantiated | fill ×0.927 (1×) and ×0.941 (4×), cold ask ×0.715 and ×0.732, JS+WASM 157 → 22 MB, every frame exact | `decode/README.md` §The build, as delivered |
| `decoder.js` loads one codec module; HTJ2K's range pass in two loops | ×0.79–0.88 a frame on every 10–14-bit grey series | `decode/README.md` §The range pass |
| every decoded frame hashed (XXH3-64) against ingest's digest before it is handed on | 0–15 % of a decode-bound fill; nothing measurable where the wire is the clock | `adr/exactness-in-production.md` §3 |
| an ask its transport timed out is resumed, not failed | no client timer failed an ask under loss; the fill's time unchanged | `client/README.md` |
| the HTTP/3 control stream opened once the ClientHello is whole | Firefox's dial settles 30/30 at 5–50 Mbit/s, against 0–21 of 30 before | `transport/transport-conclusions.md` §Firefox's dial on a slow link |
| HTJ2K encoded in-process and in parallel at ingest | 69/69 cells byte-identical; CPU −21 to −27 % | `ingest/coded-frames/README.md` |

* **Renamed, breaking a caller of the old names, each retired** (no behaviour change): `exact-server` → `series-server`, `--study`
  → `--series`, `/study/metadata` → `/series/metadata`, `pack-study` → `pack-series`, `ingest/study-bundle` →
  `common/series-bundle`; the client as `client/transport/`, `client/decode/` and `client/contract/` (retired:
  `client/conformance/`).
* **Not code**: synthetic AV1 golden payloads under `client/contract/av1/` (483 kB of content, the 2.2 MB above on
  disk), each with its `.sha256`, made by `ingest/coded-frames/make_golden.py`; raw measurement rows under `lab/`. No
  fetched data, no built binary, no secret, as the merge note checked them on 2026-10-10; not re-checked here.

## Completely functional: what was run

The checks were run in a cloud container (4 cores, 15 GB, Docker 29.8.2). Nothing was timed.

| check | result |
| --- | --- |
| `scripts/gate.sh`, full | **green, 352 s.** It skipped five steps by name: numpy and pydicom were missing (the first venv failed, see below); the two ingests' comparison needs `lab/.av1-build`; the viewer's cross-codec arm and Firefox were not run. |
| `scripts/gate.sh` again, with numpy and pydicom (a CPython 3.11 venv) and the lab's coders built | **red once.** Every previously skipped step but the viewer's cross-codec arm and Firefox ran and passed (the painter at 1:1, the split's merge 142/142, the DICOM reader, both ingests identical). But `an_opening_ask_rides_the_websocket_upgrade` failed with "server never listened" (B7). The suite then passed 10 of 10 times, and the test alone 30 of 30. A third full run was **green in 118 s**, skipping only the cross-codec arm and Firefox, which the viewer check covers below. |
| the decoder builds (`client/decode/wasm/build/build.sh`) | **built, and they match `manifest.sha256`** |
| `lab/av1/requirements.txt` on CPython 3.13 | **fails.** xxhash 3.6.0's cp313 wheel is not among the pinned hashes. The file pins CPython 3.11 wheels only (its line 1), but README §Prerequisites says "Python 3.11 or newer". It installs on 3.11. |
| the viewer check in Chromium 141 (the gate's grey series, `client/viewer/check.mjs`) | passes |
| **the viewer check in Firefox 157.0.1**: conda-forge `firefox-157.0.1-hee9eb32_0` (SHA-256 `f1b53de2…4d7127f35`), Mesa `mesalib-26.2.3-he59ec28_0` (`e94b9a63…2a26b53`), `xvfb-run` | **passes**: 3/3 exact, readbacks equal to the CPU reference, llvmpipe |
| the check's `--cine`, in both engines | passes; the cine moved over 3 frames |
| **the check's `--fill 0`, in both engines** | **fails, 4 of 4 checks.** The fault is in the check, not the page. Frame 0 arrives exact and drawn. The check then demands every frame received and read back. On-demand mode never fills, and the protocol's two asks (`check-page.js:20-26`) do not enter the page's frame map. So the viewer's on-demand mode has no working check, and the gate does not say so (`run_check.sh` names only the cross-codec arm and Firefox as skipped). Fixed by row 219 (F4): it now passes in Chromium. |
| the deploy image, built, up, and the viewer through it in both engines | **passes**; [§The deploy image](#the-deploy-image) |

## What is not finished product

Each item gives its evidence, a verdict, what the change would cost, and its size. Every verdict loses no
capability the product has. Where removing something would lose one, the verdict is *keep*. The items are ranked
within each group, and the groups are ranked by what merging needs first.

### 1. Broken

| # | item | evidence | verdict | cost | size |
| --- | --- | --- | --- | --- | --- |
| B1 | **The product page takes its code and its pixels from wherever a link names.** `?opts=` is spread into `connect` with no checks, so a link can set `transport`, which the worker loads with `import()`. It can also set `decoder.glue`, which is fetched and run through `new Function`. The pin is optional: it applies only when `d.sha256` is present. `?wt=`, `?hash=` and `?metadata=` replace the server and the digests, and such frames show as exact. No Content-Security-Policy is sent (`deploy/nginx`, `server/dev-server.py`). The deploy image serves this page. | `client/viewer/viewer.js:15-17,116-127`; `client/viewer/index.html:25`; `client/decode/wasm-glue.js:7-9`; `client/transport/downloader.js:462` | **move to lab**: the product page reads only `/wt/dev-transport.json` and `/series/metadata`. The lab levers stay, honoured by the dev host or a lab build alone. A CSP restricting scripts and connections to the page's own origin and the transport is added. | none to the product. The lab's total-time and check harnesses keep their levers on the dev host. | ~20 lines, plus the nginx header |
| B2 | **`hasher: "hash-wasm"` never reaches the decoder.** The init message has no `hasher`, yet the docs say it is "one init flag away", and the web image refuses to build without the hash-wasm vendor file, which it never loads. | `client/transport/downloader.js:418` against `client/decode/decoder.js:22`; `client/README.md:156`; `docs/adr/exactness-in-production.md:479,726`; `deploy/Containerfile:64` | **remove** the option and the image's `test -f`. Keep hash-wasm only as `xxh3.test.mjs`'s reference. Correct the docs in place. | none: the option never worked | ~10 code, 4 doc lines |
| B3 | **The viewer shows a false error when a frame is asked twice.** In fill mode, stepping 5→6→5 before frame 5 arrives asks frame 5 again. The consumer then refuses with "already requested", and the page counts that in `errors`. | `client/viewer/viewer.js:141-149`; `client/transport/consumer.js:149` | **finish**: do not ask a frame whose ask is pending, and add a test. **Fixed** by row 219 (VIEWERASKS): a pending ask is not repeated, and the check counts the asks. | none | ~3 + test |
| B4 | **On-demand steps race.** Two quick steps both await `cancel()`, then both ask, so "the newest ask alone kept" (`client/README.md:277`) does not hold. A cine faster than the link cancels every ask; not measured. | `client/viewer/viewer.js:143-146,161` | **finish**, with a working `--fill 0` check (F4) **Fixed** by row 219: a step superseded during its cancel asks nothing, and the downloader, which refused a frame asked again after a cancel while the cancelled ask was still owed, now takes that ask over. | none | ~6 |
| B5 | **The banner's `wt_url` ignores `--bind`.** It always prints `127.0.0.1`, and the harness reads it. | `server/src/transport/server.rs:88,91` | **finish** **Fixed** by row 241 (SERVERSTART, PR #61): `wt_url` and `ws_url` name the `--bind` address when it is a specific one, loopback otherwise, under a test. | none | ~4 |
| B7 | **A gate test fails about 1 run in 12.** `an_opening_ask_rides_the_websocket_upgrade` takes a port that `free_port()` found free for UDP only, and then the server also binds TCP on it. A taken TCP port ends the server with an error, but the test discards that error and fails 5 s later with "server never listened". That is the suspected cause; it is not reproduced. | `server/src/transport/server.rs:919-924,1110-1126`; `websocket.rs:63-75` | **finish**: the test reports the server's own error, and its port is free for both protocols. Mutate it by holding the TCP port. **Fixed** by row 219: the three WebSocket tests take a port free for both and race the server, which fails them with its own error (the TCP port held: in 0.16 s). | none | ~10 |
| B6 | **A bare `cargo build` fails on a fresh clone.** `ingest/from-parser/build.rs` panics without `lib*.so` under `lab/`, and the workspace has no `default-members`. | `ingest/from-parser/build.rs:7-14`; `Cargo.toml:2-15` | **simplify**: add `default-members`, the product crates | none | ~10 |

### 2. Half-finished work on the branch

| # | item | evidence | verdict | cost | size |
| --- | --- | --- | --- | --- | --- |
| H1 | **Row 189 (INITIALMEASURE) is claimed and provisional, but its build is already in every default binary.** The flag is off, but the 117-line quinn-proto patch is carried in every build. Its cells A and C ran with every arm at a 38 400-byte initial window: all 8 servers' settings lines in `reply-a` and `reply-c` say so. That is because its build (`5b5d68c3`) predates `f57700d3`, which put the default back to 12 000. So its "today" arm is not today's default, and the cell does not say so. | `server/src/transport/tuning.rs:78-81,121`; `patches/quinn-proto-0.11.18-reply-repeated-initial.patch`; `patched/quinn-proto/build.rs:3`; `lab/irtt/raw/reply-{a,c}.jsonl.gz` | **finish**: row 189 states the confound, re-runs or discloses it, and decides. If the repeated Initial is not adopted, the flag, the patch and its tests go. | none until decided | ~−270 if removed |
| H2 | **The queue copy on the branch stops at row 121** and says the queue lives on `claude/av1`. Docs and code cite rows past it, and those citations cannot be followed from `main`. | `docs/av1/queue.md` (2 772 lines); `ingest/from-dicom/from_dicom.py:24`; `client/decode/wasm/build/README.md:4` | **finish**: bring in the final queue from `claude/av1-mainbase` at merge | none | 1 file |
| H3 | **Open decisions that keep lab code in the product.** Each was measured, but the decision is still open: `startOnNeed` is a trade-off, for the owner; the AV1 `mixed` decoder is open; `readMin` at 16 KB first needs its unnamed-cut defect fixed. | `client/transport/downloader.js:132-153,448`; `client/decode/av1.js:13,60-70`; `client/transport/ts/frame-session.ts:99-103,186-189` | **keep**, each off by default, until the owner rules (§Blocked) | — | — |

### 3. Lab-only paths compiled into the product

| # | item | evidence | verdict | cost | size |
| --- | --- | --- | --- | --- | --- |
| L1 | **The congestion traces ship in the default binary, and the absence check misses them.** `cc_trace` calls itself "Lab only", but it wraps every controller. An unopenable `WTPACS_CC_TRACE` panics the server at startup. `strings` finds the variable in the default release build. | `server/src/transport/tuning.rs:124`; `cc_trace.rs:1-3,225-235`; `server/scripts/check_telemetry_absent.sh:22,29` | **move to lab**: put the traces behind `telemetry`. Their two lab users (`lab/av1/delivery/total-time/run.mjs:126`, `lab/loss-class/run.py:95`) build with that feature. The check also looks for the two variables and `record::path`. | none | ~14 |
| L2 | **A read-ahead hook that row 197 rejected is still in the product reader.** rustc reports it as unused in the crate. Its only caller is `lab/container-bench`. | `server/src/media/read_path.rs:111-141,205-210`; `docs/adr/disk-access.md` §6 *Measured (row 197)* | **remove** it, with its test (`read_path.rs:742-771`) and the bench's hook arms | the lab re-adds it from history if a follow-up is queued; the product loses nothing | ~−60 |
| L3 | **`followQueue`, measured and not adopted** ("neither adopted"). | `client/transport/downloader.js:44-46,155-161`; `downloader.test.mjs:117-168`; `docs/ARCHITECTURE.md:1178` | **remove** (a tag keeps it) | none: it is off, and the measurement is recorded | ~−75 |
| L4 | **The deploy image serves all of `client/`.** That includes the harness pages, `record/*.ts`, the check pages and the build scripts. The nginx comment says "what the page loads, and nothing else". | `deploy/Containerfile:58`; `deploy/nginx/wt-pacs.conf.template:43-45`; `deploy/check_equivalence.sh:66` | **simplify**: copy an allow-list (`viewer/`, `transport/{consumer,downloader}.js`, `ts/dist/`, `decode/*.js`, `decode/wasm/built`, `paint/{painter,paint-worker,voi}.js`) | none | ~10 |
| L5 | **The image build copies four lab crates whole**, 2.5 MB of `container-bench` results included. This contradicts the Containerfile's own comment and deploy/README §5. | `deploy/Containerfile:18-23`; `Containerfile.dockerignore:9-13` (`!lab/telemetry-cost` is dead) | **simplify**: copy each lab crate's `Cargo.toml` and `src/` only, and drop the dead line | none | ~10 |
| L6 | **The client's build makes a lab artifact.** | `client/transport/ts/build.sh:23` (`lab/telemetry-cost/cost.ts`) | **moved to lab** (row 243) | none | 1 |
| L7 | **Lab levers that stay, as levers:** `--force-pool-reads` (the documented forced miss), `--hold-sessions` and `--stall-after-bytes` (WebKit bugs 319879 and 319818, both tested), `--segmentation-offload false` (netem), `--send-window-follows-cwnd` (a trade-off; its test came with row 239), `per-frame-asks-first` (theory only), `--congestion cubic\|bbr\|bbr-bound` (bbr-bound failed its rule; whether to retire it is the owner's call), WebSocket, race and `recycleAtBytes` (the TCP fallback and the iOS recycle). | `server/src/main.rs:27-40`; `tuning.rs:15-21,82-85`; `stream_mode.rs:14`; `docs/levers.md:101,115` | **keep**. Add a test for `--send-window-follows-cwnd` (~30 lines). The five loose lab fields threaded through `ServeConfig`, `Sessions` and `Link::quic` could become one struct, but that is structural: propose it first. | removing any of them loses a lever an open measurement uses, or a fallback | — |

| L8 | **Row 209's lab `FrameCache`** landed after this audit's base (`33a47a54`). It sits behind the `lab-frame-cache` feature, off by default, and the gate compiles it. The server crate takes its source from `lab/` by `#[path]`, under `#[allow(dead_code)]`. | `server/src/media/lab_frame_cache.rs:1-7`; `server/src/media/mod.rs:3-4`; `server/src/transport/pipeline.rs:77-95`; `server/Cargo.toml:19` | **keep** while row 209 measures. Then **remove** it, or move the cache into `server/` if it is adopted. | none | ~−100 if removed |

### 4. Product steps that need `lab/`

| # | item | evidence | verdict | cost | size |
| --- | --- | --- | --- | --- | --- |
| P1 | **The ingest's native coders (aom 3.15.1, dav1d, OpenJPH 0.31.0) are built by lab scripts into lab directories.** OpenJPH's "installer" is a fixture generator, and it needs numpy on the default `python3`. dav1d's build needs `meson`, which README §Prerequisites does not list (meson 1.9.1 was used here). | `ingest/coded-frames/ingest.py:30`; `build.sh:8-9`; `ingest/from-parser/build.rs:7-8`; `README.md:28-29`; `lab/av1/tools/tools.sh` | **finish**: an ingest/tools.sh builds the three pinned coders into a product directory, and lab's `tools.sh` calls it | none | ~60 moved |
| P2 | **The ingest's Python dependencies are pinned in `lab/av1/requirements.txt`**, for CPython 3.11 only (see §Completely functional). | `README.md:23,107`; `scripts/gate.sh:115,122,132` | **finish**: an ingest/requirements.txt that lab's includes, pinned for 3.11–3.13 or with the README saying 3.11 | none | ~10 |
| P3 | **README §The viewer on a DICOM series fails from a fresh clone.** `ingest/coded-frames/build.sh` needs builds that only the comparison's prerequisites make. | `README.md:28-29,106-107`; `docs/FIXTURES.md:55-56` | **finish**, with P1 | none | ~8 |
| P4 | **An HTJ2K-only ingest still needs `aomenc`.** | `ingest/coded-frames/ingest.py:111-115,267,278` | **simplify**: check it for AV1 only | none | ~3 |
| P5 | **Product tests that live in lab.** The split's merge test tests `ingest.py`, and `server_start_test.sh` tests `deploy/server-start.sh`. `make_golden.py` imports a 3-line `splits()` from lab. | `lab/av1/exact/split/merge_test.py:14`; `lab/devices/server_start_test.sh:2,10`; `ingest/coded-frames/make_golden.py:98-100` | **move** them beside what they test, and inline `splits()` — row 222: moved to `ingest/coded-frames/` and `deploy/`, the lab paths removed | none | ~95 moved |
| P6 | **The client's checks reach into lab.** | `client/paint/check.mjs:16,49` (`lab/order.mjs`, `lab/scripts/gen_frame_pnm.py`); `client/decode/wasm/dav1d/build.sh:13` | **keep** for the checks, which are lab-shaped. `client/decode/wasm/dav1d/` is lab tooling apart from `dav1d_wrap.c`: **move to lab**, and keep the wrapper. | none | ~550 moved |

### 5. Duplicated logic

| # | item | evidence | verdict | size |
| --- | --- | --- | --- | --- |
| D1 | `CubicConfig`/`BbrConfig` built with the initial window in four places | `server/src/transport/tuning.rs:27-38`; `restart.rs:151-155`; `loss_bound.rs:167-171` | simplify: one build in `Congestion::factory` | ~−12 |
| D2 | two `unsafe preadv2(RWF_NOWAIT)` blocks | `server/src/media/frame_store.rs:98-111,192-205` | simplify: one helper | ~−10 |
| D3 | hit/miss counting written twice | `server/src/media/read_path.rs:212-218,335-339` | simplify | ~−6 |
| D4 | tests that hand-write SBND bundles instead of using `series_bundle::write_bundle` | `server/src/transport/pipeline.rs:220-233`; `read_path.rs:514-540`; `server.rs:865-870` | simplify (`frame_store.rs:277` must hand-write its bundle) | ~−35 |
| D5 | `StreamMode` hand-writes `Display`/`FromStr`; `Congestion` derives `ValueEnum` | `server/src/transport/stream_mode.rs:262-283` | simplify | ~−20 |
| D6 | the FoD message union defined twice | `client/transport/ts/wire.ts:3-30`; `client/record/parse.ts:8-55` (at `0ee0c1f2`; `lab/client-telemetry/` since row 264) | simplify: `record` imports it | ~−10 |
| D7 | SHA-256-to-hex written three times | `client/viewer/viewer.js:246-250`; `check-page.js:4-5`; `client/decode/wasm-glue.js:14` | simplify | ~−6 |
| D8 | `ingest/from-parser/same.py` rebuilds by hand the metadata `from_dicom.py` writes | `same.py:35-37`; `from_dicom.py:51-53` | simplify: one `metadata()` | ~10 |
| D9 | **the WASM transport**, a second full client in Rust that the product never loads. It duplicates `frame-session.ts` and the gate needs wasm-pack for it. | `client/transport/wasm/` (~780 lines) | **move to lab**, beside `lab/other-clients`. This is structural: propose it first. *Rejected 2026-10-16 by the owner: two product clients ([`CLIENTS.md`](CLIENTS.md) §Proposed: the WASM client as a second product client, row 263).* | ~780 moved |
| — | the two ingests (`from-dicom`, Python; `from-parser`, Rust) | `docs/ingest/README.md` §4 | **keep**: one reads DICOM, the other is the compiled ingest, and it is phase 1 | — |
| — | dual-stack bind written twice (QUIC, TCP) | `server.rs:242-273`; `websocket.rs:63-75` | keep: two libraries | — |

### 6. Dead code

| # | item | evidence | verdict | size |
| --- | --- | --- | --- | --- |
| X1 | `crypto-ring` is a feature that cannot be turned off: `main.rs` calls ring unconditionally, and `--no-default-features` alone fails to compile. | `server/Cargo.toml:16,23`; `server/src/main.rs:47` | simplify: plain dependency features | ~6 |
| X2 | `pub mod` exposes seven transport modules that no other crate uses, which hides dead code from rustc | `server/src/transport/mod.rs:1-11` | simplify: `pub(crate)` | ~8 |
| X3 | `FrameStore::file` is unused without `uring`, and the gate prints the warning | `server/src/media/frame_store.rs:71-73` | simplify: `#[cfg]` | 1 |
| X4 | the painter's `workerUrl` and `placement`'s export | `client/paint/painter.js:11`; `paint-worker.js:142` | removed (row 243) | 2 |
| X5 | `client/dev-transport.json.example`, which nothing references | — | removed (row 243) | 4 |
| X6 | `series-bundle`'s format constants are `pub` but have no user outside the crate | `common/series-bundle/src/format.rs:8-12` | simplify | 4 |

No `TODO`, `FIXME` or `#[ignore]` was found in the product, and only one `#[allow(dead_code)]`: L8's, behind its feature. With the modules private, rustc
flags only L2 and X3, plus `nowait_supported_at`, which `tools/check-fastpath` uses.

### 7. Tests and checks the gate does not run

| # | item | evidence | verdict | size |
| --- | --- | --- | --- | --- |
| F1 | `deploy/check_equivalence.sh`: dev host against nginx (headers, bodies, hidden paths, gzip) | — | **finish**: a gate step with `--local` where nginx is on PATH, named as SKIPPED otherwise | ~5 |
| F2 | `cert-compression` is never built by the gate or the image (ARCHITECTURE §What production adds: −32.3 %) | `server/Cargo.toml:26` | finish: `cargo check --features cert-compression` | 1 |
| F3 | `lab/container-bench` is never compiled. `disk-access-bench` (12 tests) and `telemetry-bench` (3) are compiled but not run. | `scripts/gate.sh:164` | finish: compile all four and run their tests | 1 |
| F4 | the viewer's on-demand mode: `--fill 0` fails (§Completely functional), and the gate does not name it | `client/viewer/check-page.js:20-26`; `check.mjs:111`; `run_check.sh` | **finish**: in on-demand mode the check judges what was asked, then runs `--fill 0` and `--cine` in the gate **Fixed** by row 219: on demand the check steps the page and judges what it asked; the gate runs `--cine` and `--fill 0`. | ~15 |
| F5 | the gate's real-decode rigs run npm's OpenJPH 2.4.11, not the product's manifest-pinned build | `client/contract/dispatch-rig.ts:654-661,678-803` | finish: also run them on `builtDecoder` | ~10 |
| F6 | the telemetry-absence check reads `session.js` only; `ws-session.js` and `race-session.js` also ship | `client/scripts/check_telemetry_absent.sh:7` | finish | ~3 |
| F7 | DICOM to `.sbnd` end to end (`from_dicom.py main()`); pack-series' "writes the same bytes" (true: re-packing gives identical bytes, 151 B) | `ingest/from-dicom/from_dicom.py:32-60`; `README.md:43` | finish: a synthetic object through the ingest, and a `cmp` | ~25 |
| — | Firefox, the cross-codec arm, the full painter cells, `cellcheck.sh`, `wtcompat.py`, `seccomp-uring.sh --check` (*corrected 2026-10-14:* in the gate since row 231, the deploy loading the profile) | `README.md:92-99` | keep: each is named, and each needs a browser, a display, fixtures or the network | — |

F2, F3, F5, F6 and F7 are gate steps since row 226 (GATEGAPS); `from_dicom.py` now finds `pack-series` under
`CARGO_TARGET_DIR`, which F7's test found it did not. Since row 234 the viewer check, `wtcompat.py` and `pgo_build.sh` do too;
the viewer check takes a UDP port it found free, as B7's tests do, and the painter check the port `dev-server.py` reports.

### 8. Docs that contradict the code, or are stale

| # | item | evidence | verdict | size |
| --- | --- | --- | --- | --- |
| C1 | `server/README.md`: "Lab only" lists 3 levers out of about 10, says the default build carries no telemetry (L1 shows otherwise), names `Sessions` fields that do not exist, and leaves `LossBound` and `Traced` out of its object table | `server/README.md:18,126,134-137` | finish | ~12 |
| C2 | `docs/cloud-queue.md` §Open owner decisions is stale: "GSO cap, 24 or 45" (24 was adopted), v3's bound "the candidate" (it failed). Two product docs still name it as the tracker. | `docs/ARCHITECTURE.md:1175`; `docs/CLIENTS.md:382` | finish: repoint both lines to each doc's §Open. `cloud-queue.md` itself is not this queue's to edit. | 2 |
| C3 | `docs/av1/MERGE.md` describes conflicts the rebuild removed | `MERGE.md:16-23,73` | **remove**, folding what is still true into the pull request | −83 |
| C4 | `docs/handoff-2026-10-04.md` (to a finished branch) and `docs/server-design-proposal.md` (R4, never built, with line references pinned to old commits) | — | **remove**. Keep R4 as one line in ARCHITECTURE §Open, and the container tips in README if they still hold. | −714 |
| C5 | `docs/adr/disk-access.md` §5 says the `uring` read lever is "kept as a lab flag"; §1 says it was removed on 2026-10-03, and `ReadMode` has only `auto\|pool` | `disk-access.md:51,169` | finish: correct §5 in place | 1 |
| C6 | `ARCHITECTURE.md:863` states `--initial-rtt-ms 100` at −700 ms as settled. Row 139's rule did not pass. | `docs/ARCHITECTURE.md:861-863` | finish: say so | 1 |
| C7 | `deploy/README.md` cites row 195's results, which are not on this branch. It calls the 151-byte smoke bundle "32 KB" and never says its frames do not decode. It publishes TCP 4433, but the start script passes no `--websocket`. `README.md:98` says `check_equivalence.sh` checks "every path the harness uses"; the script hides the harness. | `deploy/README.md:14,36,169,191,271`; `deploy/server-start.sh:22` | finish | ~8 |
| C8 | `client/README.md`: calls the downloader "the lab's only client", puts dav1d's notices at a path that is not the built one, gives an incomplete list of viewer parameters, and has a stale decode table | `client/README.md:4,18-38,277-282` | finish | ~8 |
| C9 | `README.md:128` names `frame_out.rs` (now `link.rs`); `ARCHITECTURE.md:405` names `run.mjs` (it is `run.ts`); `WIRE.md:72-74` says the envelope carries "an HTJ2K codestream" (it is codec-neutral) | as cited | finish | 4 |
| C10 | **queue and campaign labels in product code**: 15 comment lines in 12 files (e.g. `tuning.rs:71` "(IWDEEP)", `from_dicom.py:22` "Row TOTAL4", `dispatch-rig.ts:562` "R3:"), and 9 lines in 5 product READMEs | — | simplify: name the measurement. Several are anchors, so rename the heading as well. | ~24 + headings |

### The deploy image

`docker compose -f deploy/compose.yml build` was run with `BUILD_CA` set to the container's proxy CA (deploy/README's
variable for it). **Both images built** (the server's release in 2 min 26 s); Docker Hub served the pinned digests.
Brought up with `STUDIES` holding the gate's grey series (`SERIES=grey`): both services healthy within 8 s, the
transport file written, and then:

* `client/viewer/check.mjs --url http://127.0.0.1:8765/` **passes in Chromium 141 and Firefox 157.0.1**: 3/3
  exact, readbacks equal to the CPU reference. The viewer fills and asks end to end through the shipped images.
* `deploy/check_equivalence.sh` **passes**: 10 paths equal to the dev host, 8 hidden, gzip, the Server header and
  the PEM's chain.
* What the check does not cover (L4 and B1): `/client/harness/cell.html`, `/client/record/tap.ts`,
  `/client/decode/wasm/build/build.sh` and `/client/transport/wasm/src/session.rs` all answer 200, `/?opts=…` is
  honoured, and no `Content-Security-Policy` is sent.

## The simplification rules, drafted for `CLAUDE.md`

For the owner to adopt, edit or refuse. The draft sits under §Code.

> **A simplification removes, and proves it lost nothing.**
>
> * **It may remove:** code that nothing calls (rustc, `tsc` or a search shows no caller); a flag or path whose
>   measurement is recorded in `docs/` with its verdict, and the verdict is not "adopted"; a path a measurement
>   rejected; a duplicate of logic that stays in one place; a doc that a newer one or the code supersedes, corrected
>   in place where it is cited.
> * **It may not remove:** a capability the product has (a codec, a transport, a fallback, a mode a user can reach);
>   a measured gain; a check, test or gate step, unless the same claim is still checked elsewhere; a lab lever that
>   an open measurement or an owner decision still uses. Such an item is kept, or its decision is put to the owner.
> * **Its benefit is stated as counts:** lines removed, dependencies or carried patches removed, and concepts a
>   reader no longer has to hold (a flag, a type, a file, a name). "Cleaner" is not a benefit.
> * **It is proved by** the gate green with the same skips or fewer, and every test it touches mutated once, so
>   that it still fails. A change on a measured path also needs the same measurement before and after, interleaved,
>   and a tie or better. A simplification that cannot be proved this way is a proposal, not a change.
> * **It lands for review.** It removes or alters what exists, so it finishes on its own branch and the owner merges
>   it (`docs/av1/queue.md` §Protocol).

## Rows to queue

Ranked by what merging needs first. Each row is named in the queue's style. *review* means it removes or alters
something, so it finishes on its branch for the owner.

1. **VIEWERLOCK** (*review*) — B1: the product page ignores the lab levers outside the dev host, the image sends a
   CSP, and a test shows a crafted link being refused. This blocks any deployment.
2. **DEADHASHER** (*review*) — B2: the hasher option and the image's vendor requirement go.
3. **VIEWERASKS** — B3, B4, B7 and F4, each fix with a failing test: no repeated ask, the newest on-demand ask kept,
   a `--fill 0` check that judges what was asked, run by the gate with `--cine`, and the WebSocket test's port.
4. **INITIALMEASURE** (row 189, already claimed) — H1: the 38 400-byte confound stated, then the decision, then the
   patch kept or removed. This is a note to its session, not a new row.
5. **LABTRACES** (*review*) — L1, X1, X2 and X3: the traces behind `telemetry`, the absence check widened, and
   `crypto-ring` and the module visibility fixed.
6. **INGESTTOOLS** (*review*) — B6, P1–P5: `default-members`, ingest/tools.sh, ingest/requirements.txt (3.11–3.13),
   the README's DICOM path from a fresh clone, and the product tests moved out of lab.
7. **IMAGESLIM** (*review*) — L4, L5 and F1: the image serves the page's allow-list, copies lab crates' sources only,
   and `check_equivalence.sh --local` runs in the gate.
8. **REJECTEDPATHS** (*review*) — L2 and L3: the rejected read-ahead hook and `followQueue` removed; L8 once row 209 decides.
9. **DOCSTRUE** — C1–C10 and H2: every contradiction above corrected in place, the stale docs removed, and the final
   queue brought in at merge.
10. **GATEGAPS** — F2, F3, F5, F6, F7: the image's features, the lab crates and their tests, the product decoder in
    the rigs, the other bundles' absence check, DICOM end to end and the pack's `cmp`.
11. **DEDUP** (*review*) — D1–D8.
12. **WASMTOLAB** (*review*, propose first) — D9 and P6's `dav1d/` tooling moved to lab. *Corrected 2026-10-16:* D9's
    half rejected; row 263 proposes the client as a product client. P6's half rejected too: the client, its decoders and
    build tools are a product path.

**For the owner, not a row:** H3's three open decisions (`startOnNeed`, `mixed`, `readMin`'s default), whether to
retire `bbr-bound`, and whether to fold the lab levers into one struct (L7). Draft PR #37 (row 181) stays open, as
asked. PR #35 (`claude/av1-unified` → `main`) is superseded by PR #36 (this branch) and can be closed.

## Second round

The owner, 2026-10-15: "a simplification and improvement round". Row 215's method again (queue row 238,
SIMPLIFYAUDIT), on `claude/av1-unified-mainbase` at `0ee0c1f2`, whose tree is `main`'s at `27df9dca`: every file
under `server/`, `client/`, `ingest/`, `common/`, `deploy/` and `scripts/`, and the docs that describe them, read for
what can be removed, simplified, merged or made plainer with no capability lost, and for improvements a measurement
in `docs/` already backs that the code does not use. An audit: nothing was built, run or timed but
`scripts/comment_budget.sh` (it passes) and searches; nothing here is changed but this section.

Out of scope, as the brief says: rows 232–236 (queued), and the owner's open decisions — #48 (row 227, D1–D8),
row 228 (D9, P6), row 220 (#41) and the SELinux choice. What those decisions hold is counted in
[§What the open decisions hold](#what-the-open-decisions-hold) so the owner sees it, and no row below touches it.

**The answer, in short.** The product code is already close to its essentials: rows 217–226 took out what the
first round found, and what is left is small. The largest saving is in the server's tests (about 200 lines of
repeated set-up); the product's own code gives about 100 lines across four low-risk rows. One removal
(`cubic-classify`, ~185 lines) waits on the owner's word, and two changes are structural proposals. Round 1 left
six items that no row took (B5, X4, X5, L6, L7's test, and a gate condition that B2 made stale); they are in rows
239, 241 and 243.

### Findings

Each finding: where, the verdict, what it would cost (a finding that would cost a capability is *keep*), the lines
it saves, and whether it is structural (`CLAUDE.md`: a structural change is proposed, not built). Risk: 1 is a
change the gate's tests already cover, 2 needs a check the gate does not run, 3 is structural.

| # | finding | evidence | verdict | capability cost | lines | risk |
| --- | --- | --- | --- | --- | --- | --- |
| S1 | **Round 1's B5, never queued.** The banner's `wt_url` and `ws_url` always name `127.0.0.1`, whatever `--bind` says. | `server/src/transport/server.rs:88-92` | finish: name the bound address when `--bind` gives a specific one. **Fixed** by row 241 (#61) | none | ~+3 | 1 |
| S2 | **Round 1's X4, never queued.** The painter's `workerUrl` option has no caller; `placement` is exported and imported by nothing; voi's `FUNCTIONS` and `PHOTOMETRIC` likewise. | `client/paint/painter.js:11`; `paint-worker.js:142`; `voi.js:3,37` | remove the option and the three `export`s | none | ~−1, 4 changed | 1 |
| S3 | **Round 1's X5, never queued.** `client/dev-transport.json.example`: nothing reads it, and `gen_dev_cert.sh` writes the real file. | the file; `server/scripts/gen_dev_cert.sh:37` | removed (row 243) | none | −5 | 1 |
| S4 | **Round 1's L6, never queued.** The client's build makes a lab artifact. | `client/transport/ts/build.sh:23,25` | move to `lab/telemetry-cost` (its README's run line builds it) | none | −1 product | 1 |
| S5 | **The bundles' build runs `npx esbuild` ten times with the same flags.** | `client/transport/ts/build.sh:12-24` | simplify: one shell function, `bundle IN OUT PLATFORM` | none | ~−6 | 1 |
| S6 | **A gate step skipped for a file it no longer needs.** `deploy/check_equivalence.sh --local` is skipped without hash-wasm's vendor file, but since row 218 (B2) neither the page nor `deploy/web-files.sh` loads it. | `scripts/gate.sh:194`; `deploy/web-files.sh:9-14` | simplify: require the decoder builds alone | none; the step runs where it was skipped | −1 | 1 |
| S7 | **Round 1's L7 test, never written.** `--send-window-follows-cwnd` sets the send window before each frame, and no test fails if it stops. | `server/src/transport/link.rs:81-84`; `server.rs:115-121` | finish: a test that fails when the flag stops bounding what is written ahead (quinn has no getter for the send window, so the test observes the bytes a non-reading client is sent); mutate by dropping the `set_send_window` | none (additive) | ~+30 test | 2 |
| S8 | **Two structs for one configuration.** `main.rs`'s `Args` repeats `ServeConfig` field for field, with a second set of doc comments, and copies one into the other. | `server/src/main.rs:7-44,61-75`; `server/src/transport/server.rs:32-59` | merge: `ServeConfig` derives `clap::Args` (its two renamed flags as `#[arg(long = "port")]`, `long = "series"`), `main` flattens it; `install_crypto_provider` inlined. The flags stay byte-identical: `--help` before and after, diffed | none | ~−40 | 1 |
| S9 | **`run_server` is 93 lines**: identity, endpoint, store, banner, lab warnings, sessions, accept loop. | `server/src/transport/server.rs:61-153` | split: the banner (`88-110`) and the lab levers' warnings and derived values (`112-121`) into two functions | none | ~0, a 93-line function into three of ≤ 40 | 1 |
| S10 | **`build_endpoint` builds the same config three times** (`--bind`, dual-stack, IPv4 fallback). | `server/src/transport/server.rs:231-275` | simplify: try an ordered list of (bind config, label) | none | ~−12 | 1 |
| S11 | **The server's tests build their world by hand, 17 times.** Each makes a temp dir, a series, a dev certificate and a port, builds a runtime in 3–5 lines, installs the crypto provider and removes the dir (16–20 copies of each); the QUIC client endpoint is built 14 times; the dial-and-retry loop is written three times beside `connect_session`'s. | `server/src/transport/server.rs:440-2277` (e.g. `1340-1380`, `1387-1456`, `1992-2030`); `uring_reader.rs` tests (5 runtimes) | simplify: a `Fixture` (dir, series, cert, port; removes its dir on drop), `#[tokio::test(flavor = "multi_thread", worker_threads = 2)]` where a test needs no runtime of its own, and one `dial(port, hash)` | none: the same claims, each test's doc comment kept | ~−200 test | 1 |
| S12 | **`recycle` and `resume` retire a session in the same lines** (a new epoch, no asks in flight, the old session closed) and re-ask what is owed in the same loop. | `client/transport/downloader.js:329-333,340-351` | merge: one `retire()` and one `reaskOwed()` | none | ~−3 | 1 |
| S13 | **A decoder's `failed` answer repeats `onDone`.** | `client/transport/downloader.js:425-430` against `363-367` | simplify: fail the frame, then `onDone(d)` | none | ~−3 | 1 |
| S14 | **"Reject every waiter" written twice** in the consumer. | `client/transport/consumer.js:137-143,165-170` | merge | none | ~−3 | 1 |
| S15 | **"Take a waiter" (clear its timer, delete it) written three times** in the session. | `client/transport/ts/frame-session.ts:148-151,166-168,221-224` | merge: `#takeWaiter(index)` | none | ~−6 | 1 |
| S16 | **The WebTransport carrier declares its fields by hand**, where the WebSocket carrier uses parameter properties; both test `dialMs` before `settleWithin`. | `client/transport/ts/session.ts:21-32,43-45`; `ws-session.ts:35` | simplify: parameter properties; `settleWithin` passes `ready` through when `ms` is unset | none | ~−8 | 1 |
| S17 | **The total-time harness's protocol sits in the product page**: its `hello` POST, its result's shape and a SHA-256 of every frame. | `client/viewer/viewer.js:124-125,238,254-266` | move to lab: `lab/viewer/levers.js` returns `started()` and `finished(result)` hooks, which the page calls when `lab` has them, as `check-page.js` is loaded on `?check=` | none: the harness keeps its protocol; it must be run once to show it (the gate does not run it) | ~−14 product | 2 |
| S18 | **`cubic-classify` was measured and not adopted**, "in both readings"; DELAYCUT, the only row waiting on it, does not start. No open measurement and no device plan names it. | `server/src/transport/classify.rs` (174 lines, ~70 of them tests); `tuning.rs:22-23,45,55`; `server/README.md:128,139`; `docs/transport/transport-conclusions.md` §1 *Measured: CLASSIFY* ("stays a lab flag") | **remove**, a tag keeping it, `lab/cc-classify` retired with it. The measurement's own text keeps it as a flag, so this is the owner's word first | a lab lever with a recorded verdict; no product capability | ~−185 server, a `Congestion` variant | 2 |
| S19 | **The ring parks on an eventfd**, which costs an fd a session, three `unsafe` blocks and a read per park. Parking on the ring's own fd measured a tie on CPU and latency everywhere (`x14`); the ADR counts ~30 lines and 2 `unsafe` fewer. | `server/src/media/uring_reader.rs:39-57,90-109`; `docs/adr/disk-access.md` §5 row `x14`, §9 #7 | simplify, as the ADR proposes; it orders it after P0 (the ring validated on the target), which has no row. Since row 231 the deploy image runs the ring, so the owner may take it now | none | ~−30, −2 `unsafe`, −1 fd a session | 3 |
| S20 | **`impl UringReader` split in two** for one test seam. | `server/src/media/uring_reader.rs:134-142` | merge into the first block (with S19) | none | −3 | 1 |
| S21 | **The lab's harness pages live in `client/`.** `client/harness/` (at `0ee0c1f2`; `lab/harness/` since row 264) (`cell.html`, `index.html`, `shell.js`, ~400 lines) is served by the dev host at `/harness/`, never by the image. | `server/dev-server.py:43-45`; `deploy/web-files.sh:9-14`; `deploy/check_equivalence.sh:66-67` | move to a new lab/harness/, the dev host's route repointed; `client/` then holds the product and its checks alone | none | ~0 saved, ~400 moved | 3 |
| S22 | **`Congestion::as_str` repeats clap's value names.** | `server/src/transport/tuning.rs:49-57` | simplify: `to_possible_value()`; after #48, which rewrites `tuning.rs` | none | ~−8 | 1 |
| — | four congestion-controller wrappers forward the same nine methods to `inner` | `restart.rs:64-145`; `loss_bound.rs:102-160`; `classify.rs:36-79`; `cc_trace.rs:125-195` | keep: a delegating macro saves ~60 lines but is one more thing a reader must expand; three wrappers after S18 | — | — | — |
| — | the read path's two readers in one 1 073-line file | `server/src/media/read_path.rs` | keep: 503 product lines, each reader under 300, the ADR names them together | — | — | — |
| — | the server's workspace build copies the WASM client and four lab crates into the image's build stage | `deploy/Containerfile:16-27` | keep: the root workspace lists them; a lab workspace of its own would need a second lockfile and a copy of `[patch.crates-io]`. Row 228 removes the WASM lines if the owner moves it (*corrected 2026-10-16:* he keeps it, so they stay) | — | — | — |

No `TODO`, `FIXME` or `#[ignore]` is in the product, and one `#[allow(dead_code)]`, row 209's cache behind its feature; no client export but S2's is
imported by nothing (a search over `client/`, `lab/`, `scripts/`, `ingest/` and `deploy/`). The docs agree with the
code wherever this round checked them: rows 218, 224 and 225 corrected what their changes touched. *Corrected
2026-10-17:* this round said `CLAUDE.md` §Docs names "docs/disk-access/adr.md §2"; it names
[`adr/disk-access.md`](adr/disk-access.md), which resolves.

### What the open decisions hold

Not proposed here; counted so the owner sees what each ruling frees.

| decision | what it holds | lines |
| --- | --- | --- |
| #48 (row 227, D1–D8) | the duplication round 1 found, already written | −84 net |
| row 228 (D9, P6) | the WASM transport and the dav1d-WASM tooling; the gate's wasm-pack, wasm32 target and binaryen. *Corrected 2026-10-16:* both stay, a product path (row 263) | ~780 and ~550 moved |
| row 220 (#41) | the repeated-Initial reply: its flag, patch and tests | ~−270 |
| `bbr-bound` (§Blocked, row 107) | `loss_bound.rs` | ~−265 |
| row 209's `FrameCache` (off by default, "for now") | `lab_frame_cache.rs`, its feature and `pipeline.rs:77-98` | ~−100 |
| `readMin` (H3) | the BYOB read path | ~−60 |
| `startOnNeed`, `mixed` (H3) | the lazy decoder pool; AV1's split decode | ~−30, ~−15 |
| R4 (ARCHITECTURE §Open) | the server's module layout, moves and renames only | 0 |

### The comment budget

`scripts/comment_budget.sh` passes; no product file is over 0.18. Nearest the line (comment lines, and the file's
budget used): `client/transport/ts/ws-session.ts` 10 (100 % of its floor), `client/decode/av1.js` 10 (99 %),
`client/decode/av1-frame.js` 13 (96 %), `client/decode/htj2k.js` 10 (96 %), `server/src/record/path.rs` 27 (94 %; at `0ee0c1f2`, now `lab/server-telemetry/`),
`client/record/types.ts` 26 (93 %; at `0ee0c1f2`, now `lab/client-telemetry/`), `server/src/media/frame_pool.rs` 9 (90 %), `client/transport/consumer.js` 27
(90 %). Each comment read there is a contract, a unit or a pointer; none is cut by this round. The next comment any
of them gains must displace one.

### The longest files and functions

| where | lines | what would split it |
| --- | --- | --- |
| `server/src/transport/server.rs` | 2 277 (440 product) | S11 (tests −200); S9 |
| `client/contract/dispatch-rig.ts` | 2 362, ~60 clauses | by subject (dispatch, survival, exactness, AV1) into four files; nothing saved, so no row unless the owner wants it |
| `server/src/media/read_path.rs` | 1 073 (503 product) | keep (above) |
| `client/transport/downloader.js` | 577 | keep: one worker's state; S12, S13 trim it |
| `client/transport/wasm/src/session.rs` `connect` | 109 | *split by row 265 (WASMSURFACE)* into `dial` and three readers, 58 lines |
| `server/src/transport/server.rs` `run_server` | 93 | S9 |
| `client/decode/av1-payload.js` `sequence` | 75 | keep: an OBU header parser, field by field as the spec reads |
| `client/decode/av1-webcodecs.js` `decoder` | 70 | keep: one closure's state machine |
| `client/transport/downloader.js` `onmessage` | 59 | keep: one branch a message kind |
| `server/src/transport/server.rs` `handle_incoming`, `build_endpoint` | 48, 45 | S10 |

### Improvements a measurement backs that the code does not use

* **Parking the ring on its own fd** (S19): a measured tie, ~30 lines and 2 `unsafe` fewer, one fd a session. The
  only one that is also a simplification.
* **PGO** (`scripts/pgo_build.sh`): −13 to −20 % server CPU per ask, no cell against (TC §4); the image is built
  without it. Measured on the lab host, not on the image at the target's rates: `levers.md` §Proposed rows 3
  (PGOSHIP) is the measurement first. Not a build row.
* **`MALLOC_MMAP_THRESHOLD_` at 1 MiB**: RSS at rest −46 to −57 %, CPU a tie to +5 % (disk-access §8, row 51); a
  trade-off left with the owner and in no §Blocked line. For the owner, not a row.
* Every other lever `docs/levers.md` lists as measured and won is the default already, or is one of the open
  decisions above.

### Rows to queue (239 on)

Ranked by lines saved per risk (the findings' risk column; a row that waits on the owner counts as risk 2). Each ends
as a draft pull request into `claude/av1-unified-mainbase`, gate and CI green, every test it adds or rewrites mutated
once; none touches what #48, row 228 or row 220 holds. **Buildable today without the owner:** 239, 241, 242 and 243,
which can run at once — 239 and 241 both edit `server.rs`, 239 below its `mod tests {` and 241 above it, so whichever
lands second merges — and 245 once its lab run fits the day. 240 waits on the owner's word; 244 and 246 are proposals.

| row | name | findings | lines | lines ÷ risk | structural | starts |
| --- | --- | --- | --- | --- | --- | --- |
| 239 | SERVERTESTKIT | S11, S7 | ~−200, +30 (tests) | 170 | no | today |
| 240 | CLASSIFYOUT | S18 | ~−185 | 92 | no | on the owner's word |
| 241 | SERVERSTART | S8, S9, S10, S1 | ~−50 | 50 | no | today |
| 242 | CLIENTDEDUP | S12–S16 | ~−23 | 23 | no | today |
| 243 | LEFTOVERS | S2–S6 | ~−15 | 15 | no | today |
| 244 | RINGPARK | S19, S20 | ~−33 | 11 | **yes: proposal** | the proposal today |
| 245 | VIEWERLABOUT | S17 | ~−14 (product) | 7 | no | today, with one lab run |
| 246 | HARNESSTOLAB | S21 | 0 (~400 moved) | 0 | **yes: proposal** | the proposal today |

S22 waits on #48 and joins whichever row next touches `tuning.rs` after it.

#### 239 SERVERTESTKIT

*Review; tests only.* S11: `server/src/transport/server.rs`'s tests share one `Fixture` (temp dir, series, dev
certificate, a port free for both protocols as row 219 takes it; the dir removed on drop),
`#[tokio::test(flavor = "multi_thread", worker_threads = 2)]` wherever a test needs no runtime of its own (those
racing a server's panic keep theirs), one client-endpoint builder and one `dial(port, hash)` in place of the three
retry loops beside `connect_session`'s; `uring_reader.rs`'s five runtimes likewise. Every test keeps its name, its doc
comment and its assertions; the count of tests run is the same before and after (say both). S7: add the test round
1's L7 asked for — under `--send-window-follows-cwnd` a client that reads nothing is sent no more than the send
window allows (quinn has no getter for it, so the test observes the bytes) — and mutate it by dropping
`link.rs:83`'s `set_send_window`; if no observation is reliable on loopback, the pull request says so rather than
adding a flaky test. Mutate three rewritten tests too (break the code each covers, watch it fail, restore).
**Branch:** `claude/wip-239-SERVERTESTKIT`, then a draft PR.

#### 240 CLASSIFYOUT

*Review; the owner's word first.* S18: `--congestion cubic-classify` was measured (row 212) and is not the default
"in both readings"; DELAYCUT, the only row that waited on it, does not start, and no device plan names it. Remove
`classify.rs`, its `Congestion` variant, its lines in `server/README.md`, and retire `lab/cc-classify/` (a tag
keeps all of it; TC §1 *Measured: CLASSIFY* says where). ~−185 server lines and one controller fewer. Ask before
building: the measurement's own text kept it "a lab flag", and the draft simplification rules (above) are not
adopted. **Branch:** `claude/wip-240-CLASSIFYOUT`, then a draft PR.

#### 241 SERVERSTART

*Review.* S8: `ServeConfig` derives `clap::Args` and `main.rs` flattens it, so the flags, their defaults and their
help live once; `install_crypto_provider` inlined. `series-server --help` before and after, diffed in the pull
request, shows the command line unchanged (help text may move, no flag may). S9: `run_server` split so the banner and
the lab levers' warnings are functions of their own, every banner line unchanged (the harnesses, `run_wire.sh` and
row 232's counts read them). S10: `build_endpoint` tries an ordered list of bind configs.
`server/README.md` §Start-up in step (`ServeConfig` is what is flattened now). S1 (round 1's B5): the banner's
`wt_url` and `ws_url` name the address `--bind` gives when it is a specific one, `127.0.0.1` otherwise, with a test
(mutate: print `127.0.0.1` again). Touches the two lines #48 edits in `main.rs`: whichever lands second merges.
**Branch:** `claude/wip-241-SERVERSTART`, then a draft PR.

#### 242 CLIENTDEDUP

*Review.* S12–S16, each a merge of logic written twice or thrice, no behaviour changed: `recycle` and `resume`'s
common retirement and re-ask in the downloader; a decoder's `failed` answer through `onDone`; one
reject-every-waiter in the consumer; `#takeWaiter` in `FrameSession`; parameter properties in `session.ts` and an
optional `ms` in `settleWithin`. The contract clauses, `downloader.test.mjs`, the dispatch rig and the viewer check
cover each path; the pull request names the test that fails for each when the merged helper is broken on purpose (one
mutation each). **Branch:** `claude/wip-242-CLIENTDEDUP`, then a draft PR.

#### 243 LEFTOVERS

*Review.* What round 1 found and no row took, client and gate side: S2 (the painter's unused `workerUrl`, and the
`export` on `placement`, `FUNCTIONS` and `PHOTOMETRIC`), S3 (`client/dev-transport.json.example` removed), S4
(`lab/telemetry-cost/cost.mjs` built by the lab, not by `client/transport/ts/build.sh`;
`lab/telemetry-cost/README.md`'s run lines say how), S5 (`build.sh`'s ten `npx esbuild` lines through one function,
the `--product` early exit kept) and S6 (`scripts/gate.sh:194` requires the decoder builds alone for
`check_equivalence.sh --local`; say in the pull request which hosts now run the step). No capability is lost: each
removed name has no reader, which the pull request shows with the search. Proof: the gate green with the same skips
or fewer. Row 232 also edits `scripts/gate.sh`: whichever lands second merges. **Branch:** `claude/wip-243-LEFTOVERS`, then a draft PR.

#### 244 RINGPARK

*Proposal (structural): written first, built on the owner's yes.* S19: the tile reader's ring parks on its own fd,
the eventfd and its `unsafe` blocks removed, as `docs/adr/disk-access.md` §9 #7 proposes on a measured tie
(`x14`: CPU and latency, 1 fd a session instead of 2); S20 folded in. The ADR orders it after P0 (the ring
validated on the target), which has no row; since row 231 the deploy image runs the ring. The proposal says which
of the ADR's invariants the change touches (`COOP_TASKRUN`, the non-`_async` registration, `drain_in_flight`), which
read-path tests cover each, and how `x14`'s tie would be re-shown (`lab/disk-access-bench`, arms interleaved).
**Deliverable:** the proposal in `docs/adr/disk-access.md` §9 #7. **Branch:** `claude/wip-244-RINGPARK`, then a
draft PR.

#### 245 VIEWERLABOUT

*Review.* S17: the total-time harness's `hello`, result shape and per-frame SHA-256 leave `client/viewer/viewer.js`
for `lab/viewer/levers.js`, which hands the page `started()` and `finished(result)` when `?post=` is given; the page
calls them only when present. The product page loses ~14 lines and a SHA-256 path it never uses. The gate does not
run the harness: run `lab/av1/delivery/total-time/run.mjs` once on the gate's grey series, before and after, and show
the same result fields; the viewer check and `crafted.mjs` stay green. **Branch:** `claude/wip-245-VIEWERLABOUT`,
then a draft PR.

#### 246 HARNESSTOLAB

*Proposal (structural): written first, moved on the owner's yes.* S21 (moved by row 264, after `2b4dc9b`): `client/harness/` to a new lab/harness/, the
dev host's `/harness/` route repointed, the paths in `docs/` and `lab/` with it; `client/` then holds the product and
its checks alone, and `check_equivalence.sh`'s hidden-path list shrinks. Nothing is saved; a reader of `client/`
holds three files fewer. **Deliverable:** the proposal in `docs/CLIENTS.md` beside row 228's. **Branch:**
`claude/wip-246-HARNESSTOLAB`, then a draft PR.

## Third round

*2026-10-16. Queue row 266, THIRDAUDIT, at `a9fd5bd6`: after #67 (rows 229–249), #73 (row 250) and #70. An audit:
nothing was built, run or timed but `scripts/comment_budget.sh` and `scripts/check_links.py` (both pass) and searches.*
The owner asked for the night to go to performance, resources, simplicity, robustness and readability. Row 251 read
the disk readers ([`adr/disk-access.md`](adr/disk-access.md) §9 *Next round for the readers*, draft #72); this round
reads the rest the same way: `server/src/transport/` (planner, pipeline, server, link, WebSocket, congestion),
`server/src/main.rs`, the TypeScript transport and `client/transport/downloader.js`, the viewer's product path
(`client/viewer/`, `consumer.js`, the decoder and painter as the page drives them), `common/`, `ingest/` and `deploy/`.
Out of scope, as the brief says: the disk readers (row 251), the WASM client's gaps (row 263, #76), lab code's
placement (row 264), and the owner's open decisions (#39, #40, #41, #48, row 252's lab flag in #75).

**The answer, in short.** Rounds 1 and 2 left little to cut, and this round cuts little (two lines). What it finds is
robustness, and none of it is reached by a test: a page whose downloader cannot load waits for ever; an open page
cannot resume across a server restart, because the deploy mints a new pinned certificate at each start and the
downloader re-dials with the old hash; SIGTERM drops every session without a close; a WebSocket peer that vanishes
holds its session for ever, and the WebSocket accept loop spins when descriptors run out; a pack that fails
mid-write leaves a bundle behind while both ingests say "nothing written". One documented behaviour, a client's
`frame_error` being ignored, has no test. Three docs no longer matched the code and are corrected in place. Rows
267–273 are drafted; five can start today.

### Findings

Each finding: where, the verdict (*do*, *measure*, *propose*, *keep*), the capability it costs (none, for every
verdict but *keep*), product lines by a sketch (tests apart), and whether it is structural. Risk as in round 2: 1 is
a change the gate's tests cover, 2 needs a check the gate does not run, 3 is structural. Ranked by gain per risk.

| # | finding (where) | verdict · capability · lines | structural · risk |
| --- | --- | --- | --- |
| T1 | **A page whose downloader cannot start waits for ever.** `DownloaderClient` makes its worker with no `onerror` (`client/transport/consumer.js:38-39`). A worker script that fails to load (a 404 from a half-upgraded host, a policy refusal, a syntax error) fires `error` on the page's `Worker` and nothing else, so `connect` awaits `#ready` for ever (`:67`) and the viewer's status line stays at "loading…". The decoders' and the painter's workers handle theirs (`downloader.js:426`, `paint/painter.js:16`). `consumer.test.mjs` never fails a worker. | **do**: `onerror` rejects `#ready` while not `started`, and changes nothing after · none · +4, test +12 | no · 1 |
| T2 | **The control-message cap is 4 MiB for messages under 60 bytes.** `MAX_FOD_LEN` (`server/src/transport/wire.rs:9`) bounds a FoD message on QUIC and, as tungstenite's `max_message_size`, on the WebSocket (`websocket.rs:121`). The longest message a client sends is `stream_frames` with two `u32`s, 56 B, so a session may make the server buffer 4 MiB a message for nothing, on either transport. | **do**: 64 KiB, [`WIRE.md`](WIRE.md) §FoD messages and §The WebSocket mapping with it · none · ±0 | no · 1 |
| T3 | **A client's `frame_error` is ignored, and no test says so.** `forward` drops it (`server/src/transport/server.rs:393`) and [`WIRE.md`](WIRE.md) §FoD messages documents it; a mutation that ends the session on it, or forwards it as an ask that ends a fill, passes every test. | **do**: a test of `forward` (`Continue`, nothing sent), mutated both ways · none · test +10 | no · 1 |
| T4 | **A failed pack leaves a bundle where both ingests say "nothing written".** `BundleWriter` writes to the final name (`common/series-bundle/src/writer.rs:28`), as [`disk-layout/README.md`](disk-layout/README.md) §The writer records. `from-parser` prints "nothing written" on any error, a failed write included (`ingest/from-parser/src/main.rs:75`); `from_dicom.py` writes the sidecar before it packs (`ingest/from-dicom/from_dicom.py:58-60`), so a failed pack leaves both files. A server that has the old bundle open also reads the rewrite in place under its index. | **do**: write `NAME.partial` and rename in `finish`; the sidecar written after the pack · none · +5; disk-layout §The writer corrected when it lands | no · 1 |
| T5 | **SIGTERM drops every session without a close.** `main` returns from its `select!` (`server/src/main.rs:24-34`) and the runtime ends with the endpoint's driver, so no `CONNECTION_CLOSE` is sent. A client learns of it from silence: `stallMs` (3 s) when owed frames, the idle timeout when not. wtransport has `Endpoint::close` and `wait_idle`. Derived from the code, not traced. | **do**: `run_server` takes the shutdown future, closes the endpoint with an application code, waits ≤ 500 ms · none · ~+8 | no · 2: deploy/README's `stop` under a second must be shown again |
| T6 | **An open page cannot resume across a server restart.** The deploy makes a new certificate at each start (`deploy/server-start.sh:13-17`), restarts every `RESTART_AFTER` (`:22`, 9 days) and on any `compose restart` or upgrade. The downloader keeps the hash it first dialled with (`downloader.js:538`) and every re-dial pins it (`:466-472`), so each of `tries` fails its handshake and every owed frame fails as "could not be re-dialled" (`:373-375`). A filled page keeps its frames; an on-demand page, or one mid-fill, loses the rest. [`deploy/README.md`](../deploy/README.md) §*Restart* checked only "the next page open". A certificate from `/supplied` (no hash) is not affected. Derived from the code, not observed. | **propose**: the downloader takes the transport file's URL (`transportFile`, a string, so it crosses `postMessage`) and re-reads it before each re-dial; the viewer passes `/wt/dev-transport.json` outside the lab · none · ~+8 | **yes**: a consumer option ([`CLIENTS.md`](CLIENTS.md)) · 3 |
| T7 | **A WebSocket peer that vanishes holds its session for ever.** After the upgrade nothing bounds a silent peer: no read deadline (`websocket.rs:158-168`), no TCP keep-alive (`:111` sets only `TCP_NODELAY`). A laptop that sleeps or a NAT that forgets keeps the session's task, its readers, its ring and their buffers until the process ends. QUIC's idle timeout ends the same peer at 30 s; a live but idle browser tab keeps both (Chromium keeps QUIC alive, [`adr/transport-idle-sessions.md`](adr/transport-idle-sessions.md)). Off by default (`--websocket`). | **do**: TCP keep-alive on the accepted socket (`socket2`, already in `Cargo.lock`), 20 s idle, 5 s × 4 probes; the dead peer's read then fails and the session ends as any failed read does · none · +4 | no · 2: the test reads the options back; the kernel's expiry is not observed |
| T8 | **The WebSocket accept loop spins when descriptors run out.** An accept error is logged and retried at once (`websocket.rs:94-99`); `EMFILE` leaves the connection in the backlog, so the next accept fails the same way: a core at 100 % and a WARN a microsecond until a descriptor frees. Off by default. | **do**: sleep 100 ms after an accept error · none · +1 | no · 2: shown under `prlimit --nofile`, outside the gate |
| T9 | **Every ask takes the connection's lock for a debug line that is off.** `send_frame` reads `stats()` before `debug!` (`server/src/transport/link.rs:77-80`); tracing evaluates a field only when its level is on, so inside the macro the read costs nothing in a deployment. `lab/ask-ahead/cells.py:103` reads the line, unchanged. | **do** · none · −2; the cost is below any noise floor here, not measured | no · 1 |
| T10 | **The product page polls at 50 Hz for a result nobody reads.** `filled` (`client/viewer/viewer.js:241-251`) checks every 20 ms until the fill ends, and for ever if it never does; what waits on it is `check-page.js`, loaded on `?check=` alone, and the lab's `finished` hook, which the web image refuses: a product open uses neither. | **do**: poll only with `?check=` or a lab hook · none · +1 | no · 1 |
| T11 | **The page keeps every decoded frame, and where that fails is not known.** `frames` holds each frame's pixels for the page's life (`viewer.js:30`, `:97`): `ffdm_d`'s four 3328×4096 frames are 109 MB decoded, a 2 000-frame 512² CT 1 GB. The cache seam that would bound it is open ([`ARCHITECTURE.md`](ARCHITECTURE.md) §Open); no doc says at what size the page fails. | **measure** (protocol under row 273; measured 2026-10-16: no page ceiling below the host's, §273) · none · 0 | no · — |

**Kept**, with the reason:

* `deploy/Containerfile.prebuilt:5-13` repeats the `server` stage (`deploy/Containerfile:39-48`): two build
  contexts, and a shared base stage would need one. Six lines; the user and directory line is the one to keep equal.
* A stream whose `envelope_len` is out of bounds stops being read silently (`client/transport/ts/frame-session.ts:210-212`):
  the bytes are the server's, a bundle refuses such a frame at open, and the stall resumes the session in 3 s.
  `ws-session.ts:48` parses the server's JSON unguarded for the same reason.
* `nextRun`'s `Math.min(...wanted)` (`downloader.js:275`): `wanted` is at most the series' frame count, far below
  an engine's argument limit, and the scan is once a run.
* `ASKS_AHEAD` (`planner.rs:6`) counts what the planner holds; the server holds up to twice that and one, which
  [`adr/frame-framing-and-loop-shape.md`](adr/frame-framing-and-loop-shape.md) §6d states.
* Round 2's keeps hold: the four delegating controllers, the dual-stack bind written twice, `read_path.rs` whole.

**Docs the code no longer matched**, corrected in place by this row, dated:

* `server/README.md` §What runs where said no task ever waits on the disk. Two do, neither timed: a session ending
  with ring reads in flight drains them on its worker (`TileReader::drop`, a `SAFETY` necessity), and a fill's
  `WILLNEED` is issued there. Row 251's EXECGAP (its row 258) is drafted to time both.
* [`disk-layout/README.md`](disk-layout/README.md) cited `main.rs:12–13` for `--series` and `server.rs:72` for the
  open (row 241 moved both), and four lines of §The metadata, twice had drifted.
* [`ingest/design.md`](ingest/design.md) §11.1's two `from-parser` ranges were one to three lines off.

**Round 2, where it stands.** Rows 239, 241, 242, 243 and 245 merged with #67; 244's proposal was built by row 250
(#73); 246's proposal merged and the move waits on the owner; 240 (CLASSIFYOUT) waits on the owner, beside #40,
which proposes the opposite (`cubic-classify` as the default); S22 waits on #48. Round 2's counts are of `0ee0c1f2`:
`server.rs` is now 1 984 lines, 404 above its tests. *Corrected 2026-10-17:* round 2 said `CLAUDE.md` §Docs still
names `docs/disk-access/adr.md` §2; it names `adr/disk-access.md`, which resolves.

**The comment budget** passes; every file in scope is inside it. The rows below touch `consumer.js` (27 comment
lines of 29), `websocket.rs` (12 of 25) and `link.rs` (19 of 32); none needs a comment beyond a pointer.

### Improvements a measurement backs that the code does not use

Unchanged since round 2: PGO (−13 to −20 % server CPU per ask, PGOSHIP first), `MALLOC_MMAP_THRESHOLD_` at 1 MiB
(RSS at rest −46 to −57 %, CPU a tie to +5 %) and the server keep-alive (the ADR, off until accepted): each the
owner's ([`levers.md`](levers.md)). This round found none in its scope.

### Rows to queue (267 on)

Ranked by gain per risk. Each ends as a draft pull request into `claude/av1-unified-mainbase`, gate and CI green,
every test it adds mutated once. **Buildable today:** 267, 268, 269, 270 (its `stop` timing once the host is free)
and 272. 271 is a proposal and follows 270; 273 is a measurement for a free host. 268 and 270 edit `server.rs` and
`main.rs`, which #75 (row 252) also edits: whichever lands second merges.

| row | name | findings | lines | gain | structural | starts |
| --- | --- | --- | --- | --- | --- | --- |
| 267 | PAGESTART | T1, T10 | +5, test +12 | a page that cannot start says why; no idle timer | no | today |
| 268 | WIREEDGES | T2, T3, T9 | −2, test +10 | ×64 less a hostile message can hold; a documented rule tested | no | today |
| 269 | PACKATOMIC | T4 | +5, test +10 | "nothing written" true; a served bundle never rewritten in place | no | today |
| 270 | SERVERSTOP | T5 | +8, test +25 | clients see a restart at once | no | today; the timing when the host is free |
| 271 | RESTARTPIN | T6 | ~+8 | open pages survive a restart | **yes: proposal** | after 270 |
| 272 | WSLIVENESS | T7, T8 | +5, test +15 | the fallback's dead peers and EMFILE bounded | no | today |
| 273 | VIEWERCEILING | T11 | 0 | where the page fails, stated: not below 8 GiB decoded on the dev host; nothing built | no | measured 2026-10-16 |

#### 267 PAGESTART

*Review.* T1: `DownloaderClient`'s worker gets an `onerror` that, before `started`, rejects `connect` with "the
downloader did not start: …" and ends the client as a failed start does; after `started` it does nothing new. A
`consumer.test.mjs` case whose fake `Worker` fires `onerror` instead of answering `dial` expects the rejection within
a second (the test races a timer, so the mutation fails rather than hangs); mutate by removing the handler. T10:
`viewer.js`'s `filled` poll runs only under `?check=` or when the lab hands a `finished` hook; the viewer check,
`crafted.mjs` and one total-time run (`lab/av1/delivery/total-time/run.mjs`, the gate's grey series) show both
users unchanged. **Branch:** `claude/wip-267-PAGESTART`.

#### 268 WIREEDGES

*Review.* T2: `MAX_FOD_LEN` 64 KiB, `wire.rs`'s test unchanged in shape; `WIRE.md` §FoD messages and §The WebSocket
mapping say 64 KiB, and `adr/telemetry-server-pipeline.md`'s "capped at 4 MiB" gets a dated note. Show that the
longest real message, `stream_frames` with both ends at `u32::MAX`, still parses. T3: a test of `forward` with a
client `FrameError`: `Continue`, nothing on the channel; mutate to `Break`, then to `Command::EndStream`, each must
fail. T9: the `stats()` read moves into the `debug!` fields; `lab/ask-ahead/cells.py`'s pattern matches a server
run with `RUST_LOG=series_server=debug` (untimed). **Branch:** `claude/wip-268-WIREEDGES`.

#### 269 PACKATOMIC

*Review.* T4: `BundleWriter::create` opens `NAME.partial`; `finish` flushes and renames over `NAME`; a writer dropped
unfinished removes its partial. `from_dicom.py` writes the sidecar to its temporary directory and moves it beside
the bundle after `pack-series` succeeds. Tests: a writer that fails (a frame of the wrong length) leaves no file at
`NAME`, and one that finishes leaves no `.partial`; mutate by creating at `NAME`. `disk-layout/README.md` §The writer
is corrected in the same pull request; the gate's `cmp` of the re-packed smoke bundle still passes. **Branch:**
`claude/wip-269-PACKATOMIC`.

#### 270 SERVERSTOP

*Review.* T5: `run_server(config, shutdown)`; on `shutdown` the endpoint is closed with an application code and the
server waits for `wait_idle` up to 250 ms (500 ms halved by the rule below); telemetry's flush keeps its place. Test: a server-test session open when
shutdown fires sees `closed` with that code (mutate: skip the close; the session then sees only a timeout). The
WebSocket needs nothing: process exit closes its sockets.

*The protocol, fixed before the data* (deploy/README fix 2 says `stop` takes under a second, so there is no
`init: true`): arms S0 (today's image), S0′ (a second build of it, the A/A arm) and S1; one Chromium page on the
image filling a series of at least 200 frames under an 18 Mbit/s shape, so the fill outlasts the stop; then
`docker compose stop server`, timed; 10 rounds, arms in `lab/scripts/order.py`'s order. *Rule:* S1 lands if every
S1 stop is under 1 s and the page's session closed with the server's code in 10 of 10 (its `closed` reason); a stop
of 1 s or more halves the bound and the row runs once more; still over, the owner chooses between the bound and
`init: true`. *Result (2026-10-17):* at 250 ms every S1 stop is under 1 s on a free host, 20 of 20 (713–820 ms);
the one stop over it before was docker's under the host's load, not the server's, whose share is 253–269 ms in 70
stops (deploy/README fix 2). The close's code cannot be read from a page (same place). **Branch:**
`claude/wip-270-SERVERSTOP`.

#### 271 RESTARTPIN

*Proposal (structural): written first, built on the owner's yes, after 270.* T6: the consumer takes
`transportFile`, a URL the downloader re-reads (`cache: "no-store"`) before each re-dial and adopts when its hash or
URL changed; the viewer passes `/wt/dev-transport.json` unless the lab named `?wt=`. The proposal says what the
contract suite adds (a re-dial after the hash changed connects), what `docs/CLIENTS.md` §The seam gains, why the
transport file is the source and the page is not asked (a worker cannot call back into the page), and how it is
shown on the image: the viewer check with `?fill=0`, `compose restart server` between two steps, the second step
exact. **Deliverable:** the proposal in `docs/ARCHITECTURE.md` §The downloader. **Branch:**
`claude/wip-271-RESTARTPIN`.
*Written 2026-10-16:* the proposal in [`ARCHITECTURE.md`](ARCHITECTURE.md) §The downloader. *Built 2026-10-17, on
the owner's yes, ahead of 270:* §The downloader, *An open page follows a server restart*. The viewer check across
`compose restart server` on the image **fails by name before** ("frame 1 unavailable: the session was lost and could
not be re-dialled") and **passes after** (`received 2, exact 2`, no error), one run each; the new rig clause passes
7/7 over each client and fails 0/7 with the read skipped; `anEmptyHashDialsUnpinned` fails on either client whose
session keeps its first hash.

#### 272 WSLIVENESS

*Review.* T7: the accepted socket gets TCP keep-alive (idle 20 s, interval 5 s, 4 probes) through `socket2`; a test
reads the three options back from an accepted socket (mutate: drop the call). That a vanished peer then ends at
about 40 s is the kernel's and is said, not tested. T8: an accept error sleeps 100 ms; shown once by a script that
runs the server with `--websocket` under `prlimit --nofile=64`, opens 80 connections and counts WARN lines in one
second (today unbounded, after it ≤ 10); mutate by removing the sleep. `docs/WIRE.md` §The WebSocket mapping says
how a dead peer ends. **Branch:** `claude/wip-272-WSLIVENESS`.

#### 273 VIEWERCEILING

*Measurement, for a free host.* T11. *Series:* synthetic 16-bit grey, 512², 2048² and 3328×4096, of 64 frames
doubling until a fill fails or 4 096 frames. *Engines:* Chromium 141 and Firefox 157 headless, the dev host, fill
mode. *Metric:* whether the fill completes (the status line's received count), and the page's memory
(`performance.measureUserAgentSpecificMemory()`, which a cross-origin-isolated page has) at the end of the fill; 3
rounds a cell. The host's RAM is printed, and nothing is claimed past it. *Rule:* the ceiling is the largest decoded
series (frames × width × height × 2 B) that completes 3 of 3, per engine; if it is below the largest series
[`FIXTURES.md`](FIXTURES.md) names, at its decoded size, the cache seam (ARCHITECTURE §Open) becomes a proposal with
that series as its case; otherwise §Open records the ceiling and nothing is built. **Branch:**
`claude/wip-273-VIEWERCEILING`.

*Result, 2026-10-16* (`lab/viewer-ceiling/run.mjs`; raw rows in the session's scratchpad, not committed). **The
host.** 4 cores, 16 093 MiB RAM, no swap. The run's processes sit in a memory cgroup that allows 13 679 MiB, which
is the binding limit. The harness skips a cell whose decoded size is over that limit. It stops a round when the
cgroup's headroom falls under 1.5 GiB, and that round's outcome is *host saturated*. **The ceiling** is
8 192 MiB decoded (1 024 × 2048²) for both engines. Above it, every cell either did not fit the host or was
stopped by the host. So it is the host's ceiling, and the page's lies somewhere above it.
`dbts_b1` (50 × 2560×3328, 812.5 MiB decoded) is the largest series in [`FIXTURES.md`](FIXTURES.md). It is below
the ceiling, so ARCHITECTURE §Open records the ceiling and nothing is built.

| series | decoded MiB | Chromium 141: fills · UA memory (window · workers) · PSS | Firefox 157.0.1: fills · PSS |
| --- | --- | --- | --- |
| 4 096 × 512² | 2 048 | 3/3 · 2 067 (2 050 · 17) · 2 531 | **2/3** · 2 704 |
| 512 × 2048² | 4 096 | 3/3 · 4 151 (4 096 · 54) · 4 513 | 3/3 · 4 931 |
| 1 024 × 2048² | 8 192 | 3/3 · 8 247 (8 193 · 54) · 8 615 | 3/3 · 9 091 |
| 2 048 × 2048² | 16 384 | not run: above the cgroup | not run |
| 256 × 3328×4096 | 6 656 | 3/3 · 6 800 (6 656 · 144) · 7 207 | 3/3 · 7 576 |
| 512 × 3328×4096 | 13 312 | host saturated 3/3, at 357–364 frames | host saturated 3/3, at 339–344 frames |

Every smaller cell (64 frames on, doubling) filled 3 of 3 in both engines. Engines alternate inside each round.
Medians, MiB. *UA memory* is `performance.measureUserAgentSpecificMemory()` at the end of the fill: the JS and DOM
memory of the page's realms, array buffers included, shared by scope. Firefox 157 has no such API, although its
page is cross-origin isolated. *PSS* is the whole browser's proportional set size at the end of the fill, from
`/proc`, recorded for both engines in its place; at 32 MiB decoded it is 373 (Chromium) and 613 (Firefox). **Where the
protocol bent**, each stated:

* *The series.* 64 distinct frames are cycled, and the decoded size is the same as distinct frames would give.
  The content is `gen_frame_pnm.py`'s field without its grain: about 11:1, so the largest bundle fits this disk.
* *Firefox headless has no WebGL2*, so its page paints nothing: `paint: WebGL2 is not available`. Every frame is
  still received and exact, and its memory leaves out the painter.
* *Firefox's 2/3 at 4 096 × 512²*: one round received no frame in 120 s while its memory stayed at baseline.
  That is not a memory failure, and its cause is not diagnosed. Under the rule it ends Firefox's 512² doubling,
  and it does not move the engine's ceiling. A diagnostic run outside the protocol filled the same cell 8 of 8.
* *512 × 3328×4096 was interrupted, then re-run whole.* The first harness guarded on `MemAvailable` alone, and the
  cgroup's OOM killer took Chromium's renderer at 11.9 GiB anon RSS (435 frames) before the guard fired. Those two
  rows are set aside. The cell was run again in full with the cgroup headroom guard, and that run is the one in
  the table.

## Lab-only code in product directories (row 264)

The owner, 2026-10-16: "things only for lab should live in lab/. If also meant for product usage I would like to
evaluate the results before deciding whether to keep it or not." Queue row 264 (LABONLY), on
`claude/av1-unified-mainbase` at `a9fd5bd6`: every lab thing under `server/`, `client/`, `common/`, `ingest/`,
`deploy/` and `scripts/`, and one pattern for moving the server's. An audit and a proposal. Nothing here is built
except the pattern's first instance, row 264b (CLASSIFYTOLAB), which is on its own branch,
`claude/wip-264b-CLASSIFYTOLAB`.

*Built 2026-10-17, on the owner's word that lab-only code leaves the product path:* O1–O8 and the two closed arms,
in one pull request into unified (§Rows). The candidates C1–C10 stay where they are, as below.

The rule sorts each thing into one of two kinds:

* **Lab only**: no measurement proposes it for the product, or one rejected it. It moves to `lab/`.
* **A candidate**: a protocol or a measurement still proposes it. It stays where it is, off by default, until its
  decision, and is then adopted or removed. It does not move.

Row 266's audit ([§Third round](#third-round)) left lab code's placement to this row. Rounds 1 and 2 found part of this already (L1–L8, S17, S18, S21 above, and rows 228 and 246's proposals in
[`CLIENTS.md`](CLIENTS.md)). Those are pointed to here, not repeated.

**The answer, in short.**
* **Lab only:** eight groups. The server's are cubic-classify (moved, row 264b), the telemetry (~2 400 lines,
  self-contained, and the next to move) and four small levers.
* **Already proposed:** the client's harness pages and the WASM client (rows 246 and 228). Row 246 omits the two
  scripts that check those pages.
* **Ingest:** one lab CLI.
* **Candidates:** ten, each waiting on its named decision.
* **Nothing lab-only** is in `common/` or `deploy/`.

### Lab only

Lines are at `a9fd5bd6`.

| # | item | where | the verdict it rests on | how it moves |
| --- | --- | --- | --- | --- |
| O1 | `--congestion cubic-classify`, `LossClassify` | `server/src/transport/classify.rs` at `a9fd5bd6` (174 lines, 70 of them tests); `tuning.rs:3,22-23,45,55,184`; `transport/mod.rs:4`; `main.rs:70` | not the default "in both readings", "stays a lab flag": [TC §1 *Measured: CLASSIFY*](transport/transport-conclusions.md#measured-classify-2026-10-14). S18 proposes removing it (row 240, on the owner's word). *Found after the move was built:* draft #40 proposes the opposite, `cubic-classify` as the default, a trade-off that waits on row 190's device runs. By the owner's rule, that makes it a candidate as well | **built, row 264b**: the crate `lab/cc-classify`, behind `lab-classify`. If row 240 is taken, the crate goes and nothing in `server/` is left to remove. If #40 is adopted, the crate comes back into `server/` as the default; until then, the flag is one feature away |
| O2 | the telemetry: `server/src/record/` (2 083 lines), `transport/cc_trace.rs` (317), `RecordedPipeline` (`pipeline.rs:166-213`), and 23 `cfg` sites in 7 files; `client/record/` (1 545) | as cited, at `a9fd5bd6` | lab builds only ([`adr/telemetry-server-pipeline.md`](adr/telemetry-server-pipeline.md)). No default binary or bundle has it since row 221 (L1), and both absence checks hold | **by the pattern, as its own structural row.** `record/` names nothing of the server's outside itself, and `cc_trace.rs` names only quinn, so together they become one lab crate, and `telemetry = ["dep:…"]`. `RecordedPipeline` and the tap's call sites stay as the feature's wiring. `client/record/` goes to `lab/` with the bundle that `client/transport/ts/build.sh` makes from it |
| O3 | `--hold-sessions` | `server/src/transport/server.rs:57-59,104-112,241-245` | lab only: a dial that never settles, for the client's dial deadline ([ARCHITECTURE §A dial that never settles](ARCHITECTURE.md#a-dial-that-never-settles)). L7 keeps it as a lever | wiring alone, with no code to hold: the pattern's gate without a crate (below). Its one user is `lab/dial-deadline/run.mjs` |
| O4 | `--stall-after-bytes` | `server.rs:60-62,126,135-137,155`; `link.rs:23-24,85-98` | lab only: WebKit 319818's stall, emulated for `recycleAtBytes` ([ARCHITECTURE §Recycling before the stall](ARCHITECTURE.md#recycling-before-the-stall)) | as O3; one user, `lab/session-survival/recycle_cells.sh` |
| O5 | `--force-pool-reads` | `server.rs:51-53,86-89`; `media/frame_store.rs:162-166` | lab only for the flag; the method is also the read path tests' forced miss (`CLAUDE.md` §Measurement) | the flag as O3; the method stays. Users: `lab/scripts/cold_series.sh`, `fill_order_cells.sh`, `window-harness`'s `fill_order`, and the product's `scripts/perf_counts.mjs`, which would build with the feature |
| O6 | `--segmentation-offload false` | `server/src/transport/tuning.rs:87-90,103,127,159-161` | lab only: netem on the sending host ([`rig-limits.md`](rig-limits.md) §3) | as O3; one user, `lab/scripts/lossy_link_levers.sh` |
| O7 | `scripts/cellcheck.sh`, `scripts/cellcheck.mjs` | as named, at `a9fd5bd6` | lab only: they drive `client/harness/`'s pages | **with row 246**, whose proposal ([CLIENTS §Proposed: the harness pages](CLIENTS.md#proposed-the-harness-pages-to-lab)) moves the pages but leaves these two in `scripts/` |
| O8 | `ingest/coded-frames/ingest.py`'s `main()` | `ingest.py:292-331` | lab only: it codes a fetched set (`import size` from `lab/av1`), and the product's path is `from-dicom/from_dicom.py` → `ingest.coded()` | to a `lab/av1/tools/` script that imports `ingest`, with the lab files that run it repointed (34 name it, 22 of them scripts). `coded()`'s `representation`, `split` and `grey8` stay: they are the arms the lab drives through the product's code, and the product passes the defaults |
| — | `client/harness/` (at `a9fd5bd6`); the WASM client and `client/decode/wasm/dav1d/` | — | rows 246 and 228, proposed | as proposed in [`CLIENTS.md`](CLIENTS.md) |
| — | the viewer's lab parameters | `client/viewer/head.js:1-9` | done: rows 217 and 245 moved them to `lab/viewer/levers.js`, which only a host that serves `lab/` can load. That is the client's pattern, and it fits | — |

### Candidates: they stay until their decision

| # | item | where | the decision, and where it is recorded |
| --- | --- | --- | --- |
| C1 | `--fill-resumes-after-asks` | draft #75 (row 252, ONEQUEUEBUILD), not merged: +278 −52 in 7 files | candidate 1 of [WIRE §Proposed: one queue](WIRE.md#proposed-one-queue-an-ask-moves-its-frame-to-the-front-row-249), whose rule is fixed. Row 253 is measuring it. If it is adopted it becomes the behaviour and `refill`'s client code goes (C3). If not, it is not merged |
| C2 | `--stream-mode per-frame-asks-first` | `server/src/transport/stream_mode.rs:13-14,22,34`; `link.rs:66` | candidate 2 of the same rule. Rows 180 and 211 found a trade-off for the owner |
| C3 | `--send-window-follows-cwnd`; the client's `refill` arms other than `head` | `server.rs:63-66,127,138-144,156`; `link.rs:25-26,81-84`; `client/transport/downloader.js:214-233` | an arm of the same rule; a trade-off since row 171 ([link-conditions §Re-measured, proposed](transport/link-conditions.md#re-measured-proposed)). `refill: "head"` is the default (row 229) |
| C4 | `--reply-repeated-initial` and its 117-line quinn-proto patch | `server/src/transport/tuning.rs:83-86,126,153-155`; `patches/quinn-proto-0.11.18-reply-repeated-initial.patch` | row 220, draft #41: the owner's (H1) |
| C5 | `--congestion bbr-bound` | `server/src/transport/loss_bound.rs` (265) | failed its rule; retiring or keeping it is the owner's call (queue §Blocked, row 107) |
| C6 | `lab-frame-cache` | `server/src/media/lab_frame_cache.rs` (45); `pipeline.rs:77-98`; `server/Cargo.toml:18-19` | row 209: a trade-off for the owner (L8). If adopted, it moves into `server/`. If not, it is removed |
| C7 | `--congestion bbr` as the default; `--initial-window-bytes 38400` | quinn's own, one line each | the owner's: row 75 (§Blocked); row 181 put 38 400 first, opt-in ([link-conditions §Verdicts](transport/link-conditions.md#verdicts-that-rest-on-the-band) item 3) |
| C8 | `startOnNeed`, AV1's `mixed`, `readMin` | `downloader.js:44-45,131-140,452`; `client/decode/av1.js:13,60-70`; `client/transport/ts/frame-session.ts:21,101-105,188-191` | H3: the owner's |
| C9 | `recycleAtBytes` | `downloader.js:198,344-` | a fallback for iOS, off. The device measurement it owes is not run ([ARCHITECTURE §The measurement this owes](ARCHITECTURE.md#the-measurement-this-owes)) |
| C10 | `scripts/pgo_build.sh` | as named | opt-in. Its measurement comes first: [`levers.md`](levers.md) §Proposed rows 3, PGOSHIP |

**These are seams, not the lab's, and they stay:**
* the client's `transport`, `decoderWorker`, `worker`, `survival` overrides and `decode: false`. The contract suite
  drives the product through them (`client/contract/dispatch-rig.ts`, `ask-during-fill.html`).
* `FrameStore::force_short_reads` and `Link::Detached` (`#[cfg(test)]`).
* `pub mod media`, a visibility that the lab benches read.
* `--opening-ask false` and `WTPACS_READ_PATH=pool`, the product's off switches.
* In `deploy/`, the image's build stage copies each lab crate's manifest and sources (`Containerfile:20-27` and the
  two ignore files) because the workspace lists them; round 2 keeps that.
* In `scripts/`, `perf_nightly.mjs` drives the lab's total-time harness to time the product, and `quic_peek.py` and
  `wtcompat.py` check the product's dial: product checks.

### The pattern: a lab crate behind a server feature

*Proposed. Its first instance is built by row 264b.*

1. **The code is a crate in `lab/`**, beside its rig (`lab/<name>/Cargo.toml`, `src/lib.rs`), and depends on no
   product crate. Anything it needs from the server is passed in. `cc-classify` takes the controller it wraps as an
   `Arc<dyn ControllerFactory>`, and the server hands it `cubic-restart`'s.
2. **The server declares `lab-<name> = ["dep:<crate>"]`**, with the crate as an optional path dependency. `server/`
   keeps only the wiring, each line under `#[cfg(feature = "lab-<name>")]`: for O1, one `Congestion` variant and its
   two match arms.
3. **A default build carries none of it, and that is checked.** A unit test shows the flag is refused. The release
   binary's absence check (`server/scripts/check_telemetry_absent.sh`, run by the gate) looks for the crate's symbols
   and the flag's literal.
4. **The gate tests both sides.** It runs the crate's own tests (`cargo test -p <crate>`) and the wiring's tests
   under the feature. A rig builds its server with `--features series-server/lab-<name>`.
5. **The workspace lists the crate** (not in `default-members`). The image's build stage copies its manifest and
   sources, as it does the other lab crates, because Cargo reads an optional dependency's manifest even when the
   feature is off.

Some levers are only wiring, with no code worth a crate (O3–O6). They take the same gate without a crate: one
`lab-levers` feature, and the four rigs that pass them build with it. Together they are about 60 lines that a
deployment's binary would no longer carry. Each flag stays in `--help` only in a lab build. The other way is to keep
them as L7 does. That is the owner's choice.

**The precedent, checked: `lab-frame-cache` fits half.**
* What fits: the feature, off by default; the gate's compile step; and the lab's source living in `lab/`.
* What does not: `server/src/media/lab_frame_cache.rs:5-7` includes `lab/disk-access-bench/src/frame_cache.rs` by
  `#[path]`, not as a crate. The reason is that `disk-access-bench` depends on `series-server`, and Cargo refuses a
  cycle even through an optional dependency (checked: `cargo metadata` fails with "cyclic package dependency").
  Because of the include:
  * the lab's file compiles as a module of each crate, so it can name only what both crates hold;
  * no test of it runs under the server's feature;
  * an `#[allow(dead_code)]` hides what the server does not call.
* So the pattern takes a crate. That costs a `Cargo.toml`, two image lines and two ignore-file lines.
* Where lab code must share a crate that depends on the server, it is split into a crate of its own that both
  depend on. For the frame cache that would be a frame-cache crate in `lab/`. Not proposed: row 209's decision either
  adopts the cache or removes it.

**Not taken:**
* *A hook in the server that a lab binary plugs into*, for example a lab `main` that hands `run_server` its own
  controllers. That gives the product an extension point with one user, and `CLAUDE.md` asks for no speculative
  abstraction.
* *A lab workspace of its own.* It needs a second lockfile and a copy of `[patch.crates-io]`, as round 2 found for
  the image.
* *`#[cfg]` around code left in `server/`.* That is the state today, which the owner's rule asks to end.

### Rows

| row | what | lines in `server/` | starts |
| --- | --- | --- | --- |
| 264b CLASSIFYTOLAB | O1 by the pattern, built at `d41a544d` | `server/src` −179 +32: the product's code +7 −178, the tests +25 −1 | **built**, merged by row 264's pull request, which supersedes #79 |
| TELEMETRYTOLAB | O2 by the pattern: `lab/server-telemetry` behind `telemetry`, the recorder in `lab/client-telemetry/` | ~−2 400 moved out of `server/`, ~−1 550 out of `client/` | **built** 2026-10-17, row 264's pull request; the owner's review is the proposal's |
| LABLEVERS | O3–O6 behind one `lab-levers` feature, and the rigs and `perf_counts.mjs` built with it | the four flags out of a default build | **built** 2026-10-17, row 264's pull request, on the owner's word ("lab specific things in the product path. We don't want that") |
| INGESTCLI | O8: `lab/av1/tools/ingest_coded.py` | 0 (~40 moved out of `ingest/`) | **built** 2026-10-17 |
| with 246 | O7 and row 246: `lab/harness/`, its cellcheck beside it | 0 | **built** 2026-10-17 |
| closed arms | `lab-fit-zeroed` (row 256's B1z) and `lab-ring-no-coop` (row 261's C1), found after this audit: both verdicts closed, so each arm is a patch in `lab/disk-access-bench/arms/` | −2 features, ~−20 lines | **built** 2026-10-17 |

Each candidate C1–C10 leaves the product, or stays in it for good, when its own decision lands. None of them
moves before that.

## Fourth round: the simplification sweep

*2026-10-20, a design review at `5625dcf4`; nothing built, run or timed. Scope: product code in `server/`, `common/`
and `client/`, the WASM client a product client since #99. Out of scope: test code apart from product logic and the
lab code in the default build (`claude/test-separation`), and #96, #39, #37, #40, #41, #88.*

**The theory.** A layer earns its place by a capability: something a doc claims or a test holds that the product
loses without it. After rounds 1–3, what is left to cut falls into three kinds. A **forward** adds no capability
(a wrapper, a second parse, an error that cannot happen) and goes with nothing to prove beyond the gate. A
**duplicate** is a second mechanism for one job (two clocks for one silence): one of them goes, and the claim the
other one held has to be shown to survive. A **build variant** is a binary that cannot do something. Removing it
loses a posture, not a feature, so it is the owner's call.

**The answer, in short.** Little dissolves. About 85 product lines go with no decision (U1–U8), and about 130 more
need one (U9–U12), against a product nobody has counted here. Each large layer is held by a capability (the
two readers by the fill's one-read bound, the `FramePipeline` seam by telemetry, the WebSocket by the TCP fallback,
which is open) or by an open decision. The largest single cut, `--congestion bbr-bound` (`loss_bound.rs`, 261 lines),
belongs to the congestion-controller review (`claude/design-congestion-controller`, its option D), so it is not
counted here. Every count is from a sketch, not a diff. Risk is as in round 2: 1 is covered by the gate's tests,
2 needs a check the gate does not run, 3 changes behaviour.

| # | what goes (where) | capability check | lines · risk |
| --- | --- | --- | --- |
| U1 | **`Congestion::as_str`** repeats clap's value names (`server/src/transport/tuning.rs:44-54`); round 2's S22, unblocked since #48 merged | `describe()` is its one caller; the tuning tests read `congestion=cubic-restart`, `bbr-bound` | −9 · 1 |
| U2 | **The FoD message parsed twice on WASM.** `decode_fod_msg` (`common/fod/src/lib.rs:40-48`) re-reads a length `session.rs:383` already read; the WASM client calls `decode_fod_body`, as the server does (`wire.rs:33`). `encode_fod_msg`'s `Result` cannot fail (u32, `Option<u32>`, `String` fields) | the browser contract against the real server; `cargo test -p fod` | −13 · 1 |
| U3 | **The bundle's header parsed twice, its metadata returned to nobody.** `prefix_len` (`common/series-bundle/src/format.rs:101-110`) repeats `parse_layout_checked`'s reads; `ParsedLayout.metadata` is read by neither the server (`frame_store.rs:46-48`) nor the lab (`lab/container-bench/src/parse.rs:619`); [`disk-layout/README.md`](disk-layout/README.md) §The metadata, twice says "nobody" | [`FIXTURES.md`](FIXTURES.md)'s two refusals stay in the index loop; lost: refusing non-UTF-8 metadata, which nothing claims | −18 · 1 |
| U4 | **The pipeline's frame names built twice.** A fill builds a `Vec<FrameSpan>` to take `.first()` (`pipeline.rs:67-73,121-137`); `FramePipeline::store()` serves one call, `Planner::new` (`server.rs:371`), which `serve` can feed from `self.store`; all three callers write `serve(sessions.pipeline(link), …)` | the telemetry seam is `read`/`write`/`refuse`/`finish` ([`adr/telemetry-server-pipeline.md`](adr/telemetry-server-pipeline.md)); `store()` is not in it. Fill: server reads stays 24 | −16 · 1 |
| U5 | **`enum Ahead { Idle, Named }`** is an `Option` (`server/src/media/read_path.rs:126-130`) | `a_fill_never_holds_more_than_one_read_at_once`, `an_abandoned_read_ahead_gives_its_buffer_back_to_the_pool` | −6 · 1 |
| U6 | **Two helpers each written twice in `link.rs`:** open-and-ready (`:60-66`, `:134-139`) and the two priorities (`:188-197`) | the link tests, the per-frame server tests | −7 · 1 |
| U7 | **The WebSocket reads the PEM files a second time** (`websocket.rs:63-90`, `server.rs:83-84`) though `Identity` already holds them; built from it, both transports serve the certificate whose hash the banner prints | the WebSocket server tests, `run_wire.sh`; wtransport 0.7.2's DER accessors to be confirmed | −5 · 2 |
| U8 | **The WASM refusal reason kept in a side map** (`SessionState.errors`, `client/transport/wasm/src/session.rs:326,413,698`) instead of sent as the waiter's `Err` | the refusal, truncation and closed-session clauses on the WASM rig; the reason strings byte for byte ([`CLIENTS.md`](CLIENTS.md)) | −10 · 1 |
| U9 | **Three objects for one WASM session**: `session-adapter.js`, `lib.rs`'s `TransportSessionHandle` (seven forwards, `:28-86`) and `session.rs`'s `TransportSession`. One `#[wasm_bindgen(js_name = TransportSession)]` type; the adapter becomes init plus re-export | the seam's surface unchanged ([`CLIENTS.md`](CLIENTS.md) §The seam); `close()` keeps `&self`; the contract suite on the WASM rig | ~−45 · 2, the crate's layout |
| U10 | **The `uring` cargo feature**: 41 `cfg` sites in `read_path.rs` and four elsewhere; the no-uring check in `scripts/gate.sh:174` | at run time `WTPACS_READ_PATH=pool` and a refused ring both fall to the pool ([`adr/disk-access.md`](adr/disk-access.md) §1). **Lost:** a binary with no io_uring code. That build is today the only one that makes no io_uring call, because the banner's ring probe (`banner.rs:20`) runs even under `pool` | ~−33 · 1, **owner** |
| U11 | **One control-stream path in `handle_incoming`** (`server.rs:267-287`): the opening-ask path serves a session with no URL ask too, the reader forwarding `Failed` when `accept_bi` fails | **changes the wire order** without an opening ask: the shared stream opens before the control stream is accepted, against [`ARCHITECTURE.md`](ARCHITECTURE.md) §The opening ask's "a session with no URL ask behaves as before" | −11 · 3, **owner** |
| U12 | **Two clocks for one silence.** The transport's per-ask `FRAME_TIMEOUT_MS` (`frame-session.ts:9,118-141,165-167`; `session.rs:23,706-733`) and the downloader's stall watch (`downloader.js:268-277`) both count "no byte since the last byte"; with survival on, the first only triggers the second's resume (`:241`). One clock in the downloader, capped at 15 s and failing owed work when survival is off | **changes a claimed capability**: [`CLIENTS.md`](CLIENTS.md) gives the timer "its own job", `aFrameIsLateOnlyWhenTheSessionGoesQuiet` holds it at the transport, and lab pages that drive `TransportSession` alone lose it | ~−40 · 3, **owner** |

**A contradiction, not a cut.** The web image ships `ws-session.js` and `race-session.js` (`client/transport/ts/build.sh:15-18`,
`deploy/Containerfile:79,86`), but the product page accepts only `ts` and `wasm` (`client/viewer/head.js:16-22`).
So [`deploy/README.md`](../deploy/README.md)'s `--websocket` enables a server nothing in the product dials. Either
the bundles leave the image (−2) or `head.js` names them (+2). Which one depends on the TCP fallback, which is open (§Open there).

**Kept, with the reason.** The two disk readers merged into one: `TileReader` would hold two fill reads in flight,
against `a_fill_never_holds_more_than_one_read_at_once` and [`adr/disk-access.md`](adr/disk-access.md) §11.
`FramePipeline` with one shipped implementation is the telemetry seam. `per-frame` is [`adr/stream-shape.md`](adr/stream-shape.md)'s,
kept by the owner. `htj2k.js`'s `finish()` fallback: the package build reaches it. All five decoder modules are
reachable. The wire framing in both TS and Rust: two independent clients is the reason for keeping two.
`shutdown_signal`'s fallback (`main.rs:35-48`, −6): it holds only in a case Linux does not produce, but it costs
less than reasoning about it. `wire.rs::read_exact` as wtransport's would hide `NotConnected` from `closed_by_peer`.
Round 2's and round 3's keeps still hold.

**How each is shown before it lands.** `scripts/gate.sh` in full, without `--no-browser`, since U2, U7, U8 and
U9 need the browser and `run_wire.sh` steps. `scripts/perf_counts.baseline` must come back unchanged: none of these
changes an ask, a read or a byte. Each touched path gets one mutation (CLAUDE.md §Measurement). U5 and U10 also
need `lab/scripts/read_path_ab.sh` with the variants interleaved, and the fill cells must tie. U12 also needs its
clause moved to the dispatch rig and mutated there, and the ASKDEADLINE cells re-run with the variants interleaved.

**U9–U12, audited.** *2026-10-22, read at `efd5f1c8`; nothing built or run. Every holder found by grep over
`server/`, `client/`, `lab/`, `deploy/`, `scripts/`, `.github/` and `docs/`.*

* **U9, one WASM type.** *Held by:* [`CLIENTS.md`](CLIENTS.md):39-40 (the handle is exported as
  `TransportSessionHandle`, the adapter re-exports it); no test holds the name. *Callers of the name:*
  `session-adapter.js:6,14`, `client/contract/adapters.ts:69` (Node, which loads `pkg/` itself because it inits
  from bytes, not a URL), `client/contract/refusals.html:34-37`, `lab/dial-deadline/index.html:28`. Every other
  consumer (the viewer, `deploy/web-files.sh`, `check_equivalence.sh`, the lab pages) loads the adapter, whose
  surface does not change. *Lost:* nothing; `session.rs` is never used as an rlib, and the adapter keeps the
  one-time `init()`. The three direct callers are renamed in the same diff. *Proof:* the contract suite on the
  WASM rig plus `refusals.html` and `check.mjs --client wasm` in the gate; mutation: keep the old `js_name` and
  watch `adapters.ts` fail to connect. `named()` moves onto the merged type's two promise paths, so the
  `FrameTimeoutError`/`DialTimeoutError` clauses must still pass by name. *Back:* one revert, no data.
  **Verdict: safe with that proof.**
* **U10, drop `uring`.** *Held by:* [`adr/disk-access.md`](adr/disk-access.md):51 and :1152-1154 (the pool path is
  `--no-default-features`), `server/Cargo.toml:16,25-27,40`, `scripts/gate.sh:173-174` (`cargo check` only, no test
  runs that build). *Who builds without it:* nobody: `deploy/Containerfile:42`, [`deploy/README.md`](../deploy/README.md):70
  and CI (via the gate) build the default; the two arm patches in `lab/disk-access-bench/arms/` name `uring` as
  context but are pinned to their own commit. *Lost:* a binary that makes no io_uring syscall. Under errno
  seccomp (Docker's default, `kernel.io_uring_disabled`) that costs nothing: the probe and the ring are refused
  and the pool serves ([`deploy/README.md`](../deploy/README.md):392-397). Under a filter that **kills** on a denied
  call (systemd's `SystemCallFilter=` without `SystemCallErrorNumber=`) the default binary dies at the banner's
  probe (`banner.rs:20`, `read_path.rs:225`) even under `WTPACS_READ_PATH=pool`; no deploy here uses one. So the
  loss is for nobody today, and becomes nothing if the probe is skipped under `pool` (`read_ring=off (pool)`).
  *Proof:* that skip plus a gate step running the default binary with `WTPACS_READ_PATH=pool` under
  `strace -f -e trace=io_uring_setup` and asserting zero calls; mutation: probe regardless, the step fails. Plus
  `read_path_ab.sh` interleaved, as above. *Back:* re-adding ~33 `cfg` lines from git. **Verdict: safe with
  the probe skipped under `pool`, shown by the strace step; without it, loses the no-io_uring binary,
  owner's call.**
* **U11, one control-stream path.** *Held by:* [`ARCHITECTURE.md`](ARCHITECTURE.md):849 ("a session with no URL
  ask behaves as before") and `an_opening_ask_is_served_behind_the_accept`'s second case (`server.rs:1164-1166`:
  an ignored ask opens **no media stream**), which the merged path breaks, since `Link::quic` opens the shared
  stream before control is accepted. *Who reads the order:* no client. Both browser clients and every Rust
  harness (`window-harness`, `disk-access-bench`, `recv-cost`, `server/tests/gso_cap.rs`) open control, then accept
  uni streams independently; the downloader dials with no URL ask when nothing is owed (`downloader.js:508`), so
  the product does take the `None` path, and is indifferent to it. *Lost:* the doc claim, the test's "no stream"
  assertion, and the `accept control bidi` error context; and a dial that never opens control now holds an
  opened shared stream. *Proof:* rewrite that case as "no frame arrives" and add "a session with no URL ask is
  served its first control ask"; mutation: drop the reader's `Failed` on a failed `accept_bi`, a session whose
  client closes without control must still end. *Back:* one revert. **Verdict: not worth it**: −11 lines for a
  rewritten test, a retracted doc line and a risk-3 change, gaining no capability.
* **U12, one silence clock.** *Held by:* [`CLIENTS.md`](CLIENTS.md):251-253 ("`FRAME_TIMEOUT_MS` keeps its own job"),
  [`client/README.md`](../client/README.md):181-187, [`ARCHITECTURE.md`](ARCHITECTURE.md):1045-1048; tests
  `aFrameIsLateOnlyWhenTheSessionGoesQuiet` (`client/contract/clauses.ts:493`, both rigs) and `aTimedOutAskIsResumed`
  (`client/transport/downloader.test.mjs:44`); `lib.rs`'s `named()`. *Callers that drive a session without the
  downloader:* `lab/stream-shape/index.html`, `lab/idle-sessions/idle-hold.html`, `lab/telemetry-cost/cost.ts`,
  `lab/client-telemetry/`, `client/contract/refusals.html` and `ask-during-fill.html`; on a silent session their
  ask now hangs instead of failing at 15 s. *Product:* the viewer goes through the downloader with `survival` on;
  a 15 s cap on the doubling stall is what `FRAME_TIMEOUT_MS` does there today (`client/README.md`:184-187), so
  nothing is lost. `survival: false` (tests, `lab/session-survival`'s `today`) changes: owed **fills** would
  fail at 15 s too, where today only asks do. *Proof:* the clause moved to the dispatch rig and mutated there (a
  clock counted from the ask fails the 16 s trickle; no cap leaves the silent ask waiting), plus the ASKDEADLINE
  cells interleaved. *Back:* ~40 lines in two clients, a contract clause and three doc passages. **Verdict:
  loses the transport's own bound on a silent ask for lab pages and rigs that use `TransportSession` alone, and
  changes `survival: false` for fills; owner's call.**

**Order.** `claude/test-separation` rewrites `server.rs`, `link.rs`, `pipeline.rs`, `read_path.rs`, `format.rs`
and `fod`, so U1–U7 land after it merges, as one draft pull request. U8 stands alone and can start today. U9 can
join U1–U7 with its proof. U10 needs the probe skip first. U11 is dropped unless the owner wants it, and U12
waits on the owner's word.

## Fifth round: the client

*2026-10-27, read at `ea581aca`; nothing built, run or timed. Scope: `client/` (transport TS and WASM, decode, paint,
viewer, contract, scripts) and the docs that describe it (`ARCHITECTURE.md`, `CLIENTS.md`, `WIRE.md`, `decode/`,
`display.md`, `client/README.md`, `client/paint/README.md`). Not re-reported: rounds 1–4 above, U1–U12 (#125, #134),
the WASM envelope parsed twice and `decodeFodMsg`. Read against the open client PRs #121, #124, #132, #135, #136,
#138 (and #133, which also touches `client/`). `decode/README.md` (2 392 lines) and `dispatch-rig.ts` (2 417) were
searched, not read whole: for numbers `client/README.md` repeats, stale code references and duplicate helpers.*

**The answer, in short.** The client's code is close to its essentials: about 44 lines go from it with no capability
lost, each small. The docs give more: about 62 lines that restate the code (wrongly, in one case) or record closed
items, safe now, and about 190 lines of built or rejected proposals in `CLIENTS.md`, which are the owner's to fold.
Three more lines and one comment contradict the code (V14). Grep calls behind each "no caller" claim were run over `client/`, `lab/`,
`scripts/` and `deploy/`.

Each finding: evidence, change, lines (− removed, + added; a sketch, not a diff), proof that nothing is lost, risk
(as in round 2: 1 the gate's tests cover it, 2 needs a check the gate does not run), verdict. Ranked by lines
removed per unit of risk.

| # | finding (evidence) | change | lines | proof · risk | verdict |
| --- | --- | --- | --- | --- | --- |
| V1 | **`ARCHITECTURE.md` §Messages restates the code, and is wrong.** Its tables (`:63-77`) omit `check`, `ack`, `undelivered` (`downloader.js:570-576`) and `pixel-port`, `started`, `resumed`, `recycled` (`consumer.js:82-96`); a `frame` comes from a decoder on the pixel port, not the downloader. The stamps paragraph (`:79-83`) names a "first byte" stamp that does not exist (`downloader.js:190`) and a conversion the consumer does not make | replace `:63-83` with one sentence: the messages are the branches of `downloader.js`'s `onmessage` and `consumer.js`'s `#fromDownloader`; stamps are epoch ms (`timeOrigin + now`); `wireBytes` per `client/README.md` §What a frame reports | −21 +3 | docs only; `adr-unit.md:214`'s §Messages pointer still resolves · 0 | **safe now**; **applied** |
| V2 | **`CLIENTS.md` §Open holds closed items** (`:648-660`): rows 3–4 of the WASM proposal are built (rows 277, 278), row 228's dav1d half was rejected (`:435`), and both "known defects" are closed, each already stated with its clause in §The contract suite (`:164`, `:167`). `ARCHITECTURE.md` §Open's WASM bullet (`:1302-1306`) likewise: `anAskIsOnTheWireBeforeItReturns` is at `CLIENTS.md:165` | delete `CLIENTS.md:648-660` and `ARCHITECTURE.md:1302-1306`; keep the `websocket.rs` bullet (`:1307-1313`) under its parent (`:1300-1301`), re-worded "one found by reading the code, shown not reachable" | −19 +1 | docs only · 0 | **safe now**; **applied** |
| V3 | **`client/README.md` repeats the root README and holds the lab's harness.** `:247-255` (the self-check and its run block) is `README.md` §Quick start's `:82-109`; `:271-273` mutates that lab page's `sha` lines, a rule `CLAUDE.md` §Measurement already states | replace `:247-255` with "The lab's self-check and cell pages: [`README.md`](../README.md) §Quick start."; delete `:271-273` | −12 +1 | docs only · 0 | **safe now**; **applied** |
| V4 | **The WASM session's small forwards** (`client/transport/wasm/src/session.rs`): `wire_view` (`:83-85`) has one caller (`:89`); `reader_read_bytes` (`:119-126`) one (`:186`); `RecvBuf::new` (`:135-140`) is `Default`; `:161` is mis-indented (no `rustfmt` step covers the crate) and `:199-200` a double blank | inline `wire_view` into `js_buffer_from`; fold `reader_read_bytes` into `read_exact` (`reader_read_value(…)` then `dyn_into::<Uint8Array>()`, errors mapped as today); `#[derive(Default)]` on `RecvBuf`, `RecvBuf::default()` at `:273`, `:502`; re-indent `:161`; drop `:200` | −16 +4 | the gate's WASM build (`require_transport_wasm` refuses a stale `pkg/`), the contract clauses on the WASM rig, `downloader-wasm`, `dispatch-wasm`, `run_wire.sh` · 1 | **safe now** (U8/U9 touch other lines of the crate); **applied** |
| V5 | **Two type-check configs for one directory.** `client/transport/ts/tsconfig.json` cannot check its own `include` (the sources import `./x.ts`); `tsconfig.check.json` adds the one flag, and `client/contract/tsconfig.json:4` adds it again | add `"allowImportingTsExtensions": true` to `tsconfig.json`; delete `tsconfig.check.json`; drop `contract/tsconfig.json:4`; `scripts/gate.sh:122` `-p tsconfig.check.json` → `-p tsconfig.json` | −8 +1 | the gate's type-check step prints `typed`; mutate: a type error in `frame-session.ts` fails it · 1 | **safe now**; **applied** |
| V6 | **`client/README.md` keeps history and repeats `ARCHITECTURE.md`.** `:95-97` (the warm-up removed 2026-10-03, the tag), `:132` "nothing was renamed to make room for it", `:177-178` (the probe ask until 2026-09-24): each is in `decode/README.md` §Warming the decoders or the queue. `:120-125` (a request is a generation) restates `ARCHITECTURE.md` §The consumer (`:459-466`) | delete the three; `:120-125` → "**A request is a generation**: [`ARCHITECTURE.md`](../docs/ARCHITECTURE.md) §Messages, §The consumer." | −10 +1 | docs only · 0 | **safe now**; **applied** |
| V7 | **`fillFrames` returns a time nobody reads.** `frame-session.ts:246,249,252` and `armFill` `:260,265`; WASM `lib.rs:45`, `session.rs:426,430,620,627,637`; the contract's type `clauses.ts:22` and `downloader-rig.ts:38`; documented `CLIENTS.md:273` (`→ askMs`). No caller uses it (grep for an assignment from `fillFrames(` over `client/`, `lab/`: none) | `void`/`()` throughout: `armFill` stores `askMs: performance.now()` in the fill itself, `arm_fill` likewise; `Ok(())`; `clauses.ts:22` `): void;`; delete `downloader-rig.ts:38`; drop `→ askMs` | −6 | `run.mjs` on every session, both browser rigs (the fill's `askMs` still reaches `onFrame` through `toResult`/`result_to_js`) · 1 | **safe now** (#136 edits `frame-session.ts:351-380` only); **applied** |
| V8 | **`DownloaderClient`'s `#failAll` has one caller** (`consumer.js:142-145`, called at `:196`) | in `#end`: `this.#closedReason ??= reason; this.#rejectAll(this.#closedReason);`; delete `#failAll` | −4 +1 | `consumer.test.mjs`, the dispatch rig's closing clauses (*closed by the consumer*) · 1 | **safe now**; **applied** |
| V9 | **WASM reads `WebTransportCloseInfo` by `Reflect`** with fresh key strings (`session.rs:672-684`), the cost `:107-108` says the file avoids, while `Cargo.toml:24` enables the typed dictionary and nothing uses it | `info.unchecked_ref::<WebTransportCloseInfo>()` and its `get_close_code()`/`get_reason()`; if web-sys 0.3.105 names them otherwise, delete `Cargo.toml:24` instead | −4 | `noticesClose` and the closed-session clauses on the WASM rig name the code and reason · 2: the getter names are confirmed only by the build | **safe now**, either branch; **applied** (the typed getters). *Corrected at apply:* no clause asserts the reason's text; a probe showed `session closed (code 7): server went away` before and after |
| V10 | **The AV1 refusal written twice**: `av1-frame.js:8-10` and `av1-payload.js:12-14`, the same message prefix | `export const refuse` in `av1-payload.js`; `av1-frame.js` imports it (already loaded with it: `av1.js:6-7`) | −3 +1 | `av1.test.mjs` and the dispatch rig check every refusal by its message · 1 | **safe now**; **applied**. *Corrected at apply:* `av1.test.mjs` matches a refusal's reason, not its prefix, and only its golden section (dav1d build) reaches `av1-frame.js`'s refusals; a mutant dropping the reason fails 15 of 233 |
| V11 | **One comment said twice in `downloader.js`**: `:26` and `:459-460` | delete `:459-460`; `:26` ends "…the dial does not: docs/ARCHITECTURE.md §The downloader." | −2 | comment only · 0 | **safe now** (#135, #138 do not touch either); **applied** |
| V12 | **Every caller passes `{ mainScriptUrlOrBlob: d.glue }` to `instantiate`** (`htj2k.js:35`, `av1-dav1d.js:16`, `lab/decode-bench/copy/htj2k-copy.js:9`); the test passes nothing | `wasm-glue.js:6,10`: no `options`, the factory always gets `mainScriptUrlOrBlob: d.glue`, with `htj2k.js:34`'s comment moved there; the three calls drop the argument | −1, a parameter fewer | `wasm-glue.test.mjs`, the real-decoder rig clauses, the viewer check; a single-threaded build ignores the field · 1 | **safe now**; **applied** |
| V13 | **A decoder's `done` carries fields nobody reads**: `index`, `gen`, `byteCount` (`decoder.js:68`); the downloader reads `kind` and `buffer` (`downloader.js:434-435`), and so does every lab reader of `done` (`lab/decode-tail/direct.js:33`, `lab/decoder-memory/page.js:122`) | `{ kind: "done", buffer }` at `decoder.js:68`; `fake-decoder.js:92` and `downloader.test.mjs:105` likewise | 0, 3 lines shorter | the downloader's tests and the dispatch rig · 1 | **safe now** (#138 edits `decoder.js:6-60`); **applied** |
| V14 | **Doc lines the code contradicts.** `client/README.md:171-172`: `survival: false` "turns it off", but `decodeMs` stays (`downloader.js:15`; `ARCHITECTURE.md:204` says so), and the override list omits `decodeMs`. `client/README.md:14` describes `downloader.test.mjs` as "how many decoders a start makes" (it has 11 cases, `:17-369`). `av1-frame.js:51` points to "decoder.js's `unranged()`", which is `htj2k.js:31` | `:171-172` → "an object overrides `deadlines` in `downloader.js`; `survival: false` turns off all but `decodeMs`"; `:14` → "node, on hand-fed transport and decoders: each file's last line names its cases"; `:51` `decoder.js's` → `htj2k.js's` | 0 | docs and one comment · 0 | **safe now**; **applied** |
| V15 | **`CLIENTS.md` keeps three proposals that are decided**: §Proposed: the WASM client and the dav1d tooling to `lab/` (rejected, `:427-495`), §Proposed: the WASM client as a second product client (rows 265, 274, 277–279 built, `:496-626`), §Proposed: the harness pages to `lab/` (done, `:627-640`). What still holds of them is W10–W12's measurements and the shape (TS the default, WASM by the transport file's `client`), already in §Choosing the client | fold each to its ruling and a pointer to the queue rows; keep W10–W12 as three lines under §The implementations | ~−190 +15 | docs only; the rows and their evidence stay in `av1/queue.md` and the branches · 0 | **needs the owner**: it removes a design record (`CLAUDE.md` §Docs asks a retracted claim be corrected in place; these are decided, not retracted) |

**After an open PR, not now.** `frame-session.ts:354,357` returns "truncated before its index" twice: #136 merges
them. `downloader.js:310-311`'s double blank sits in #135's hunk: one line for #135 to take. *Corrected on
review:* #135's hunk there ends at `:306`, three unchanged lines before it, so the line can go now, −1.

**Corrected on review** (2026-10-28, at this round's commit; V9's and V10's proofs are corrected where #202 applies
them):

| claim | what is true |
| --- | --- |
| V1: "a `frame` comes from a decoder on the pixel port, not the downloader" | both: with `decode: false` the downloader posts `frame` itself (`downloader.js:207`), and `#fromDownloader` takes it (`consumer.js:93`). V1's change stands |
| V6: the probe ask "is in `decode/README.md` §Warming the decoders or the queue" | it is in `ARCHITECTURE.md:1029`, retracted in place there; nothing is lost |
| V7's site list | also `lab/client-telemetry/wrap-session.ts:15` (`): number;`), which forwards the value and reads none |
| V14 found every stale "decoder.js's `unranged`" | `client/decode/wasm/openjph/htj2k_decoder.cpp:113` says it too, and `lab/decode-bench/copy/wrapper.patch:79` carries that line as context, so both change together · 2: the patch must still apply |

**Kept, with the reason.**

* The view defaults and the placement written in `paint-worker.js:142-151`, `paint/reference.js:10-17` and the
  viewer (`viewer.js:42`): the reference is the second computation the readback check compares, so sharing the
  geometry would let a placement bug pass both; the viewer needs every field to step from.
* `viewer/check.mjs:20-23` lists the clients' files as `head.js:16-19` does, and `check-page.js:68` picks a typed
  array as the decoders do: the check's own reading is what it compares with the page.
* `settle` in `contract/clauses.ts:85` and `ring.ts:11` (30 ms) beside `rig-util.ts`'s (40 ms): 35 call sites
  would change their timing. `range` in two rigs: one line.
* `check_worker_safe.sh` and `check_telemetry_absent.sh` each list the four artifacts: the gate runs one always and
  the other only without `--quick` (`scripts/gate.sh:98,219`).
* `parsePayload(bytes, n)`: `n` is read by `av1.test.mjs` and `lab/av1/exact/codec-string`. `planar` and `grey` in
  `av1-webcodecs.js:149-178` share three lines of copy. The `?check=` hooks in `viewer.js:26-32,242-246`: they must
  be armed before the page fails, and moving them adds a module load for no product line.
* `client/paint/README.md` §The contract writes out the VOI formulas `voi.js` implements: it is the contract the
  check holds both renderers to, with its PS3.3 clauses.
* The ASKDEADLINE measurement and the mutation table in `client/README.md:181-245` are recorded nowhere else; they
  belong in `docs/`, but moving them removes no line.

**The apply row.** V1–V14 in one branch from unified, one commit each; V15 waits. Total: about −106 +13, of which
code −44 +7 (V4, V5, V7–V13) and docs −62 +6. Before pushing: `scripts/gate.sh` in full (the WASM rig,
`run_wire.sh` and the viewer check need the browser), `scripts/comment_budget.sh`, `scripts/check_links.py`, and one
mutation each for V5 (a type error), V8 (`#rejectAll` dropped from `#end`: a closed client's ask must still reject)
and V10 (the imported `refuse` changed: `av1.test.mjs` fails by message). V9 and V4 need the WASM build first
(`client/transport/wasm/build.sh`).

## Fifth round: server, tools and lab

*2026-10-27, at `ea581aca`. An audit: nothing was changed but this section. Two removals were built and checked
with `cargo check` (V7), and then reverted. Apart from that, nothing was built, run or timed beyond
`scripts/comment_budget.sh` (it passes everywhere, lab included) and searches. The scope was `server/`, `common/`,
`tools/`, `ingest/from-parser`, `scripts/`, `deploy/` and `lab/`. Not re-reported: rounds 1–4 above, U1–U12, and
`--segmentation-offload` stored twice. The open pull requests' new code was not audited: #112, #130, #131, #133,
#136, #139, #160, #162, #163.*

**The answer, in short.** The product side has little left to cut. The product code in `server/`, `common/`, `tools/` and
`ingest/from-parser` was read for this round. It holds no dead public item, no unused
feature, no queue label in code and no comment over the budget; the open items are rounds 1–4's, and three new
small ones are below. The deploy directory carries one file twice. The lab is where the lines are:

* **Twelve directories** answer a question whose result a doc already records, and nothing else uses them:
  ~3 120 lines.
* **One script** duplicates another: −141 lines.
* **Copies of about six helpers**, spread over 40-odd files, are a lab-helpers proposal for the owner.

**Safe now: ~2 290 lines. Once the PRs named in V2 and V8 merge: ~3 080. With the owner's word: ~3 590.**

Verdicts:

* **safe now**: touches no file that #112 (`git diff --name-only origin/main...origin/claude/test-separation`)
  or another open PR changes;
* **after #N**: it waits on that PR;
* **owner**: it needs the owner's decision.

Risk follows rounds 2–4. 1 means the gate covers it, or the change is lab-only with no caller. 2 means the
check is one the gate does not run. 3 means it is structural.

### Findings, ranked by lines removed per unit of risk

| # | finding · evidence | change | lines − / + | proof no capability is lost | risk | verdict |
| --- | --- | --- | --- | --- | --- | --- |
| V1 | **Seven lab directories whose question is answered and recorded, with no live user.** `ask-behind` (159 lines; [decode/README](decode/README.md) §An ask behind the decoders; owner: "not pursued now", queue.md:4306) · `clock-resolution` (96; [rig-limits](rig-limits.md) §6 *The clock floor*) · `decode-first-frame` (396; decode/README §The first frame, §Instantiating by streaming; levers.md "held") · `decode-tail` (678; decode/README §The decode tail, §The package, throttled, §The range pass; ARCHITECTURE §The downloader variant during a fill; levers.md "held") · `decoder-memory` (551; decode/README §What a decoder worker costs, resident, §The wire buffer ring; "held") · `fill-at-start` (230; ARCHITECTURE §The first fill; "held") · `worker-leak` (120; ARCHITECTURE §Closing a client; "held (fixed)"). None holds raw rows. | `git rm -r` the seven. Repoint each citation by replacing the link or path with `` `lab/<dir>/<file>` at `ea581aca` `` so `scripts/check_links.py` accepts it (a commit hash within 2 lines): decode/README.md:350, 502, 547, 672, 697, 938, 1000, 1025, 1063, 1110; ARCHITECTURE.md:324, 479, 670; rig-limits.md:464 (add the hash), and :425–427 (drop the two names from the list); client/README.md:83; lab/av1/decode/memory/README.md:43. Point `lab/scripts/gen_htj2k_fixtures.sh:5` to `docs/FIXTURES.md` instead of `lab/decoder-memory/README.md`. Update `lab/README.md`'s table at lines 16, 17 and 24 (see V11). | −2 230 / +0 (16 lines edited) | `git grep -n 'lab/<dir>'` outside each directory finds only the citations above. No gate step, product script or other lab directory names them (checked for each). Each verdict stays in its doc, and the code stays in git. `scripts/check_links.py` passes after the repoints. | 1 | **safe now**: applied in #200, then reverted in `claude/line-hygiene` until the owner confirms the removals |
| V2 | **`lab/scripts/read_path_split.py` repeats `pair_variants.py`.** `read_path_split.py:36-105` and `pair_variants.py:38-97` hold the same `KEY`, `DRIFT`, `MIN_N`, `regime`, `load`, `deltas` and `verdict`; `pair_variants` is the general form. Only `--phases` and its warning (`read_path_split.py:44-46,89-102`) are extra. `pair_variants.py:2-28` also retells the "42 % win, twice" story that [`adr/disk-access.md`](adr/disk-access.md) tells at :1248-1251. | Move `phase_of`, the phase filter in `load`, `--phases` and the warning into `pair_variants.py`. Delete `read_path_split.py`. Cut `pair_variants.py`'s docstring to its purpose line, its usage lines and a pointer to disk-access §11. Repoint disk-access.md:1247 to `pair_variants.py --pairs pool_ringloop:pool,hybrid:pool_ringloop,hybrid:pool,hybrid_lazyring:pool`. | −153 / +12 | Same metric (`cpu_ns_per_ask`), drift 28.5 and 0.8n sign rule, so the old output is the new command's on the archived TSV; diff the two outputs once. Its only caller is that docs line (`git grep read_path_split`). | 1 | after #130, #162 (both edit disk-access.md) |
| V3 | **The image's ignore file is kept twice by hand.** `.containerignore` and `deploy/Containerfile.dockerignore` are byte-identical (31 lines each), and line 1 says "keep the two equal"; nothing checks it. | `git mv .containerignore .dockerignore`; drop its line 1; `git rm deploy/Containerfile.dockerignore`. Docker reads a root `.dockerignore` when no Dockerfile-specific one exists, and Podman/Buildah reads `.dockerignore` when there is no `.containerignore`. `Containerfile.prebuilt` builds from a staged directory and is not affected. | −32 / +0 | `docker compose -f deploy/compose.yml build` and `podman build -f deploy/Containerfile .` each report the same "transferring context" size before and after. Mutate by removing the `lab/` line, and the context grows. | 1 | **safe now**: applied (a Docker context probe; Podman not run) |
| V4 | **A lab helper no one calls.** `lab/scripts/cloud_common.sh:68-74` `run_cloud_harness`: `git grep -w` finds only its definition. Both files that source the script use the other helpers. | Delete it. | −7 / 0 | the grep | 1 | **safe now**: applied |
| V5 | **A lab feature no one sets.** `lab/disk-access-bench/Cargo.toml:19-25` `tokio-uring`, with its `tokio_unstable` lint. Its one use is `src/bin/read_campaign.rs:87`. No script passes it, and `README.md:23`'s "the gate compiles it" is false (`scripts/gate.sh:183` passes no features). tokio's driver is rejected as measured ([`adr/disk-access.md`](adr/disk-access.md):181, :1404). | Drop the feature, the `[lints.rust]` block and the `:87` arm. Correct README:22-23 to say the plain `tokio_fs` variant stays. | −7 / +0 | `cargo test -p disk-access-bench` still passes; the rejected arm's result stays in the ADR. | 1 | **safe now**: applied |
| V6 | **Campaign history in clap help text.** `lab/disk-access-bench/src/main.rs:349-353, 357-359, 364-367` ("The first campaign had only warm…", "…made the first campaign's cold cells unreadable"). | Keep each flag's one-line meaning; disk-access §12 already holds the history. | −10 / 0 | `--help` keeps each flag | 1 | **safe now**: applied |
| V7 | **Two unused dependencies.** `serde` in `server/Cargo.toml:42`: the server derives nothing, and only `serde_json` is used. `rcgen` in `lab/disk-access-bench/Cargo.toml:38`: no `rcgen` in its sources. | Delete both lines. | −2 / 0 | Checked here with both removed: `cargo check -p series-server --all-targets --features telemetry,lab-levers,lab-frame-cache,lab-classify,cert-compression` and `cargo check -p disk-access-bench --all-targets` both pass. | 1 | **safe now**: applied (server/Cargo.toml is in no open PR's file list) |
| V8 | **Five more answered directories, each waiting on another PR or the owner.** `early-messages` (146; ARCHITECTURE §Messages posted before anyone listens): its citation is CLIENTS.md:206. `firefox-dial` (175; transport-conclusions §Firefox's dial on a slow link): `lab/irtt/README.md:39` borrows its Firefox pin, so that line moves to `lab/av1/bytes/jpeg-xl/README.md`, which holds the same pin. `viewer-ceiling` (328; §273 above; its ceiling is the host's): its citation is merge-readiness.md:640. `ffportgc` with `frameloss` (243; ARCHITECTURE §The downloader, "A frame lost silently in Firefox", "The ack costs no fill"): the rig was never run with `startOnNeed`, which is still the owner's. | As in V1, repointing transport-conclusions.md:1624 and :1985, ARCHITECTURE.md:118, :182 and :225, CLIENTS.md:206, merge-readiness.md:640 and irtt/README.md:39. | −892 / 0 | as in V1 | 1 | `early-messages`: after #133 and #136 (CLIENTS.md). `firefox-dial`: after #112 (irtt/README.md). `viewer-ceiling`: after #136 and #139 (this file). `ffportgc`+`frameloss`: **owner** (`startOnNeed`). |
| V9 | **Logic copied across the lab.** All are identical text (`git grep -c -F` on the line) unless noted. (a) A throwaway certificate and its SHA-256: 44 lab files (20 shell, 17 `.mjs`, 7 Python). (b) `const arg = (k, d) => …`: 58 copies; `const med = …`: 34, while `lab/order.mjs:22` holds the same median privately (*corrected 2026-10-28, review*: this said 30; six more take the upper middle, `[a.length >> 1]`, which is not that median on an even count: `downloader-cost/port.mjs:59`, `resources.mjs:106`, `scripts/cpu_throttle.mjs:160` and three in V1's `decode-tail`); `const f = (v) => v.toFixed(…)`: 18. (c) Start-a-server-and-wait-for-`wt_url=`: 7 copies (`blink_cells.sh:52`, `controller_cells.sh:42`, `first_ask_cells.sh:56`, `neighbour_cells.sh:43`, `profile_cells.sh:108`, `idle_session_cost.sh:29`, `server_ab.sh:82`). Start-the-relay-and-wait-for-`READY`: 4 copies (`blink_cells.sh:62`, `controller_cells.sh:53`, `first_ask_cells.sh:67`, `cert_chain_cells.sh:136`). | **Proposal** (structural, `CLAUDE.md`). `lab/scripts/dev_cert.sh DIR`, which writes `DIR/{cert,key}.pem` and prints the hash. `order.mjs` exports `median`, and one lab module holds `arg` and `f`. A sourced `lab/scripts/cells.sh` holds `start_server LOG SERIES ARGS…` and `start_relay LOG ARGS…`. Each call site becomes one line. | ~−330 / +60 | Each copy is the same text, so the behaviour is the same. Each touched rig runs once, smoke-sized, before and after. The gate runs none of them. | 2 | **owner**: the shape is a proposal, and V1/V8 remove some call sites first |

V10–V11 are small and land with the row that next touches their files.

* **V10.** `lab/window-harness/src/lib.rs:11` re-exports `reset_peak_outstanding`, which only `client.rs` calls,
  so it becomes `pub(crate)`. ±0. Proof: `cargo check`. **Safe now: applied.**
* **V11.** `lab/README.md`'s table names 31 of the 47 directories (*corrected 2026-10-28, review*: this said 30,
  and of the twelve V1/V8 remove only `ask-behind`, `ffportgc`, `firefox-dial`, `frameloss` and `viewer-ceiling`
  are missing). Missing are `ask-ahead`, `bb3`,
  `container-bench`, `devices`, `fastclock`, `faultbench`, `irtt`, `iwdeep`, `link-conditions`, `loss-class`,
  `recv-cost` and those V1/V8 remove. After V1, each kept directory gets a row naming the doc it reproduces
  (~+8). **Safe now, with V1: applied.**

### Not cuts, found on the way

* **N1. The gate warns that a call is unsound, since #183.** tokio 1.53.3 deprecates
  `AsyncFd::with_interest` as "unsound due to lack of I/O safety". The ring's park uses it at
  `server/src/media/uring_reader.rs:41`; the lab bench uses it at `lab/disk-access-bench/src/uring_access.rs:132`
  and uses `AsyncFd::new`, deprecated alike, at `:127`. The fix is `unsafe { AsyncFd::register_with_interest(…) }`
  (`AsyncFd::register` at `:127`) with a one-line
  `SAFETY` that points at the invariant already stated at `uring_reader.rs:24` (the `AsyncFd` is declared before
  the ring, so it leaves the reactor before the fd closes). +1 line each. Proof: no warning, and the read-path
  tests pass. The server's copy is **after #112**; the lab's is **safe now: applied**.
* **N2. Two interleavings are not balanced past two arms.** `lab/scripts/runtime_ab.sh:73` and
  `lab/scripts/browser_receive.py:177` alternate forward and reverse order. That balances predecessors only for
  two variants, against `CLAUDE.md` §Measurement. The fix is `order.py row` and `from order import order`
  (±0). It changes the order of future runs only. **Safe now: applied.**
* **N3.** `lab/scripts/idle_session_cost.sh:34` waits on `listening\|ready\|serving` in the log. It matches the
  tracing line `series-server ready`, where every other rig waits on the banner's `wt_url=`. Fix it with V9(c),
  or alone (±0). **Safe now** alone: no open PR touches the file (*verdict added 2026-10-28, review*).
* **N4.** `lab/scripts/read_path_cloud_summary.py` (33 lines) has no reference. It reads `read_path_cloud.sh`'s
  TSV. The fix is one pointer line in `read_path_cloud.sh`'s header (+1). Keep the script: it is how that table
  was summarised. **Safe now**: no open PR touches either file (*verdict added 2026-10-28, review*).
* **N5.** `Sessions::new`'s doc says "Warns for each lab lever that is on" (`server/src/transport/server.rs:143`).
  It warns only for `--send-window-follows-cwnd`; `lab_levers::apply` warns for the rest. The fix is to drop the
  line (−1). **After #112.**

### Kept, with the reason

* **The product's own two certificate makers.** `server/scripts/gen_dev_cert.sh` writes the dev directory and the
  transport file, and `deploy/server-start.sh` writes the container's; neither can call the other.
* **`tools/check-fastpath`.** It shares the server's probe on purpose (`frame_store.rs:215`), and deploy/README
  §Container settings proposes shipping it in the image.
* **`scripts/quic_peek.py` and `wtcompat.py`.** Row 264 already ruled they are product checks, not lab code.
* **The `--stall-after-bytes` wiring in `Link`** (`link.rs:23-27,85-99,179-184`) is compiled into the default
  build with `None`. A `#[cfg(feature = "lab-levers")]` on each of its five sites would add lines, not remove them.
* **Twenty lab directories.** Each has a live user or open decision: `ask-ahead`, `bb3`, `decode-bench`,
  `dial-deadline`, `downloader-cost`, `fastclock`, `faultbench`, `idle-sessions`, `irtt`, `iwdeep`,
  `link-conditions`, `loss-class`, `page-open`, `paint-floor`, `server-load`, `session-survival`, `stream-shape`,
  `tcp-fallback`, `telemetry-cost` and `traces`. Each is held by a script that runs it, a doc's raw rows, or an
  owner decision: L7's levers, row 220, device plans D1 and D4, block-or-mark, coalescing, keep-alive, the TCP
  fallback.
* **No lab script calls a removed flag, binary or path.** Every lab binary's `--help` was matched against every
  invocation in `lab/` and `scripts/`, along with the features, env vars and banner lines the rigs wait on. The
  one absent script, `exec_gap.sh` (`workstation_run.sh:348-362`), is row 258's, on its branch.

### The apply row

It starts from this branch and applies only the **safe now** items: V1, V3, V4, V5, V6, V7, V10, V11, N1 (the lab
half) and N2. That is **−2 288 / +9 lines**, in one draft pull request into unified, one commit per item.
Applied on `claude/server-simplify-r5`, one commit per item: −2 337 / +50, net −2 287.

* **Before pushing:** `scripts/gate.sh --quick`, `scripts/check_links.py` and `scripts/comment_budget.sh`.
* **For V3:** the two context-size builds, with their output.
* **For V7 and V10:** the `cargo check` lines above.
* **For V1:** `git grep -n 'lab/\(ask-behind\|clock-resolution\|decode-first-frame\|decode-tail\|decoder-memory\|fill-at-start\|worker-leak\)'`
  must show only lines that carry `ea581aca`.

V2 and the V8 directories that wait on a PR follow once that PR merges. V9, `ffportgc`+`frameloss` and nothing
else go to the owner.

*Reviewed 2026-10-28, against `ea581aca` and the apply row's `1ddef1d1`.* All sixteen findings were re-checked,
each grep and line as cited. V9's and V11's counts were wrong and N1, N3 and N4 incomplete; each is corrected
above. The apply row also edits `deploy/README.md` (its "four crates" was six) and `Cargo.lock`, which #130,
#131, #133, #160 and #163 change in other hunks: a merge, not a decision. Both `lab/disk-access-bench/arms/*.patch`
still pass `git apply --check` there. N1's server half edits next to `ring-no-coop.patch`'s hunk
(`uring_reader.rs:30-39`, which #162 also edits), so it runs that check again.
