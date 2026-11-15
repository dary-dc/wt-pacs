Stage B of the unification, row MERGE-B of `claude/work-ledger:docs/queue-merge-2026-11-15.md`: the reviewed line branches merged into one branch, `claude/unified`, which starts at `claude/merge-a-client` `4520a441` (PR 401, reviewed, no blocker). **Do not merge.** This PR into `main` exists to be reviewed (MERGE-B-REVIEW, by a session that merged nothing here). Merging, retargeting and closing are the owner's. The line doc this answers to is `docs/lines/coordination.md` (Open 8).

## The merges

Each one is `git merge --no-ff`. Each message names the source and its tip, every file that conflicted, and why it was resolved that way.

| # | merge | conflicted files | commit |
| --- | --- | ---: | --- |
| B1 | `claude/merge-a-codecs` at `fc8c427b73` (PR 398) | 54 | `12324b54` |
| B2 | `claude/merge-a-server` at `1597e37c60` (PR 399) | 65 | `dd681539` |
| B3 | `claude/unified-pacs` at `7afeb9cac2` | 7 | `62386a90` |
| B4 | `claude/line-hygiene` at `8d5112fd74` (PR 256) | 31 | `f9e7b8d9` |

Then four fixes, each its own commit, each for a check that failed after the merges:

* `e86bbc1d`: four paths that B1's docs still linked. The client line had moved them off the demo (`05eab56b`), so they are now named at `696c15d6`. Without this, `check_links` fails.
* `93e4af8b`: `dist/session.js` rebuilt from B3's `session.ts`, with its pin (the plan's §6 item 2).
* `769329b6`: the PACS line's refusal clause now calls `requestFrame`, the tip's name. Before, the contract stood at 242/244.
* `dde36aef`: `deploy/Containerfile` copies `carrier` and `carrier/sender`. B3 made them workspace members, and without the copy the web image's WASM step failed.

`f0278742` updates the line doc.

There are more conflicts than the plan's §4 counted (11, 31, 7, 29), because stage A moved both sides and the `-s ours` lineage gives a criss-cross base. Most of them are a file whose other side is an older version of the tip's own file: its blob is in the tip's history. Those take the tip's side. That covers 31 files in B1 and 16 in B2.

## What the product gets (`git diff 4520a441 claude/unified` outside `docs/` and `lab/`)

* **The PACS line, whole (B3):** serving by UID (`--root`, `series_tree.rs`, refusals by close code), `ingest/receiver`, `common/{from-disk,study-db}`, `tools/pacs-verify`, `carrier`, and the client's side of a refused series (`session.ts`, `ws-session.ts`, `transport-wasm`'s `session.rs`, the contract clauses). This adds a cargo feature, `carrier:quic`.
* **`server/src/transport/server.rs`, the written resolution of three lines (B3's message).** It takes the PACS line's `Series`, the client line's endpoint and raw QUIC routing, and the server line's fourth `ProductPipeline::new` argument. One new behaviour: under `--root`, a raw QUIC session names no series, so it is refused as a bad series name. It is held by a new test, `under_root_a_raw_session_is_refused_as_a_bad_series_name`, and the mutant that sends code 0 fails it. `send_window_follows_cwnd` now has `conflicts_with = "root"` under `lab-levers`.
* **The server line's lab levers (B2), all behind `lab-levers`, ported onto the tip's QUIC types:** `--advise-tile-names` (row 259, not adopted; PR 380's owner question), `--fill-resumes-after-asks` and `--ask-stream-priority` (ASKSTREAM, not adopted), and the fill window arm Wf (row 260, a test-only builder). The parse and refuse tests list all ten. The mutant that sends an ask on the fill stream fails `with_an_ask_stream_an_ask_is_read_past_the_unread_fill`.
* **From hygiene (B4), only the added files:** `deploy/build-arm64.sh`, `deploy/THIRD_PARTY_NOTICES` with `licence-texts/` and `server_notices.py` (no image copies them yet), and the patched crates' licence files.
* **Nothing else.** In B2 and B4, every other client, deploy and server path is the tip's, conflicting or not. Those merges also landed old forms of the tip's code without a conflict (the decode workers' `done` without its index, `armFill` without its `askMs`), and those were put back to the tip's form.

## For the reviewer, read first

1. **B2 and B4 put back the tip's form on paths that merged without a conflict.** The plan's §4 B2 asks for this ("the tip's form, which carries the demo's later decisions"), and B4 extends it, saying so. Each path is listed in its merge message.
2. **Not carried, and named:**
   * Two server-line changes to client and deploy files. `4019518a`: `readMin` names a cut queued before the read; the tip's docs already say "not merged here". `5ce4f087`: the decoder build's container run unlabelled for SELinux.
   * Hygiene's 10-30 fold in code: the page names its client, no series by default, `.dockerignore`, the Containerfile's `FEATURES` and its notices copy.
   * SCROLLPOLICY's page arms in `lab/ask-ahead`, the scalable tool's `run.mjs` flags, and `av1-webcodecs.js`'s `stallMs`. Each stays on its staging branch.
3. **A deviation from the plan's §4 B4:** hygiene's `tests.rs` files are not added. Each one moves tests the tip keeps inline in the module, and none holds a test the tip lacks (fod: 5 against the tip's 6). With the tip's modules they would be dead files, and the tests would run twice. For the same reason, its `CLAUDE.md` rule and its comment-budget exclusion for `tests.rs` are not carried.
4. **Docs:**
   * Each line's unique sections are carried.
   * Where docs-client (PR 384) folded text into `docs/client/evidence/`, the fold stands (`WIRE.md` §Proposed: an ask during a fill, `decode/README.md` §Grey path).
   * `docs/lines/codecs.md` is the codecs line's own state, plus the tip's Open 5, 7 and 8 as 12–14.
   * `glossary.md` now holds *lossy stream* and *quality profile* beside *optimal quality*: two names for one concept. This is for COMPLEXITY-AUDIT.
5. **`Cargo.lock`:** the tip's, then `cargo update -w`, then six new packages pinned back to the PACS line's versions with `--precise`. Every version is one side's, except that the tip's rustix 1.1.6 serves the PACS side's 1.1.5.

## Against the baseline (`claude/work-ledger:docs/queue/MERGE-BASELINE-report.md`, `unified-client` `e5b20cba8d`; `merge-a-client` from PR 401)

| measure | baseline (`unified-client`) | `merge-a-client` `4520a441` | `claude/unified` | command |
| --- | --- | --- | --- | --- |
| builds | transport WASM 0, decode WASM 0, ingest tools 0 | the same | the same | README's cloud lines |
| full gate | OK, 782 s, 53 steps | OK, 718 s, 53 steps | **OK, 597 s, 57 steps** (at `769329b6`) | `PYTHON=python3.13 scripts/gate.sh` |
| the gate's skips | nested workers (no `FIREFOX_PATH`); the viewer's cross-codec arm and Firefox | the same two | the same two | the gate's recap |
| `series-server` tests, default / telemetry / lab-levers' gate line | 134 / 137 / 5 | 134 / 137 / 5 | **161 / 164 / 5** | `counts.sh` |
| other `cargo test` lines | fod… 20, from-parser 2, native-client 11 / 16 (+1 ignored) / paint 2, lab crates 68 | from-parser 11, the rest equal | common…pacs-verify **42**, from-parser 11, native-client equal, lab crates **77** (+ metadata-store), new: pacs-receiver 49, carrier 17 / 18 (quic), sender 11 | `counts.sh` |
| contract | 238/238 | 238/238 | **244/244** (the PACS clauses) | `node client/contract/run.mjs` |
| default `cargo build` warnings | 1 (tokio's deprecation) | 1 | 1, the same (the log's two `warning` lines are that one and its summary) | `cargo build` |
| `scripts/check_lab_absent.sh` | OK | OK | OK | as named |
| `scripts/comment_budget.sh` | ok | ok | ok | as named |
| deploy image, `web` | 94,942,938 B | 94,913,173 B | **94,951,278 B** (at `dde36aef`) | `docker build -f deploy/Containerfile --target web` |
| deploy image, `server` | not buildable here | not buildable here | not buildable here (the proxy refuses plain-HTTP apt, exit 100) | `--target server` |
| non-blank code lines: server / client / client/native / ingest / deploy / scripts | 6977 / 15709 / 3005 / 1976 / 305 / 1666 | 6977 / 15749 / 3005 / 2354 / 305 / 1709 | **7978 / 15798** / 3005 / **5549 / 423 / 1717** | `MERGE-BASELINE/measure.sh` |
| lab/ code lines; docs/ lines | 62303; 33674 | 68112; 47801 | **104334; 70902** | the same |
| URL parameters (product; lab gate) | 3; 17 | the same | the same names | the same |
| cargo features; server lab levers | 10; 6 | 10; 6 | **11** (+`carrier:quic`); **9** (+`advise_tile_names`, `fill_resumes_after_asks`, `ask_stream_priority`) | the same |
| `demo-check.mjs`, `dbts_a1-q8-g8-cut` | passed, page and worker | passed, page and worker | **passed, page and worker**; the two bundles byte for byte the baseline's sizes (67,815,143 and 4,642,293 B) | `client/viewer/demo-check.mjs DIR dbts_a1-q8-g8-cut --view page` and `--view worker` |

No test count is below the baseline's. Every check that passed at the baseline passes here.

The product's growth comes from three places:
* server +1 001: B3's serving by UID (`series_tree.rs` and its tests) and B2's levers.
* ingest +3 195: the PACS receiver.
* deploy +118: the arm64 script and the notices script.

Gate durations and image sizes come from one run each on a shared host. They are not measurements.

**Fixtures and limits.**
* The gate used the repository's committed fixtures.
* The demo check used `dbts_a1` alone (fetched by `lab/av1/fetch_data.sh`), coded by `scripts/demo-series.sh`'s own ingest steps for two series. The other demo series were not run.
* The host was one 4-core cloud host with no GPU, headless Chromium (Playwright 1.63.0) and no Firefox.
* The server image cannot be built here.
* The gate ran again at `dde36aef`: OK in 430 s, with the same two skips. After it comes only `f0278742` (one line doc; `check_links` passes).

## Commands

The scripts and logs are in `claude/work-ledger:docs/queue/MERGE-B/`.
* `run.sh` runs the builds, the gate, the warnings, the absence check, the budget, `counts.sh` and the images.
* `demo.sh` runs the demo check.
* `res.py`, `hunkinfo.py` and `moved.py` resolve and read the conflict hunks.
* The four merge messages are there as `b1-msg` to `b4-msg`.
