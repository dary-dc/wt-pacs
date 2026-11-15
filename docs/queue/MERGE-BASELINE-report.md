# MERGE-BASELINE: today's tips, measured before any merge

Row MERGE-BASELINE of `docs/queue-merge-2026-11-15.md`. Started 2026-11-15T12:48Z. Host: one 4-core cloud
container, no GPU, headless Chromium (playwright 1.63.0 preinstalled, not README's 1.56.1). Fixtures: the repository's
committed ones for the gate; `dbts_a1` alone (of the three timed DBT volumes) for `demo-check.mjs`.

## Static measures (read with git, no checkout)

Commands: `docs/queue/MERGE-BASELINE/measure.sh REF` (the gate run: `tip.sh BRANCH` beside it) — non-blank lines of tracked files ending .rs .ts .js .mjs .cjs .sh .py .cpp .cc .c .h
.hpp .go .wgsl .html .css, with dist/, built/, pkg/, node_modules/ and package-lock.json excluded; docs/ counts .md lines.
URL parameters: `q.get("…")`/`q.has("…")` (and params/searchParams) in client/ outside native/, contract/, tests and
check pages; head.js's lab gate list is not counted as product. Features: `[features]` keys of the non-lab workspace
members, `default` excluded. Server levers: `LabLevers`' fields.

### `claude/unified-client` at `e5b20cba8d`

| path | non-blank code lines |
| --- | ---: |
| server/ | 6977 |
| client/ without client/native/ | 15709 |
| client/native/ | 3005 |
| ingest/ | 1976 |
| deploy/ | 305 |
| scripts/ | 1666 |
| lab/ | 62303 |
| docs/ (all .md lines, blank excluded) | 33674 |

* URL parameters the product's client reads (3): fill overlay view 
* URL parameters lab/viewer/ reads, behind head.js's lab gate (17): after busy check cine deadline fill hash metadata mutate opts origin post settle trace view writer wt 
* Cargo features of the product crates, default excluded (10):server:telemetry server:lab-frame-cache server:lab-levers server:lab-classify server:uring server:cert-compression client/native:decode client/native:paint client/native:window client/transport/wasm:console_error
* Server lab levers, LabLevers' fields under lab-levers (6): force_pool_reads hold_sessions stall_after_bytes segmentation_offload send_window_follows_cwnd reply_repeated_initial 

### `claude/unified-codecs` at `9c050c073b`

| path | non-blank code lines |
| --- | ---: |
| server/ | 6764 |
| client/ without client/native/ | 11496 |
| client/native/ | 0 |
| ingest/ | 1688 |
| deploy/ | 270 |
| scripts/ | 1347 |
| lab/ | 62741 |
| docs/ (all .md lines, blank excluded) | 28666 |

* URL parameters the product's client reads (3): check deadline fill 
* URL parameters lab/viewer/ reads, behind head.js's lab gate (6): hash metadata opts origin post wt 
* Cargo features of the product crates, default excluded (7):server:telemetry server:lab-frame-cache server:lab-levers server:lab-classify server:uring server:cert-compression client/transport/wasm:console_error
* Server lab levers, LabLevers' fields under lab-levers (4): force_pool_reads hold_sessions stall_after_bytes segmentation_offload 

### `claude/unified-server` at `b9abdc290f`

| path | non-blank code lines |
| --- | ---: |
| server/ | 6959 |
| client/ without client/native/ | 11229 |
| client/native/ | 0 |
| ingest/ | 1673 |
| deploy/ | 270 |
| scripts/ | 1349 |
| lab/ | 61349 |
| docs/ (all .md lines, blank excluded) | 27759 |

* URL parameters the product's client reads (3): check deadline fill 
* URL parameters lab/viewer/ reads, behind head.js's lab gate (6): hash metadata opts origin post wt 
* Cargo features of the product crates, default excluded (7):server:telemetry server:lab-frame-cache server:lab-levers server:lab-classify server:uring server:cert-compression client/transport/wasm:console_error
* Server lab levers, LabLevers' fields under lab-levers (5): force_pool_reads hold_sessions stall_after_bytes segmentation_offload advise_tile_names 

### `claude/unified-pacs` at `7afeb9cac2`

| path | non-blank code lines |
| --- | ---: |
| server/ | 7324 |
| client/ without client/native/ | 11278 |
| client/native/ | 0 |
| ingest/ | 4868 |
| deploy/ | 270 |
| scripts/ | 1355 |
| lab/ | 74859 |
| docs/ (all .md lines, blank excluded) | 36422 |

* URL parameters the product's client reads (3): check deadline fill 
* URL parameters lab/viewer/ reads, behind head.js's lab gate (6): hash metadata opts origin post wt 
* Cargo features of the product crates, default excluded (8):server:telemetry server:lab-frame-cache server:lab-levers server:lab-classify server:uring server:cert-compression carrier:quic client/transport/wasm:console_error
* Server lab levers, LabLevers' fields under lab-levers (4): force_pool_reads hold_sessions stall_after_bytes segmentation_offload 

### `claude/line-hygiene` at `8d5112fd74`

| path | non-blank code lines |
| --- | ---: |
| server/ | 6919 |
| client/ without client/native/ | 11240 |
| client/native/ | 0 |
| ingest/ | 1672 |
| deploy/ | 430 |
| scripts/ | 1369 |
| lab/ | 60803 |
| docs/ (all .md lines, blank excluded) | 27616 |

* URL parameters the product's client reads (3): check deadline fill 
* URL parameters lab/viewer/ reads, behind head.js's lab gate (6): hash metadata opts origin post wt 
* Cargo features of the product crates, default excluded (7):server:telemetry server:lab-frame-cache server:lab-levers server:lab-classify server:uring server:cert-compression client/transport/wasm:console_error
* Server lab levers, LabLevers' fields under lab-levers (5): force_pool_reads hold_sessions stall_after_bytes segmentation_offload send_window_follows_cwnd 
## Runs

Each tip in its own detached worktree, one after another on one host, one cargo target directory shared; scripts
in `docs/queue/MERGE-BASELINE/` (`tip.sh` the run, `counts.sh` the test counts, `section.sh` this table); each
gate's log beside them as `<tip>-gate.log`. Before the runs, per README §Prerequisites and its cloud lines: dockerd
started, `pip install meson==1.9.1` and `ingest/requirements.txt` (`PYTHON=python3.13`), `rustup target add
wasm32-unknown-unknown`, `cargo install wasm-pack --version 0.15.0 --locked`, apt `nginx mesa-vulkan-drivers xdotool
libxkbcommon-x11-0 strace`; the decoder vendor fetched per tip. Not installed: Firefox (`FIREFOX_PATH`).

### `claude/unified-client` at `e5b20cba8d`

| measure | result | command |
| --- | --- | --- |
| builds | transport WASM 0, decode WASM 0, ingest tools 0 (exit codes) | `client/transport/wasm/build.sh`, `client/decode/wasm/build/build.sh`, `ingest/tools.sh` |
| full gate | GATE OK in 782 s; 53 steps | `PYTHON=python3.13 scripts/gate.sh` |
| gate's skips | nested workers under the driver — no FIREFOX_PATH; the viewer's cross-codec arm and Firefox — they need the DICOM ingest's bundles and a GL display (client/README.md §The viewer) | the gate's recap, and its in-step `skipped:` lines |
| default `cargo build` warnings | 1 (use of deprecated associated function `tokio::io::unix::Async) | `cargo build` |
| `scripts/check_lab_absent.sh` | exit 0: OK: no lab crate, source or module in the images or the default build; lab/ only through h | as named |
| `scripts/comment_budget.sh` | exit 0: comment budget ok | as named |
| deploy image, `server` target | not built here: /bin/sh -c apt-get update && apt-get install -y --no-install… exit 100 — the container's proxy refuses plain-HTTP apt (405) | `docker build -f deploy/Containerfile --target server` (BuildKit, --network host, the proxy's CA as build_ca) |
| deploy image, `web` target | 94.9 MB (94942938 bytes) | `docker build -f deploy/Containerfile --target web` (BuildKit, --network host, the proxy's CA as build_ca) |

The JavaScript and Python suites as the gate printed them (its `run 1` keeps a step's last line):

    (×6) all tests passed
    ask-during-fill (downloader): 3/3 checks passed
    ask-during-fill (downloader-wasm): 3/3 checks passed
    ask-during-fill (downloader-ws): 3/3 checks passed
    ask-during-fill (ts): 3/3 checks passed
    ask-during-fill (wasm): 3/3 checks passed
    ask-during-fill (ws): 3/3 checks passed
    cache: 4/4 passed
    clock: 6/6 passed
    contract over ts: 58/58 checks passed through the downloader
    contract over wasm: 58/58 checks passed through the downloader
    contract: 238/238 checks passed across 3 implementations and the race; 4 not applicable
    controller: 37/37 passed
    dispatch over ts: 789/789 checks passed through the downloader
    dispatch over wasm: 102/102 checks passed through the downloader
    frame-clock arms: 4/4 passed
    frame-clock measure: 11/11 passed
    order: all passed
    provenance: 17/17 cases
    refusals (ts): 64/64 refused with the server's reason, none lost
    refusals (wasm): 64/64 refused with the server's reason, none lost
    refusals (ws): 64/64 refused with the server's reason, none lost
    view worker: 2/2 passed
    view: 11/11 passed
    voi: 15/15 passed
    writer's split and merge: 142/142 cells exact, 20 with a top over 12 bits refused by name, as are 17 bits, k = 9 and a default over 14 bits
