# MERGE-BASELINE: today's tips, measured before any merge

Row MERGE-BASELINE of `docs/queue-merge-2026-11-15.md`. Started 2026-11-15T12:48Z. Host: one 4-core cloud
container, no GPU, headless Chromium (playwright 1.63.0 preinstalled, not README's 1.56.1). Fixtures: the repository's
committed ones for the gate; `dbts_a1` alone (of the three timed DBT volumes) for `demo-check.mjs`.

## Summary (what a merge review compares against)

| tip | commit | full gate | steps | `series-server` tests, default / telemetry | default build warnings | lab absent | web image |
| --- | --- | --- | ---: | --- | ---: | --- | --- |
| `unified-client` | `e5b20cba8d` | OK, 782 s | 53 | 134 / 137 | 1 | OK | 94,942,938 B |
| `unified-codecs` | `9c050c073b` | OK, 331 s | 37 | 135 / 138 | 1 | not on tip | 94,837,844 B |
| `unified-server` | `b9abdc290f` | OK, 328 s | 38 | 140 / 143 | 1 | not on tip | 94,837,296 B |
| `unified-pacs` | `7afeb9cac2` | OK, 486 s (4th attempt; see its section) | 41 | 151 / 154 | 1 | not on tip | not built here |
| `line-hygiene` | `8d5112fd74` | OK, 407 s | 38 | 130 / 133 | 0 | not on tip | 94,842,850 B |

`demo-check.mjs` on `unified-client`, `dbts_a1-q8-g8-cut`: passed in both views. The one warning is tokio's
`AsyncFd::with_interest` deprecation in `server/src/media/uring_reader.rs:41`. The comment budget passes on every tip.
The server image builds on no tip here (this container's proxy refuses Debian's plain-HTTP apt): its size is not
measured. The gate's durations are one run each on a shared host, not a measurement.

**Host limits a review on the same kind of host must expect.** (1) One `CARGO_TARGET_DIR` shared by worktrees of
different tips serves a worktree stale artifacts of another tip (cargo hashes path crates relative to the workspace,
so the crates of two worktrees collide; it rebuilds only when sources are newer than the last build): a run that
voided two gates and one count here. Use a target dir per worktree. (2) The session's disk allowance holds about two
tips' debug targets: one ran out mid-gate (a linker bus error). (3) The proxy listens on a local port the gate can
draw at random (36853 here). (4) Docker Hub answered 429 after the build cache was pruned. (5) Firefox is not
installed: the gate's Firefox steps are skipped by name on every tip.

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
| deploy image, `server` target | not built here: its `apt-get update` exits 100 — this container's proxy refuses plain-HTTP apt (405) | `docker build -f deploy/Containerfile --target server` (BuildKit, --network host, the proxy's CA as build_ca) |
| deploy image, `web` target | 94.9 MB (94942938 bytes) | `docker build -f deploy/Containerfile --target web` (BuildKit, --network host, the proxy's CA as build_ca) |

Test counts, each `cargo test` line of the gate run again without `--quiet`:

| gate line | tests |
| --- | --- |
| `cargo test -p fod -p frame-envelope -p series-bundle -p pack-series -p check-fastpath --quiet` | 20 passed, 0 failed, 0 ignored |
| `cargo test -p from-parser --quiet` | 2 passed, 0 failed, 0 ignored |
| `cargo test -p native-client --features decode --quiet -- decode:: view::` | 11 passed, 0 failed, 0 ignored |
| `cargo test -p native-client --quiet` | 16 passed, 0 failed, 1 ignored |
| `cargo test -p series-server --features lab-classify --quiet -- classify` | 2 passed, 0 failed, 0 ignored |
| `cargo test -p series-server --features lab-levers --quiet -- held stalled lab_lever` | 5 passed, 0 failed, 0 ignored |
| `cargo test -p series-server --features telemetry --quiet -- --nocapture` | 137 passed, 0 failed, 0 ignored |
| `cargo test -p series-server --quiet -- --nocapture` | 134 passed, 0 failed, 0 ignored |
| `cargo test -p window-harness -p disk-access-bench -p telemetry-bench -p container-bench -p cc-classify -p server-telemetry --quiet` | 68 passed, 0 failed, 0 ignored |
| `env VK_ICD_FILENAMES="$lvp" cargo test -p native-client --features paint --lib --quiet paint::` | 2 passed, 0 failed, 0 ignored |

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

### `claude/unified-codecs` at `9c050c073b`

| measure | result | command |
| --- | --- | --- |
| builds | transport WASM 0, decode WASM 0, ingest tools 0 (exit codes) | `client/transport/wasm/build.sh`, `client/decode/wasm/build/build.sh`, `ingest/tools.sh` |
| full gate | GATE OK in 331 s; 37 steps | `PYTHON=python3.13 scripts/gate.sh` |
| gate's skips | the viewer's cross-codec arm and Firefox — they need the DICOM ingest's bundles and a GL display (client/README.md §The viewer) | the gate's recap, and its in-step `skipped:` lines |
| default `cargo build` warnings | 1 (use of deprecated associated function `tokio::io::unix::Async) | `cargo build` |
| `scripts/check_lab_absent.sh` | not on this tip | as named |
| `scripts/comment_budget.sh` | exit 0: comment budget ok | as named |
| deploy image, `server` target | not built here: its `apt-get update` exits 100 — this container's proxy refuses plain-HTTP apt (405) | `docker build -f deploy/Containerfile --target server` (BuildKit, --network host, the proxy's CA as build_ca) |
| deploy image, `web` target | 94.8 MB (94837844 bytes) | `docker build -f deploy/Containerfile --target web` (BuildKit, --network host, the proxy's CA as build_ca) |

Test counts, each `cargo test` line of the gate run again without `--quiet`:

| gate line | tests |
| --- | --- |
| `cargo test -p fod -p frame-envelope -p series-bundle -p pack-series -p check-fastpath --quiet` | 19 passed, 0 failed, 0 ignored |
| `cargo test -p from-parser --quiet` | 2 passed, 0 failed, 0 ignored |
| `cargo test -p series-server --features lab-classify --quiet -- classify` | 2 passed, 0 failed, 0 ignored |
| `cargo test -p series-server --features lab-levers --quiet -- held stalled lab_lever` | 5 passed, 0 failed, 0 ignored |
| `cargo test -p series-server --features telemetry --quiet -- --nocapture` | 138 passed, 0 failed, 0 ignored |
| `cargo test -p series-server --quiet -- --nocapture` | 135 passed, 0 failed, 0 ignored |
| `cargo test -p window-harness -p disk-access-bench -p telemetry-bench -p container-bench -p cc-classify -p server-telemetry --quiet` | 68 passed, 0 failed, 0 ignored |

The JavaScript and Python suites as the gate printed them (its `run 1` keeps a step's last line):

    (×6) all tests passed
    ask-during-fill (downloader): 3/3 checks passed
    ask-during-fill (downloader-wasm): 3/3 checks passed
    ask-during-fill (downloader-ws): 3/3 checks passed
    ask-during-fill (ts): 3/3 checks passed
    ask-during-fill (wasm): 3/3 checks passed
    ask-during-fill (ws): 3/3 checks passed
    contract over ts: 58/58 checks passed through the downloader
    contract over wasm: 58/58 checks passed through the downloader
    contract: 238/238 checks passed across 3 implementations and the race; 4 not applicable
    dispatch over ts: 789/789 checks passed through the downloader
    dispatch over wasm: 102/102 checks passed through the downloader
    order: all passed
    provenance: 17/17 cases
    refusals (ts): 64/64 refused with the server's reason, none lost
    refusals (wasm): 64/64 refused with the server's reason, none lost
    refusals (ws): 64/64 refused with the server's reason, none lost
    voi: 12/12 passed
    writer's split and merge: 142/142 cells exact, 20 with a top over 12 bits refused by name, as are 17 bits, k = 9 and a default over 14 bits

### `claude/unified-server` at `b9abdc290f`

| measure | result | command |
| --- | --- | --- |
| builds | transport WASM 0, decode WASM 0, ingest tools 0 (exit codes) | `client/transport/wasm/build.sh`, `client/decode/wasm/build/build.sh`, `ingest/tools.sh` |
| full gate | GATE OK in 328 s; 38 steps | `PYTHON=python3.13 scripts/gate.sh` |
| gate's skips | the viewer's cross-codec arm and Firefox — they need the DICOM ingest's bundles and a GL display (client/README.md §The viewer) | the gate's recap, and its in-step `skipped:` lines |
| default `cargo build` warnings | 1 (use of deprecated associated function `tokio::io::unix::Async) | `cargo build` |
| `scripts/check_lab_absent.sh` | not on this tip | as named |
| `scripts/comment_budget.sh` | exit 0: comment budget ok | as named |
| deploy image, `server` target | not built here: its `apt-get update` exits 100 — this container's proxy refuses plain-HTTP apt (405) | `docker build -f deploy/Containerfile --target server` (BuildKit, --network host, the proxy's CA as build_ca) |
| deploy image, `web` target | 94.8 MB (94837296 bytes) | `docker build -f deploy/Containerfile --target web` (BuildKit, --network host, the proxy's CA as build_ca) |

Test counts, each `cargo test` line of the gate run again without `--quiet`:

| gate line | tests |
| --- | --- |
| `cargo test -p fod -p frame-envelope -p series-bundle -p pack-series -p check-fastpath --quiet` | 19 passed, 0 failed, 0 ignored |
| `cargo test -p from-parser --quiet` | 2 passed, 0 failed, 0 ignored |
| `cargo test -p series-server --features lab-classify --quiet -- classify` | 2 passed, 0 failed, 0 ignored |
| `cargo test -p series-server --features lab-levers --quiet -- held stalled lab_lever` | 5 passed, 0 failed, 0 ignored |
| `cargo test -p series-server --features telemetry --quiet -- --nocapture` | 143 passed, 0 failed, 0 ignored |
| `cargo test -p series-server --quiet -- --nocapture` | 140 passed, 0 failed, 0 ignored |
| `cargo test -p window-harness -p disk-access-bench -p telemetry-bench -p container-bench -p cc-classify -p server-telemetry --quiet` | 68 passed, 0 failed, 0 ignored |

The JavaScript and Python suites as the gate printed them (its `run 1` keeps a step's last line):

    (×6) all tests passed
    ask-during-fill (downloader): 3/3 checks passed
    ask-during-fill (downloader-wasm): 3/3 checks passed
    ask-during-fill (downloader-ws): 3/3 checks passed
    ask-during-fill (ts): 3/3 checks passed
    ask-during-fill (wasm): 3/3 checks passed
    ask-during-fill (ws): 3/3 checks passed
    contract over ts: 58/58 checks passed through the downloader
    contract over wasm: 58/58 checks passed through the downloader
    contract: 238/238 checks passed across 3 implementations and the race; 4 not applicable
    dispatch over ts: 789/789 checks passed through the downloader
    dispatch over wasm: 102/102 checks passed through the downloader
    order: all passed
    provenance: 17/17 cases
    refusals (ts): 64/64 refused with the server's reason, none lost
    refusals (wasm): 64/64 refused with the server's reason, none lost
    refusals (ws): 64/64 refused with the server's reason, none lost
    voi: 12/12 passed
    writer's split and merge: 142/142 cells exact, 20 with a top over 12 bits refused by name, as are 17 bits, k = 9 and a default over 14 bits

### `claude/unified-pacs` at `7afeb9cac2`

| measure | result | command |
| --- | --- | --- |
| builds | transport WASM 0, decode WASM 0, ingest tools 0 (exit codes) | `client/transport/wasm/build.sh`, `client/decode/wasm/build/build.sh`, `ingest/tools.sh` |
| full gate | GATE OK in 486 s; 41 steps | `PYTHON=python3.13 scripts/gate.sh` |
| gate's skips | the viewer's cross-codec arm and Firefox — they need the DICOM ingest's bundles and a GL display (client/README.md §The viewer) | the gate's recap, and its in-step `skipped:` lines |
| default `cargo build` warnings | 1 (use of deprecated associated function `tokio::io::unix::Async) | `cargo build` |
| `scripts/check_lab_absent.sh` | not on this tip | as named |
| `scripts/comment_budget.sh` | exit 0: comment budget ok | as named |
| deploy image, `server` target | not built here: its `apt-get update` exits 100 — this container's proxy refuses plain-HTTP apt (405) | `docker build -f deploy/Containerfile --target server` (BuildKit, --network host, the proxy's CA as build_ca) |
| deploy image, `web` target | not built here: its `client/transport/wasm/build.sh` step exited 1 (output hidden by `-q`); the retry with `--progress=plain` hit Docker Hub's 429 | `docker build -f deploy/Containerfile --target web` (BuildKit, --network host, the proxy's CA as build_ca) |

Test counts, each `cargo test` line of the gate run again without `--quiet`:

| gate line | tests |
| --- | --- |
| `cargo test -p carrier --features quic --quiet` | 18 passed, 0 failed, 0 ignored |
| `cargo test -p carrier --quiet` | 17 passed, 0 failed, 0 ignored |
| `cargo test -p fod -p frame-envelope -p from-disk -p series-bundle -p study-db -p pack-series -p check-fastpath -p pacs-verify --quiet` | 41 passed, 0 failed, 0 ignored |
| `cargo test -p from-parser --quiet` | 2 passed, 0 failed, 0 ignored |
| `cargo test -p pacs-receiver --quiet -- --nocapture` | 49 passed, 0 failed, 0 ignored |
| `cargo test -p sender --quiet` | 11 passed, 0 failed, 0 ignored |
| `cargo test -p series-server --features lab-classify --quiet -- classify` | 2 passed, 0 failed, 0 ignored |
| `cargo test -p series-server --features lab-levers --quiet -- held stalled lab_lever` | 5 passed, 0 failed, 0 ignored |
| `cargo test -p series-server --features telemetry --quiet -- --nocapture` | 154 passed, 0 failed, 0 ignored |
| `cargo test -p series-server --quiet -- --nocapture` | 151 passed, 0 failed, 0 ignored |
| `cargo test -p window-harness -p disk-access-bench -p telemetry-bench -p container-bench -p cc-classify -p server-telemetry -p metadata-store --quiet` | 77 passed, 0 failed, 0 ignored |

The JavaScript and Python suites as the gate printed them (its `run 1` keeps a step's last line):

    (×6) all tests passed
    ask-during-fill (downloader): 3/3 checks passed
    ask-during-fill (downloader-wasm): 3/3 checks passed
    ask-during-fill (downloader-ws): 3/3 checks passed
    ask-during-fill (ts): 3/3 checks passed
    ask-during-fill (wasm): 3/3 checks passed
    ask-during-fill (ws): 3/3 checks passed
    contract over ts: 58/58 checks passed through the downloader
    contract over wasm: 58/58 checks passed through the downloader
    contract: 244/244 checks passed across 3 implementations and the race; 4 not applicable
    dispatch over ts: 789/789 checks passed through the downloader
    dispatch over wasm: 102/102 checks passed through the downloader
    order: all passed
    provenance: 17/17 cases
    refusals (ts): 64/64 refused with the server's reason, none lost
    refusals (wasm): 64/64 refused with the server's reason, none lost
    refusals (ws): 64/64 refused with the server's reason, none lost
    voi: 12/12 passed
    writer's split and merge: 142/142 cells exact, 20 with a top over 12 bits refused by name, as are 17 bits, k = 9 and a default over 14 bits

The full gate above is the fourth on this tip; all four, same commit, each log beside this report:

| attempt | target dir | result |
| --- | --- | --- |
| 1 (13:33) | shared, fresh worktree | **failed** at the viewer's page check: "the ts client's /client/transport/ts/dist/session.js is not in the request log" on the on-demand pass, every other pass of the check passing (`unified-pacs-gate-attempt1.log`); the no-browser gate then passed |
| 2 (13:50) | shared, reused worktree | void: stale artifacts of another tip (see below); it failed two WASM refusal checks of the contract |
| 3 (14:10) | its own | **failed** at the perf counts: the server's WebSocket port was this container's proxy port (36853, address in use), every browser step passing before it (`unified-pacs-gate-attempt3.log`) |
| 4 (14:37) | its own | **GATE OK in 486 s** |

Attempt 3 is this host's. Attempt 1 is not explained: one failure in two valid runs of the viewer check on this tip,
none on the other four tips. A review that sees it again should rerun before calling it a regression.

### `claude/line-hygiene` at `8d5112fd74`

| measure | result | command |
| --- | --- | --- |
| builds | transport WASM 0, decode WASM 0, ingest tools 0 (exit codes) | `client/transport/wasm/build.sh`, `client/decode/wasm/build/build.sh`, `ingest/tools.sh` |
| full gate | GATE OK in 407 s; 38 steps | `PYTHON=python3.13 scripts/gate.sh` |
| gate's skips | the viewer's cross-codec arm and Firefox — they need the DICOM ingest's bundles and a GL display (client/README.md §The viewer) | the gate's recap, and its in-step `skipped:` lines |
| default `cargo build` warnings | 0 () | `cargo build` |
| `scripts/check_lab_absent.sh` | not on this tip | as named |
| `scripts/comment_budget.sh` | exit 0: comment budget ok | as named |
| deploy image, `server` target | not built here: its `apt-get update` exits 100 — this container's proxy refuses plain-HTTP apt (405) | `docker build -f deploy/Containerfile --target server` (BuildKit, --network host, the proxy's CA as build_ca) |
| deploy image, `web` target | 94.8 MB (94842850 bytes) | `docker build -f deploy/Containerfile --target web` (BuildKit, --network host, the proxy's CA as build_ca) |

Test counts, each `cargo test` line of the gate run again without `--quiet`:

| gate line | tests |
| --- | --- |
| `cargo test -p fod -p frame-envelope -p series-bundle -p pack-series -p check-fastpath --quiet` | 19 passed, 0 failed, 0 ignored |
| `cargo test -p from-parser --quiet` | 2 passed, 0 failed, 0 ignored |
| `cargo test -p series-server --features lab-classify --quiet -- classify` | 2 passed, 0 failed, 0 ignored |
| `cargo test -p series-server --features lab-levers --quiet` | 140 passed, 0 failed, 0 ignored |
| `cargo test -p series-server --features telemetry --quiet -- --nocapture` | 133 passed, 0 failed, 0 ignored |
| `cargo test -p series-server --quiet -- --nocapture` | 130 passed, 0 failed, 0 ignored |
| `cargo test -p window-harness -p disk-access-bench -p telemetry-bench -p container-bench -p cc-classify -p server-telemetry --quiet` | 68 passed, 0 failed, 0 ignored |

The JavaScript and Python suites as the gate printed them (its `run 1` keeps a step's last line):

    (×6) all tests passed
    ask-during-fill (downloader): 3/3 checks passed
    ask-during-fill (downloader-wasm): 3/3 checks passed
    ask-during-fill (downloader-ws): 3/3 checks passed
    ask-during-fill (ts): 3/3 checks passed
    ask-during-fill (wasm): 3/3 checks passed
    ask-during-fill (ws): 3/3 checks passed
    contract over ts: 58/58 checks passed through the downloader
    contract over wasm: 58/58 checks passed through the downloader
    contract: 238/238 checks passed across 3 implementations and the race; 4 not applicable
    dispatch over ts: 789/789 checks passed through the downloader
    dispatch over wasm: 102/102 checks passed through the downloader
    order: all passed
    provenance: 17/17 cases
    refusals (ts): 64/64 refused with the server's reason, none lost
    refusals (wasm): 64/64 refused with the server's reason, none lost
    refusals (ws): 64/64 refused with the server's reason, none lost
    voi: 12/12 passed
    writer's split and merge: 142/142 cells exact, 20 with a top over 12 bits refused by name, as are 17 bits, k = 9 and a default over 14 bits

### `demo-check.mjs` on `claude/unified-client`

Fixture: `dbts_a1` alone (56 frames 1142×1785, 12-bit stored), fetched by `lab/av1/fetch_data.sh` and coded by
`scripts/demo-series.sh`'s own `ingest` steps for two of its series (`demo.sh` beside this report): the exact series
`dbts_a1` (67,815,143 bytes) and `dbts_a1-q8-g8-cut` (4,642,293 bytes; README's table: 67,815,186 and 4,642,336, 43 bytes
more each). `cargo build --release -p series-server` first (README §Before the demo). Not run: the other 19 demo
series, `--refuse-webcodecs`, `--link`.

| view | result | command |
| --- | --- | --- |
| page | passed: fill first picture 418 ms, 56 frames by 1527 ms; on demand first picture 197 ms | `node client/viewer/demo-check.mjs DIR dbts_a1-q8-g8-cut --view page` |
| worker | passed: fill first picture 327 ms, 56 frames by 1564 ms; on demand first picture 230 ms | `… --view worker` |

Timings are one run each on a shared 4-core host, quoted only as the check printed them, not as a measurement.
