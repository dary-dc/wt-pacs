# `lab/` on `claude/unified`: what reads each directory

A list for the owner's yes, COMPLEXITY-AUDIT item 7 ("`lab/` grew to 104 334 non-blank code lines … a list of `lab/`
directories no gate step and no line doc's *Open* item reads, for the owner's yes, before the `main` preparation
rows"). Written 2026-11-20 by row UNIFIED-LAB-LIST of `claude/work-ledger:docs/queue-2026-11-14.md`, for the
[`unified-to-main`](README.md) page. Findings only: nothing is removed here.

**Fixture and limits.** One tree, `origin/claude/unified` at `4a2b4277f` (2026-11-20 06:35 UTC); branches it does
not carry (PR 408's `claude/htj2k-a1`, PR 411's frame-clock removal, the report, cache and transport arms) are not
read. *Read* means **read, not run**: a static trace from each `scripts/gate.sh` step through what it names, with
comments stripped — JavaScript and HTML imports, workers and `src`s; paths on the non-comment lines of shell and
Python files; `cargo -p` crates and their path dependencies, an optional one only under the feature that step turns
on. A path built at run time from parts would be missed; the gate was not run under a trace (the container lacks
the WASM transport build the gate's first step requires). Line docs read: `docs/lines/*.md` on `claude/unified`,
the newer `codecs.md`, `metadata.md`, `viewer.md` on `claude/line-docs-3` (PR 415) and `client.md`, `devices.md` on
`claude/docs-client`, their *Open*, *In flight*, *Owed* and *Waits* sections, for `lab/<dir>` or the directory's name.

**Counts** (counted at `4a2b4277f`): 66 directories and 4 files at `lab/`'s root; 104 333 non-blank code lines
(`.rs .js .mjs .ts .py .sh .html .css .go .c .h .toml`; the audit's 104 334 on its own tree) and 476 071 other
non-blank text lines (rows, JSON, Markdown). 19 directories are read by a gate step; 47 by none.

## Read by a gate step

Code lines: the directory's, and of them the lines the gate's steps read.

| directory | code lines (read) | gate step that reads it | read outside the gate too |
| --- | ---: | --- | --- |
| `av1` | 36 302 (576) | "the AV1 fetch refuses a lossy source"; the two ingests compared (`fetch_data.py`); optimal quality (`tools/ingest_coded.py`, `profiles/bytes.py`) | `scripts/demo-series.sh`, `scripts/perf_nightly.mjs` (`delivery/total-time/`), CI's `requirements.txt`; VL-READS reads its committed rows |
| `scripts` | 9 305 (269) | "row 258's verdict rule"; the painter at 1:1 (`gen_frame_pnm.py`); optimal quality (`sign_htj2k.py`) | `perf_nightly.mjs` (`aa_rule.py`), `scripts/pgo_build.sh` (two fixture generators); DELIVERY-RUN's relay is on `claude/transport-arms` |
| `disk-access-bench` | 6 261 (5 404) | "each closed arm's patch still applies"; "the seven lab crates' tests" | the image's build stage (a workspace member, coordination §Open 6) |
| `metadata-store` | 5 132 (3 498) | the seven lab crates' tests | the image's build stage |
| `container-bench` | 3 975 (2 363) | the seven lab crates' tests | the image's build stage |
| `window-harness` | 3 305 (3 305) | the seven lab crates' tests | the image's build stage |
| `client-telemetry` | 2 224 (1 097) | client bundles and unit tests (`build.sh`, two tests); the type-check | `deploy/check_equivalence.sh` asserts `tap.ts` hidden |
| `server-telemetry` | 2 212 (2 212) | "server: tests, telemetry feature"; the seven lab crates' tests | the image's build stage |
| `page-open` | 1 855 (58) | "the Go and h3 clients compile" (`h3-host/`) | CI's Go cache key; `check_equivalence.sh` names it |
| `devices` | 1 465 (196) | the device kit's plan and collector | the phone round (11-21) |
| `phone` | 1 451 (432) | the viewer's levers (`beacon`, `read-path`, `link`, `fill` tests) | the phone round; devices.md §Open, for the owner |
| `viewer` | 1 396 (665) | the viewer's levers; the page check and the crafted link (`levers.js`, `hooks.js`, served); client unit tests (`start-summary`) | `perf_nightly.mjs`; the phone round |
| `telemetry-bench` | 1 023 (1 023) | the seven lab crates' tests | the image's build stage |
| `frame-clock` | 566 (406) | client unit tests (`arms`, `measure`); "the frame clock's seven arms" (browser); `busy.js`, `phase.js` through `levers.js` | `perf_nightly.mjs`; **PR 411 removes it** (UNIFIED-REMOVALS, review owed) |
| `harness` | 503 (115) | the nginx equivalence (`/harness/` served by `dev-server.py`, asserted hidden by nginx) | — |
| `cc-classify` | 331 (155) | the server's lab features (`lab-classify`); the seven lab crates' tests | the image's build stage; coordination §Open 6 |
| `opfs-cache` | 329 (194) | the paint's fence settle (`browser.mjs`); the rigs' Firefox driver | — |
| `other-clients` | 307 (163) | the Go and h3 clients compile | CI's Go cache key |
| `fixtures` | 0 (0; one JSON) | the native window under Xvfb (`window_grey16/metadata.json`) | `scripts/pgo_build.sh` |
| root: `order.mjs`, `order.test.mjs`, `README.md`, `.gitignore` | 107 | "the variant order"; the painter at 1:1; the absence check | `perf_nightly.mjs` |

Five of these are read in part only: `av1` (1.6 % of its code), `scripts` (2.9 %, more through `perf_nightly.mjs` and
`pgo_build.sh`), `page-open` (3.1 %), `client-telemetry` and `viewer` (about half). The unread rest of each is in the
same position as the table below, and is not split further here.

## Read by no gate step

None of the 47 is read by `scripts/perf_nightly.mjs`, `scripts/pgo_build.sh`, `scripts/demo-series.sh`, a CI
workflow, `deploy/` or a gate-read `lab/` file either. *Docs files naming it*: files under `docs/` (or any `.md`)
outside `lab/` that cite `lab/<dir>`; `scripts/check_links.py` resolves each backticked path, so a removal must
repoint each to an archive tag or a commit.

| directory | code lines | other text lines | line doc open item | a program row before 11-28 | docs files naming it |
| --- | ---: | ---: | --- | --- | ---: |
| `study-index` | 3 026 | 9 906 | — | — | 2 |
| `htj2k-progressive` | 2 357 | 40 387 | — | — | 3 |
| `decode-bench` | 2 333 | 5 001 | — | — | 9 |
| `metadata-delivery` | 1 781 | 4 597 | — | — | 2 |
| `sqlite-engine` | 1 578 | 3 497 | — | — | 3 |
| `proposals` | 1 405 | 3 134 | — | — | 5 |
| `htj2k-tiles` | 1 358 | 20 201 | — | HTJ2K-A1-REVIEW (A1 rows on `claude/htj2k-a1`), EXACT-LAYOUT-PAGE | 2 |
| `late-frame` | 1 194 | 875 | — | — | 2 |
| `ask-ahead` | 1 112 | 5 007 | — | — | 9 |
| `downloader-cost` | 881 | 48 | — | — | 4 |
| `disk-tree` | 802 | 643 | — | — | 2 |
| `tail-rewrite` | 699 | 613 | — | — | 1 |
| `decode-tail` | 628 | 18 | — | — | 3 |
| `paint-floor` | 537 | 72 | — | — | 5 |
| `recv-cost` | 523 | 1 949 | — | — | 2 |
| `irtt` | 519 | 34 | — | — | 4 |
| `decoder-memory` | 467 | 49 | — | — | 2 |
| `session-survival` | 451 | 56 | — | — | 3 |
| `stream-shape` | 408 | 32 | — | — | 4 |
| `faultbench` | 407 | 16 | client.md §In flight (the `info.path` finding in `index.html`, #382) | INTEGRITY-MODEL (Fable, 11-24) lists its cells for the next queue | 5 |
| `decode-first-frame` | 337 | 26 | — | — | 2 |
| `paint-read` | 334 | 257 | — | — | 5 |
| `tcp-fallback` | 323 | 31 | — | — | 2 |
| `loss-class` | 308 | 89 | — | — | 3 |
| `viewer-ceiling` | 304 | 0 | — | — | 3 |
| `containers` | 250 | 16 | — | — | 1 |
| `native-window` | 244 | 285 | — | — | 2 |
| `native-step1` | 212 | 160 | — | — | 2 |
| `fill-at-start` | 175 | 31 | — | — | 2 |
| `ask-behind` | 137 | 0 | — | — | 3 |
| `firefox-dial` | 125 | 26 | — | — | 1 |
| `early-messages` | 124 | 11 | — | — | 2 |
| `server-load` | 112 | 46 | — | — | 6 |
| `fastclock` | 109 | 654 | — | — | 1 |
| `frameloss` | 104 | 14 | — | — | 1 |
| `dial-deadline` | 102 | 10 | — | — | 3 |
| `worker-leak` | 100 | 11 | — | — | 1 |
| `ffportgc` | 94 | 20 | — | — | 2 |
| `telemetry-cost` | 89 | 22 | — | — | 5 |
| `link-conditions` | 75 | 47 | — | — | 2 |
| `clock-resolution` | 73 | 11 | — | — | 1 |
| `pgo-relay` | 66 | 1 116 | — | — | 2 |
| `idle-sessions` | 50 | 15 | — | — | 2 |
| `iwdeep` | 45 | 972 | — | — | 1 |
| `bb3` | 33 | 3 199 | — | — | 3 |
| `opfs-arms` | 0 | 3 912 | — | — | 7 |
| `traces` | 0 | 3 357 | — | — | 3 |

Only `faultbench` is named by a line doc's open item, and only for a stale field name; only `htj2k-tiles` and
`faultbench` are read by a row due before the program's close. `study-index` is named in `metadata.md` §In flight
as built, not as open.

## For the owner

**Remove the 47 directories of the second table (26 391 code lines, 25 % of `lab/`'s) from `claude/unified` before
`main`, after the program closes (11-28), each recoverable by an archive tag: yes or no.** A yes queues one removal
branch and draft PR into `claude/unified`, named for what it removes, which tags the tree first
(`archive/lab-<dir>-2026-11`, as the 34 `archive/*` tags on `origin` already do), repoints the docs that cite each directory to
that tag, and keeps `htj2k-tiles` and `faultbench` until their rows are done. A no leaves `lab/` as it is: the
absence check already keeps it out of the images and the default build, and `main`'s rule ("`lab/` the harness
only") stays unmet.

Not asked here, and each its own decision: the unread parts of `av1` and `scripts` (which need a split by file,
not by directory); the seven workspace crates (UNIFIED-LAB-WORKSPACE, coordination §Open 6); the frame clock
(PR 411).

**How it was made.** Two scripts on `claude/work-ledger`, `docs/queue/UNIFIED-LAB-LIST/` (the ledger, beside
COMPLEXITY-AUDIT's): `counts.py` (each directory's lines and the docs naming it) and `gate_trace.py` (the trace
above). `git worktree add --detach /tmp/u origin/claude/unified && python3 gate_trace.py /tmp/u trace.json`.
