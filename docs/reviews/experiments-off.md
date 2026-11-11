# Experiments off the demo before it reaches `main`

EXPERIMENTS-OFF, 2026-11-11, on `claude/demo-clean` from the demo tip `claude/demo-fixes-1` `daee0d1d`. The owner's
rule (2026-11-11 15:30): `main` never receives experiments, so `claude/core`'s diff against `main` is product only.
Every item below is listed against `main...daee0d1d` (313 files, +32 002 −1 097). Removals are prepared, one commit
per item, and nothing reaches the demo tip until the owner writes yes in the last column; FIX-2 merges those only.
Nothing is deleted anywhere else: every branch and tag named here stays.

**Where an item lives after.** On its line branch, at a commit shown to carry it byte for byte (the folder's git tree
hash equal to the demo tip's). No `archive/<name>` tag is created here: the queue lets this row push only its own
branch, and `scripts/check_links.py` refuses a cited tag that does not exist on origin. Each removal pins its doc
links to that commit instead, as `docs/adr/frame-path.md` already does for rows kept off the tree. If the owner
wants names that cannot move, the tags are one command each (the column *proposed tag*), and docs/archive.md would hold their
index lines (`docs/lines/coordination.md` §Open 4 names it as the candidate).

**What proves the product unchanged.** No product path imports any removed file (`git grep`, 2026-11-11); the full
`scripts/gate.sh` on the branch's tip (§3); `scripts/check_links.py` 0 unresolved after each commit. The demo check
(`client/viewer/demo-check.mjs`) loads no file under `lab/`; it was not run here: it needs the demo's twenty series built, which E2E-3 and DEMO-UX run.

## 1. Removals prepared on `claude/demo-clean`

| # | item | lines | needed by a running line or row | lives after (byte for byte) | proposed tag, under archive/ | commit | owner |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `lab/target-review/`, three throwaway probes ("indicative only, not claims", its README) | −1 015 | no | `claude/view-worker-target-rev` `7f335cc0` | target-review-2026-10 | `adc69a37` | |
| 2 | `lab/recv-loop/`, the receive loop's rig (`docs/adr/frame-path.md`, needs a GPU host) | −527 | no | `claude/recv-loop` `cf38708b` | recv-loop-2026-10 | `45aff07c` | |
| 3 | `lab/opfs-arms/`, the OPFS writer arms (concluded in `frame-path.md`) | −750 | no | `claude/core-fold-2026-11-02` `0920153d` | opfs-arms-2026-10 | `35d05b14` | |
| 4 | `lab/native-fill/`, `lab/scripts/native_cache_cells.sh`, native M2 and cache runs | −507 | no | `0920153d`; `claude/native-cache` `a237cf3e` | native-runs-2026-10 | `3a4a5922` | |
| 5 | `lab/paint-read/`, the busy-page pixel-read probe, and its gate line | −388 | no | `0920153d` | paint-read-2026-10 | `614033bd` | |
| 6 | `lab/av1/decode/{breakdown,merge-free,passes}/`, 38 files (the brief's L1; CLEAN-FIND 5) | −3 132 | no | `claude/av1-unified-mainbase` `696c15d6` | av1-decode-passes-2026-10 | `05eab56b` | |
| 7 | `lab/viewer/`'s settle, view and wait-ahead runs and summaries, `want-model.mjs`, three gate lines | −763 | no | `0920153d` | viewer-runs-2026-10 | `d1aa8c60` | |
| 8 | `lab/opfs-cache/`'s M1–M5 harness (arms, reopen, run, summaries, one gate line); `browser.mjs` stays (item 12) | −1 125 | no | `0920153d` | opfs-cache-2026-10 | `13f1edb7` | |
| 9 | `lab/README.md`: the rows of items 4 and 5 | −2 | goes with 4 and 5 | — | — | `b0d8381a` | |

Total: −8 273 lines in 110 files; `main...claude/demo-clean` is +23 774 −1 097 in 210 files. "Running" is read
from the queue's status files at 16:50 UTC (DEMO-UX, MEASURE-1, PHONE-RUN started): none of their branches touched
these paths since 11-09, and no queue row names one. Each line branch keeps its copy whatever is merged.
A tag, if wanted: `git tag archive/<name> <commit> && git push origin archive/<name>`.

## 2. Listed, not prepared

| # | item | lines | product or experiment | why not prepared | owner |
| --- | --- | --- | --- | --- | --- |
| 10 | `client/native/` (raw-QUIC client, wgpu painter, window), its workspace membership, `deploy/Containerfile`'s copy, `client/paint/{native,window,cells}.mjs`, `lab/fixtures/window_*`, the gate's native steps | +3 303 and ~400 | **product**, of the native line: "a native client … computers first, phones the end", built on the owner's decision of 2026-10-26 (`docs/lines/native.md` §Goal, §Decisions); not an experiment, but not the demo's product, not in the web image, and its shape is open (§Open 2) | not an experiment, so the rule does not take it off; removing it touches the workspace, the lockfile, the image build, the server's `wt-pacs/1` ALPN and the gate. If the owner wants it off `main` until `docs/native/README.md` §7 is decided, a row prepares it (size not estimated here; the server's ALPN stays or goes with it) | keep / off |
| 11 | `lab/frame-clock/` | +672 | experiment (the frame clock) | `lab/viewer/levers.js`, which the page's `head.js` loads where `lab/` is served, imports `busy.js` and `phase.js`; `lab/av1/delivery/total-time/run.mjs` (the nightly's harness) imports `measure.js`. Goes with item 13 | |
| 12 | `lab/opfs-cache/browser.mjs` and its test, the Firefox driver | +206 | test tooling | `client/paint/settle-check.mjs` (gate) imports it; moving it under `client/paint/` is a move, not a removal | move / keep |
| 13 | Lab levers and check hooks in product modules: `viewer.js` (~110 of 334 lines), five lab settings through `ViewWorker`/`Painter` signatures, `onePass`/`reuseCopyBuffer` and other decoder flags, `lab/viewer/levers.js`'s growth (+71) and `trace.js`, `start-summary.mjs` (CLEAN-FIND 1–3; DEFAULTS-FIND 1–3) | ~200 in product files | product hooks for experiments | a refactor of the demo's page and view worker, not a removal; CLEAN-FIND rates it medium risk before 11-13, after FREEZE-E2E | after the demo / now |
| 14 | The web image ships `viewer/check-page.js` and `view/check.js`, so `?check=1` runs in production (CLEAN-FIND 4, DEFAULTS-FIND 1) | 2 entries | test code in the product image | `viewer.js` names both modules, so `deploy/web-files_test.sh` fails without them; it needs item 13's hooks module first | |
| 15 | `--send-window-follows-cwnd`, `--reply-repeated-initial`, `--stream-mode per-frame-asks-first` in the default `series-server` build (DEFAULTS-FIND 5) | ~30 | lab levers | a server change behind the `lab-levers` feature, with its own failing test; not a removal | |
| 16 | Six `lab/` crates in the workspace, copied by `deploy/Containerfile` (CLEAN-FIND 6) | manifests | lab, already on `main` | on `main` already, not in this diff; `lab-frame-cache` `#[path]`-includes a lab crate | |

## 3. Kept as product or as `main`'s own lab

* `lab/av1/tools/ingest_coded.py` (+29 −8): `scripts/demo-series.sh` and `ingest/coded-frames/README.md` make the
  demo's series with it. `lab/server-telemetry/src/path.rs` (+3 −3): the `telemetry` feature's path line, which
  PHONE-AMEND's controller arm reads. `lab/av1/delivery/total-time/` (+132 −21) and `scripts/perf_campaign.mjs`:
  the nightly (`scripts/perf_nightly.mjs`, `.github/workflows/perf-nightly.yml`) runs them.
  `lab/av1/bytes/*/README.md`, `lab/container-bench/run.py`: edits to `main`'s own lab, one line to a study's text.
* `client/decode/wasm/built/` (committed decoders), `client/contract/av1/payloads/depth-cut/` (test payloads),
  `docs/` (where every number lives), `docs/reviews/` (the demo's review records): product, or the record of it.

## 4. The gate

See the queue's status file for this row (docs/queue/EXPERIMENTS-OFF.md on `claude/work-ledger`) for the run on this branch's
tip; it is copied here when it lands.

Fixtures: none timed; nothing here measures. Read from one commit (`daee0d1d`) and its git history; a 4-core cloud
host without a GPU.
