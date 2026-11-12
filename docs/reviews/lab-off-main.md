# `lab/` off `main` entirely: a proposal

A proposal for the owner (2026-11-11: "`lab/` off `main` entirely is a proposal for after the demo"), set against
today's rule, `docs/lines/coordination.md` §Decisions: `lab/` on `main` is the measurement harness only; product code
never imports `lab/`, no lab code sits inside product modules, nothing from `lab/` enters the deploy image or the
default build, and `scripts/check_lab_absent.sh` enforces it in the gate. Structural, so nothing here is built.

Read on the demo tip `claude/demo-fixes-2` `18d2d1ff` (it holds `main` `017a3ca6`), which is what `main` holds after
this week's merges. Every count is `git ls-files` or `git grep` on that tree; nothing is measured. A removal from
`main` does not shrink a clone: git history keeps every byte, so the gain is in the tree a reader and the gate see,
not in storage.

## 1. What `lab/` is today

994 tracked files, about 126 000 lines, 22.7 MB, in 49 top-level directories. The largest: `lab/av1` (341 files,
40 400 lines), `lab/decode-bench` (181), `lab/scripts` (71, 9 960 lines), `lab/fixtures` (59), `lab/container-bench`
and `lab/disk-access-bench` (25 and 24, 7 700 and 9 700 lines). `lab/README.md` maps each directory to the doc whose
number it reproduces.

## 2. What ties `main` to `lab/` (the cost of any move)

Each tie is a place that breaks the day `lab/` leaves; the options below differ in how they cut it.

| # | tie | where | what it is |
| --- | --- | --- | --- |
| T1 | six workspace members | `Cargo.toml` members `lab/disk-access-bench`, `container-bench`, `window-harness`, `telemetry-bench`, `cc-classify`, `server-telemetry`; `.containerignore`'s twelve `!lab/...` lines | not in `default-members` (the absence check), but cargo loads them to resolve the lock |
| T2 | two optional server dependencies | `server/Cargo.toml`: `lab-classify = ["dep:cc-classify"]`, `telemetry` → `../lab/server-telemetry`; `lab-frame-cache` builds `lab/disk-access-bench/src/frame_cache.rs` | lab code behind product features, off by default |
| T3 | the viewer's lab gate | `client/viewer/head.js` imports `/lab/viewer/levers.js`; `server/dev-server.py` serves `lab` (`SERVED`); `client/viewer/check.mjs` routes `**/lab/**` from the checkout | the one path from a page to `lab/`, refused where `lab/` is not served |
| T4 | product tests that use lab helpers | `client/paint/check.mjs` imports `lab/order.mjs`; `client/paint/settle-check.mjs` imports `lab/opfs-cache/browser.mjs`; `client/paint/cells.mjs`, `client/decode/wasm/dav1d/make_*.sh` run `lab/scripts/gen_frame_pnm.py`; `client/paint/window.mjs` and `client/native/src/view.rs` read `lab/fixtures/window_grey16` | test support living in `lab/` |
| T5 | build output under `lab/` | `client/decode/wasm/dav1d/build.sh`, `exact.mjs`, `make_streams.sh`: `BUILD` defaults to `lab/.av1-build` | a directory name only (ignored, never tracked) |
| T6 | the optimal-quality series writer | `scripts/demo-series.sh` runs `lab/av1/fetch_data.sh` and `lab/av1/tools/ingest_coded.py`, the only writer of an optimal-quality pair (`docs/lines/optimal-quality.md` Open 6, row INGEST-OQ) | product function still in `lab/` |
| T7 | gate and CI | `scripts/gate.sh`: 11 of its 52 steps are `lab:` steps, 20 lines name `lab/`; `.github/workflows/gate.yml` installs `lab/av1/requirements.txt` and caches two `lab/` `go.sum`; `scripts/perf_nightly.mjs` runs `lab/order.mjs`, `lab/av1/delivery/total-time/run.mjs`, `lab/scripts/aa_rule.py`; `scripts/pgo_build.sh` trains on `lab/fixtures` made by `lab/scripts/gen_*` | the harness checked on every PR, and the nightly perf job |
| T8 | docs | 1 441 mentions of a `lab/` path in 62 files under `docs/`, the most in `docs/av1/queue.md` (292), `docs/adr/frame-path.md` (149), `docs/decode/README.md` (128); 66 lines in READMEs and `CLAUDE.md` outside `docs/` (`README.md` 16, `client/README.md` 18); 297 Markdown links into `lab/` across both | `scripts/check_links.py` fails on each that stops resolving, unless it stands beside a commit, an `archive/` tag or a word like *removed* |

T5 is a rename. T4 and T6 are product or product-test code that sits in `lab/` today and moves under every option
except A.

## 3. The options

**A. Today's rule, kept.** `lab/` stays on `main` under the absence check. Cost: none now. A reader of `main` sees
126 000 lab lines beside the product's; the gate spends 11 steps on the lab; T1 keeps lab crates in the lock.

**B. `lab/` off `main` onto one lab branch.** One long-lived branch (say `lab`) that is `main` plus `lab/`, merging
`main` in after each merge to `main`, never the other way. Moves: T4's helpers into the product's test trees
(`order.mjs` and the Firefox driver beside the tests that use them, `window_grey16` into `fixtures/`, `gen_frame_pnm.py`
under `scripts/` or the test's directory); T6's writer to `ingest/` first (INGEST-OQ's design decides how); T1 and T2
out of the root workspace and `server/Cargo.toml` (the server's `lab-classify`, `telemetry` and `lab-frame-cache`
features then live only on the lab branch, as a patch or a `[patch]`/path override there); T3's gate reduced to the
refusal (`head.js` refuses every lab parameter, since no host serves `lab/`), the lab branch restoring the import;
T7's 11 steps and the perf job to the lab branch's own CI. T8: each citation rewritten to name the commit or tag that
holds it (`<commit>:lab/...`, which `check_links.py` already accepts beside a hash), or the doc's number marked as
produced on the lab branch.

**C. `lab/` split across the line branches.** As B, but each `lab/` directory goes to the line branch whose doc
cites it (`lab/av1` to codecs, `lab/disk-access-bench` to server, ...). Closer to "lab code stays on its line branch"
(the 2026-11-11 rule for experiments), but many directories serve several lines (`lab/scripts`, `lab/order.mjs`,
`lab/fixtures`, `lab/window-harness`), so either they are copied (two copies drift) or one line branch becomes the
lab branch of B anyway.

**D. A separate repository for the lab.** As B, with the lab branch replaced by a repository that pins a `main`
commit. Clean separation and its own CI; a second repository to keep, and every measurement needs two checkouts at
matching commits. Not in this session's reach to test.

**E. Product test support out, the rest stays (the smallest step).** Do only T4, T5 and T6 of B: no product or
product-test file reaches into `lab/`, so the absence check can add one rule (nothing outside `lab/`, `docs/` and
`scripts/gate.sh` names a `lab/` path, except `head.js`). `lab/` stays on `main` as today. It removes the reason `lab/`
cannot leave later and costs a fraction of B.

## 4. What each option keeps and loses

| | A | B | C | D | E |
| --- | --- | --- | --- | --- | --- |
| a reader of `main` sees lab code | yes | no | no | no | yes |
| a `main` PR's gate runs the lab's checks | yes (11 steps) | no: the lab branch's CI, after the fact | no | no | yes |
| a product change that breaks a lab driver is caught | at the PR | when the lab branch next merges `main` | per line, later | later still | at the PR |
| a doc's number reproducible from `main`'s tree | yes | from a named commit | from a named commit | from another repository | yes |
| T8 rewrite | none | about 1 500 citations | about 1 500 | about 1 500 | none |
| server lab features (`telemetry`, `lab-classify`, `lab-frame-cache`) | on `main`, off by default | lab branch only | the line's branch | the lab repository | as A |
| an agent measuring the product | checks out `main` | checks out the lab branch, merges `main`'s commit under test | the line's branch | two repositories | as A |

The loss that decides is the third row: today a product PR that breaks a lab driver fails at review, under B to D
it fails later on another branch, and the doc numbers that driver reproduces silently stop being reproducible from
`main`. The gain is the first row and the 11 gate steps.

## 5. What an agent must do to measure the product, per option

* A, E: check out `main` (or the PR), run the directory's README.
* B: check out the lab branch, `git merge <commit under test>`, run the README; a result names both commits.
* C: as B, on the line's branch; a cross-line measurement merges two line branches first.
* D: two checkouts, the lab's pinned to the `main` commit; a result names both.

## 6. Cost, as an assumption (not measured)

* E: one branch, about ten files moved and their imports, one absence rule with a failing test first; under a day.
* B: E, plus the workspace and feature split (T1, T2, with the server's feature tests moved), the gate and CI split
  (T7), and the citation rewrite (T8, mechanical but about 1 500 lines across 70 files, reviewed); two to four days
  and a review row, and the lab branch's merge from `main` after every merge for as long as it lives.
* C and D: B's cost plus the split or the second repository's setup.

## 7. Recommendation

E now, and B judged after it, on its total effect: E removes every product reach into `lab/` (T4–T6), which every
other option needs first, and keeps what A keeps. B's gain (a `main` without lab lines, 11 fewer gate steps) is then
weighed against its loss (lab drivers break unseen; numbers reproducible only from a named commit). C is dominated by
B (shared directories), D by B (a second repository for the same separation). What decides between E and B is the
owner's: how often a product PR has broken a lab driver at review (`git log` on `scripts/gate.sh`'s `lab:` steps would
count it; not counted here), and whether `main`'s reader or the gate's cover matters more.

## 8. Owner decisions

1. A, B, C, D or E (the recommendation: E now, B after).
2. Under B: the lab branch's name, and whether its CI runs on every merge to `main` or nightly.
3. Under B: the server's three lab features off `main` (they change `server/Cargo.toml`, a product file).
