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
* **Not code**: 483 kB of synthetic AV1 golden payloads under `client/contract/av1/`, each with its `.sha256`, made by
  `ingest/coded-frames/make_golden.py`; raw measurement rows under `lab/`. No fetched data, no built binary, no secret.

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
| **the check's `--fill 0`, in both engines** | **fails, 4 of 4 checks.** The fault is in the check, not the page. Frame 0 arrives exact and drawn. The check then demands every frame received and read back. On-demand mode never fills, and the protocol's two asks (`check-page.js:20-26`) do not enter the page's frame map. So the viewer's on-demand mode has no working check, and the gate does not say so (`run_check.sh` names only the cross-codec arm and Firefox as skipped). |
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
| B3 | **The viewer shows a false error when a frame is asked twice.** In fill mode, stepping 5→6→5 before frame 5 arrives asks frame 5 again. The consumer then refuses with "already requested", and the page counts that in `errors`. | `client/viewer/viewer.js:141-149`; `client/transport/consumer.js:149` | **finish**: do not ask a frame whose ask is pending, and add a test. | none | ~3 + test |
| B4 | **On-demand steps race.** Two quick steps both await `cancel()`, then both ask, so "the newest ask alone kept" (`client/README.md:277`) does not hold. A cine faster than the link cancels every ask; not measured. | `client/viewer/viewer.js:143-146,161` | **finish**, with a working `--fill 0` check (F4) | none | ~6 |
| B5 | **The banner's `wt_url` ignores `--bind`.** It always prints `127.0.0.1`, and the harness reads it. | `server/src/transport/server.rs:88,91` | **finish** | none | ~4 |
| B7 | **A gate test fails about 1 run in 12.** `an_opening_ask_rides_the_websocket_upgrade` takes a port that `free_port()` found free for UDP only, and then the server also binds TCP on it. A taken TCP port ends the server with an error, but the test discards that error and fails 5 s later with "server never listened". That is the suspected cause; it is not reproduced. | `server/src/transport/server.rs:919-924,1110-1126`; `websocket.rs:63-75` | **finish**: the test reports the server's own error, and its port is free for both protocols. Mutate it by holding the TCP port. | none | ~10 |
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
| L6 | **The client's build makes a lab artifact.** | `client/transport/ts/build.sh:23` (`lab/telemetry-cost/cost.ts`) | **move to lab** | none | 1 |
| L7 | **Lab levers that stay, as levers:** `--force-pool-reads` (the documented forced miss), `--hold-sessions` and `--stall-after-bytes` (WebKit bugs 319879 and 319818, both tested), `--segmentation-offload false` (netem), `--send-window-follows-cwnd` (a trade-off, with no test of its own), `per-frame-asks-first` (theory only), `--congestion cubic\|bbr\|bbr-bound` (bbr-bound failed its rule; whether to retire it is the owner's call), WebSocket, race and `recycleAtBytes` (the TCP fallback and the iOS recycle). | `server/src/main.rs:27-40`; `tuning.rs:15-21,82-85`; `stream_mode.rs:14`; `docs/levers.md:101,115` | **keep**. Add a test for `--send-window-follows-cwnd` (~30 lines). The five loose lab fields threaded through `ServeConfig`, `Sessions` and `Link::quic` could become one struct, but that is structural: propose it first. | removing any of them loses a lever an open measurement uses, or a fallback | — |

| L8 | **Row 209's lab `FrameCache`** landed after this audit's base (`33a47a54`). It sits behind the `lab-frame-cache` feature, off by default, and the gate compiles it. The server crate takes its source from `lab/` by `#[path]`, under `#[allow(dead_code)]`. | `server/src/media/lab_frame_cache.rs:1-7`; `server/src/media/mod.rs:3-4`; `server/src/transport/pipeline.rs:77-95`; `server/Cargo.toml:19` | **keep** while row 209 measures. Then **remove** it, or move the cache into `server/` if it is adopted. | none | ~−100 if removed |

### 4. Product steps that need `lab/`

| # | item | evidence | verdict | cost | size |
| --- | --- | --- | --- | --- | --- |
| P1 | **The ingest's native coders (aom 3.15.1, dav1d, OpenJPH 0.31.0) are built by lab scripts into lab directories.** OpenJPH's "installer" is a fixture generator, and it needs numpy on the default `python3`. dav1d's build needs `meson`, which README §Prerequisites does not list (meson 1.9.1 was used here). | `ingest/coded-frames/ingest.py:30`; `build.sh:8-9`; `ingest/from-parser/build.rs:7-8`; `README.md:28-29`; `lab/av1/tools/tools.sh` | **finish**: an ingest/tools.sh builds the three pinned coders into a product directory, and lab's `tools.sh` calls it | none | ~60 moved |
| P2 | **The ingest's Python dependencies are pinned in `lab/av1/requirements.txt`**, for CPython 3.11 only (see §Completely functional). | `README.md:23,107`; `scripts/gate.sh:115,122,132` | **finish**: an ingest/requirements.txt that lab's includes, pinned for 3.11–3.13 or with the README saying 3.11 | none | ~10 |
| P3 | **README §The viewer on a DICOM series fails from a fresh clone.** `ingest/coded-frames/build.sh` needs builds that only the comparison's prerequisites make. | `README.md:28-29,106-107`; `docs/FIXTURES.md:55-56` | **finish**, with P1 | none | ~8 |
| P4 | **An HTJ2K-only ingest still needs `aomenc`.** | `ingest/coded-frames/ingest.py:111-115,267,278` | **simplify**: check it for AV1 only | none | ~3 |
| P5 | **Product tests that live in lab.** The split's merge test tests `ingest.py`, and `server_start_test.sh` tests `deploy/server-start.sh`. `make_golden.py` imports a 3-line `splits()` from lab. | `lab/av1/exact/split/merge_test.py:14`; `lab/devices/server_start_test.sh:2,10`; `ingest/coded-frames/make_golden.py:98-100` | **move** them beside what they test, and inline `splits()` | none | ~95 moved |
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
| X4 | the painter's `workerUrl` and `placement`'s export | `client/paint/painter.js:11`; `paint-worker.js:142` | remove | 2 |
| X5 | `client/dev-transport.json.example`, which nothing references | — | remove | 4 |
| X6 | `series-bundle`'s format constants are `pub` but have no user outside the crate | `common/series-bundle/src/format.rs:8-12` | simplify | 4 |

No `TODO`, `FIXME` or `#[ignore]` was found in the product, and only one `#[allow(dead_code)]`: L8's, behind its feature. With the modules private, rustc
flags only L2 and X3, plus `nowait_supported_at`, which `tools/check-fastpath` uses.

### 7. Tests and checks the gate does not run

| # | item | evidence | verdict | size |
| --- | --- | --- | --- | --- |
| F1 | `deploy/check_equivalence.sh`: dev host against nginx (headers, bodies, hidden paths, gzip) | — | **finish**: a gate step with `--local` where nginx is on PATH, named as SKIPPED otherwise | ~5 |
| F2 | `cert-compression` is never built by the gate or the image (ARCHITECTURE §What production adds: −32.3 %) | `server/Cargo.toml:26` | finish: `cargo check --features cert-compression` | 1 |
| F3 | `lab/container-bench` is never compiled. `disk-access-bench` (12 tests) and `telemetry-bench` (3) are compiled but not run. | `scripts/gate.sh:164` | finish: compile all four and run their tests | 1 |
| F4 | the viewer's on-demand mode: `--fill 0` fails (§Completely functional), and the gate does not name it | `client/viewer/check-page.js:20-26`; `check.mjs:111`; `run_check.sh` | **finish**: in on-demand mode the check judges what was asked, then runs `--fill 0` and `--cine` in the gate | ~15 |
| F5 | the gate's real-decode rigs run npm's OpenJPH 2.4.11, not the product's manifest-pinned build | `client/contract/dispatch-rig.ts:654-661,678-803` | finish: also run them on `builtDecoder` | ~10 |
| F6 | the telemetry-absence check reads `session.js` only; `ws-session.js` and `race-session.js` also ship | `client/scripts/check_telemetry_absent.sh:7` | finish | ~3 |
| F7 | DICOM to `.sbnd` end to end (`from_dicom.py main()`); pack-series' "writes the same bytes" (true: re-packing gives identical bytes, 151 B) | `ingest/from-dicom/from_dicom.py:32-60`; `README.md:43` | finish: a synthetic object through the ingest, and a `cmp` | ~25 |
| — | Firefox, the cross-codec arm, the full painter cells, `cellcheck.sh`, `wtcompat.py`, `seccomp-uring.sh --check` | `README.md:92-99` | keep: each is named, and each needs a browser, a display, fixtures or the network | — |

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
