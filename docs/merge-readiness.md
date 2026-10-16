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
| D6 | the FoD message union defined twice | `client/transport/ts/wire.ts:3-30`; `client/record/parse.ts:8-55` | simplify: `record` imports it | ~−10 |
| D7 | SHA-256-to-hex written three times | `client/viewer/viewer.js:246-250`; `check-page.js:4-5`; `client/decode/wasm-glue.js:14` | simplify | ~−6 |
| D8 | `ingest/from-parser/same.py` rebuilds by hand the metadata `from_dicom.py` writes | `same.py:35-37`; `from_dicom.py:51-53` | simplify: one `metadata()` | ~10 |
| D9 | **the WASM transport**, a second full client in Rust that the product never loads. It duplicates `frame-session.ts` and the gate needs wasm-pack for it. | `client/transport/wasm/` (~780 lines) | **move to lab**, beside `lab/other-clients`. This is structural: propose it first. | ~780 moved |
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
12. **WASMTOLAB** (*review*, propose first) — D9 and P6's `dav1d/` tooling moved to lab.

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
| S21 | **The lab's harness pages live in `client/`.** `client/harness/` (`cell.html`, `index.html`, `shell.js`, ~400 lines) is served by the dev host at `/harness/`, never by the image. | `server/dev-server.py:43-45`; `deploy/web-files.sh:9-14`; `deploy/check_equivalence.sh:66-67` | move to a new lab/harness/, the dev host's route repointed; `client/` then holds the product and its checks alone | none | ~0 saved, ~400 moved | 3 |
| S22 | **`Congestion::as_str` repeats clap's value names.** | `server/src/transport/tuning.rs:49-57` | simplify: `to_possible_value()`; after #48, which rewrites `tuning.rs` | none | ~−8 | 1 |
| — | four congestion-controller wrappers forward the same nine methods to `inner` | `restart.rs:64-145`; `loss_bound.rs:102-160`; `classify.rs:36-79`; `cc_trace.rs:125-195` | keep: a delegating macro saves ~60 lines but is one more thing a reader must expand; three wrappers after S18 | — | — | — |
| — | the read path's two readers in one 1 073-line file | `server/src/media/read_path.rs` | keep: 503 product lines, each reader under 300, the ADR names them together | — | — | — |
| — | the server's workspace build copies the WASM client and four lab crates into the image's build stage | `deploy/Containerfile:16-27` | keep: the root workspace lists them; a lab workspace of its own would need a second lockfile and a copy of `[patch.crates-io]`. Row 228 removes the WASM lines if the owner moves it | — | — | — |

No `TODO`, `FIXME` or `#[ignore]` is in the product, and one `#[allow(dead_code)]`, row 209's cache behind its feature; no client export but S2's is
imported by nothing (a search over `client/`, `lab/`, `scripts/`, `ingest/` and `deploy/`). The docs agree with the
code wherever this round checked them: rows 218, 224 and 225 corrected what their changes touched. One pointer
does not resolve, in a file that is the owner's: `CLAUDE.md` §Docs names "docs/disk-access/adr.md §2" as the model of
a retraction; the file is [`adr/disk-access.md`](adr/disk-access.md) (`docs/levers.md` §Found on the way says so
too). For the owner, not a row.

### What the open decisions hold

Not proposed here; counted so the owner sees what each ruling frees.

| decision | what it holds | lines |
| --- | --- | --- |
| #48 (row 227, D1–D8) | the duplication round 1 found, already written | −84 net |
| row 228 (D9, P6) | the WASM transport and the dav1d-WASM tooling; the gate's wasm-pack, wasm32 target and binaryen | ~780 and ~550 moved |
| row 220 (#41) | the repeated-Initial reply: its flag, patch and tests | ~−270 |
| `bbr-bound` (§Blocked, row 107) | `loss_bound.rs` | ~−265 |
| row 209's `FrameCache` (off by default, "for now") | `lab_frame_cache.rs`, its feature and `pipeline.rs:77-98` | ~−100 |
| `readMin` (H3) | the BYOB read path | ~−60 |
| `startOnNeed`, `mixed` (H3) | the lazy decoder pool; AV1's split decode | ~−30, ~−15 |
| R4 (ARCHITECTURE §Open) | the server's module layout, moves and renames only | 0 |

### The comment budget

`scripts/comment_budget.sh` passes; no product file is over 0.18. Nearest the line (comment lines, and the file's
budget used): `client/transport/ts/ws-session.ts` 10 (100 % of its floor), `client/decode/av1.js` 10 (99 %),
`client/decode/av1-frame.js` 13 (96 %), `client/decode/htj2k.js` 10 (96 %), `server/src/record/path.rs` 27 (94 %),
`client/record/types.ts` 26 (93 %), `server/src/media/frame_pool.rs` 9 (90 %), `client/transport/consumer.js` 27
(90 %). Each comment read there is a contract, a unit or a pointer; none is cut by this round. The next comment any
of them gains must displace one.

### The longest files and functions

| where | lines | what would split it |
| --- | --- | --- |
| `server/src/transport/server.rs` | 2 277 (440 product) | S11 (tests −200); S9 |
| `client/contract/dispatch-rig.ts` | 2 362, ~60 clauses | by subject (dispatch, survival, exactness, AV1) into four files; nothing saved, so no row unless the owner wants it |
| `server/src/media/read_path.rs` | 1 073 (503 product) | keep (above) |
| `client/transport/downloader.js` | 577 | keep: one worker's state; S12, S13 trim it |
| `client/transport/wasm/src/session.rs` `connect` | 109 | row 228 |
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

*Proposal (structural): written first, moved on the owner's yes.* S21: `client/harness/` to a new lab/harness/, the
dev host's `/harness/` route repointed, the paths in `docs/` and `lab/` with it; `client/` then holds the product and
its checks alone, and `check_equivalence.sh`'s hidden-path list shrinks. Nothing is saved; a reader of `client/`
holds three files fewer. **Deliverable:** the proposal in `docs/CLIENTS.md` beside row 228's. **Branch:**
`claude/wip-246-HARNESSTOLAB`, then a draft PR.

## Third round: the lab's things in the product

The owner, 2026-10-16: "things only for lab should live in lab/. If also meant for product usage I would like to
evaluate the results before deciding whether to keep it or not." Queue row 264 (LABONLY), on
`claude/av1-unified-mainbase` at `a9fd5bd6`: every lab thing under `server/`, `client/`, `common/`, `ingest/`,
`deploy/` and `scripts/`, and one pattern for moving the server's. An audit and a proposal. Nothing here is built
except the pattern's first instance, row 264b (CLASSIFYTOLAB), which is on its own branch,
`claude/wip-264b-CLASSIFYTOLAB`.

The rule sorts each thing into one of two kinds:

* **Lab only**: no measurement proposes it for the product, or one rejected it. It moves to `lab/`.
* **A candidate**: a protocol or a measurement still proposes it. It stays where it is, off by default, until its
  decision, and is then adopted or removed. It does not move.

Rounds 1 and 2 found part of this already (L1–L8, S17, S18, S21 above, and rows 228 and 246's proposals in
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
| O1 | `--congestion cubic-classify`, `LossClassify` | `server/src/transport/classify.rs` (174 lines, 70 of them tests); `tuning.rs:3,22-23,45,55,184`; `transport/mod.rs:4`; `main.rs:70` | not the default "in both readings", "stays a lab flag": [TC §1 *Measured: CLASSIFY*](transport/transport-conclusions.md#measured-classify-2026-10-14). S18 proposes removing it (row 240, on the owner's word) | **built, row 264b**: the crate `lab/cc-classify`, behind `lab-classify`. If row 240 is taken, the crate goes and nothing in `server/` is left to remove |
| O2 | the telemetry: `server/src/record/` (2 083 lines), `transport/cc_trace.rs` (317), `RecordedPipeline` (`pipeline.rs:166-213`), and 23 `cfg` sites in 7 files; `client/record/` (1 545) | as cited | lab builds only ([`adr/telemetry-server-pipeline.md`](adr/telemetry-server-pipeline.md)). No default binary or bundle has it since row 221 (L1), and both absence checks hold | **by the pattern, as its own structural row.** `record/` names nothing of the server's outside itself, and `cc_trace.rs` names only quinn, so together they become one lab crate, and `telemetry = ["dep:…"]`. `RecordedPipeline` and the tap's call sites stay as the feature's wiring. `client/record/` goes to `lab/` with the bundle that `client/transport/ts/build.sh` makes from it |
| O3 | `--hold-sessions` | `server/src/transport/server.rs:57-59,104-112,241-245` | lab only: a dial that never settles, for the client's dial deadline ([ARCHITECTURE §A dial that never settles](ARCHITECTURE.md#a-dial-that-never-settles)). L7 keeps it as a lever | wiring alone, with no code to hold: the pattern's gate without a crate (below). Its one user is `lab/dial-deadline/run.mjs` |
| O4 | `--stall-after-bytes` | `server.rs:60-62,126,135-137,155`; `link.rs:23-24,85-98` | lab only: WebKit 319818's stall, emulated for `recycleAtBytes` ([ARCHITECTURE §Recycling before the stall](ARCHITECTURE.md#recycling-before-the-stall)) | as O3; one user, `lab/session-survival/recycle_cells.sh` |
| O5 | `--force-pool-reads` | `server.rs:51-53,86-89`; `media/frame_store.rs:162-166` | lab only for the flag; the method is also the read path tests' forced miss (`CLAUDE.md` §Measurement) | the flag as O3; the method stays. Users: `lab/scripts/cold_series.sh`, `fill_order_cells.sh`, `window-harness`'s `fill_order`, and the product's `scripts/perf_counts.mjs`, which would build with the feature |
| O6 | `--segmentation-offload false` | `server/src/transport/tuning.rs:87-90,103,127,159-161` | lab only: netem on the sending host ([`rig-limits.md`](rig-limits.md) §3) | as O3; one user, `lab/scripts/lossy_link_levers.sh` |
| O7 | `scripts/cellcheck.sh`, `scripts/cellcheck.mjs` | as named | lab only: they drive `client/harness/`'s pages | **with row 246**, whose proposal ([CLIENTS §Proposed: the harness pages](CLIENTS.md#proposed-the-harness-pages-to-lab)) moves the pages but leaves these two in `scripts/` |
| O8 | `ingest/coded-frames/ingest.py`'s `main()` | `ingest.py:292-331` | lab only: it codes a fetched set (`import size` from `lab/av1`), and the product's path is `from-dicom/from_dicom.py` → `ingest.coded()` | to a `lab/av1/tools/` script that imports `ingest`, with the lab files that run it repointed (34 name it, 22 of them scripts). `coded()`'s `representation`, `split` and `grey8` stay: they are the arms the lab drives through the product's code, and the product passes the defaults |
| — | `client/harness/`; the WASM client and `client/decode/wasm/dav1d/` | — | rows 246 and 228, proposed | as proposed in [`CLIENTS.md`](CLIENTS.md) |
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
| 264b CLASSIFYTOLAB | O1 by the pattern, built at `d41a544d`: the gate green but for `check_equivalence.sh --local`'s known 403 here, both absence checks passing by hand, every new test mutated | `server/src` −179 +32: the product's code +7 −178, the tests +25 −1 | review |
| TELEMETRYTOLAB | O2 by the pattern: the server crate and the client recorder | ~−2 400 moved | a proposal first (structural) |
| LABLEVERS | O3–O6 behind one `lab-levers` feature, and the four rigs and `perf_counts.mjs` built with it | ~−60 out of a default build | on the owner's word, or kept |
| INGESTCLI | O8 | 0 (~40 moved out of `ingest/`) | today |
| with 246 | O7 | 0 | with row 246 |

Each candidate C1–C10 leaves the product, or stays in it for good, when its own decision lands. None of them
moves before that.
