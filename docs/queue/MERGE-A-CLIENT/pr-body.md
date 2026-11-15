Stage A for the client line, row MERGE-A-CLIENT of `claude/work-ledger:docs/queue-merge-2026-11-15.md`: the frozen list of `claude/work-ledger:docs/queue/MERGE-INVENTORY-2-report.md` §4 A4, merged in its order into `claude/merge-a-client`, which starts at `claude/unified-client` `e5b20cba8d`. This PR targets `claude/unified-client`. Retargeting is the owner's call, and so is merging. The line doc this answers to is `docs/lines/client.md`. The queue's rule applies: no merge into `main` or into any `claude/unified-*` branch.

Each merge is `git merge --no-ff` at its frozen tip, and the first two are `-s ours` under call M1. Each merge commit's message names its source and tip, every file that conflicted, and why it was resolved that way. That reason is the plan's §3 A4 row (`docs/queue/MERGE-ALL-PLAN-report.md`) or the call it cites. All 62 frozen tips are parents of merge commits on this branch. Three branches had moved since the freeze (`phone-protocol`, `docs-client`, `hw10-routes`). They were merged at their frozen tips, and their later commits are left for the inventory's later pass.

## What the product gets (`git diff e5b20cba8d claude/merge-a-client` outside `docs/` and `lab/`)

* **M6, adopted:** PR 376, the decode deadline given again when it fires over 1 s late on a stopped page (`client/transport/downloader.js` and its test). PR 390, the optimal-quality ingest, off by default (`ingest/from-parser --optimal-quality`).
* **docs-client (PR 384):** `CLAUDE.md` §Docs, the subject homes. `scripts/check_links.py` now reads the links in `docs/`, and its test is in the gate.
* **`scripts/gate.sh`** gains `check_links_test.py` (docs-client) and four lab unit tests of `lab/phone/`: beacon, read-path, link and fill. The lab tests came in by fill-split's resolution and are lab code only, with no product hook; the runner's test was taken out again (`89e3549c`, below).
* `Cargo.lock` gains two lines for the lab window harness's new binary (native-step1-check).
* Nothing else. URL parameters, cargo features and server lab levers are the same as the baseline's (the table below).

## Resolutions a reviewer should read first

1. **Not-adopted product changes stay on their branch.** The rule is "code: the tip's later form, the branch's change re-applied only where its own row adopted it".
   * `askjump-measure` (PR 138): its own row left the flag off.
   * `coldrtt-hint` (PR 208): its depth hint was on by default only on its branch. On the tip, `docs/av1/queue.md` row 79 still reads "The owner decides".
   * `phone-devtools` and `hidden-page-decode-beacon`: the phone tools (PR 369, an open owner call) and 8 commits of PR 370 (M6, not merged). They bring image labels, `FEATURES`, the beacon's hooks in `head.js`, `controller.js` and `dev-server.py`, and README step 8.
   * Each of these keeps its lab rows, its rig and its docs, with one sentence saying where the code is.
2. **M2 (`native-parity`, `native-metrics`, `core-start2`, `core-busy2`, `core-s7-fixed`, `core-clock`, `opfs-theory`, `opfs-c-shared`, `core-m5b`): every product path goes to the tip, conflicting or not.**
   * Their rows, lab scripts and §7 text come in. The tip's deletions stay deleted.
   * The plan's §3 says `native-parity` brings `client/native/src/{load,look,resume}.rs` as new files. They compile only with the `lib.rs` and `view.rs` that M2 resolves to the tip, so they are not added: alone they would be dead files.
3. **`docs/adr/frame-path.md`:** the M2 merges each added their sections to it, built from the tip's file plus the branch's sections the tip lacked (`secmerge.py` in the ledger's row folder). Then docs-client (PR 384) replaced the file with a stub that points to `docs/client/evidence/`. 1 002 of the 1 057 lines those merges had added are already in docs-client's evidence files word for word, so the stub stands.
4. **Line docs (`docs/lines/*.md`):** these were taken whole, not hunk by hunk.
   * For `direction` (a 2026-11-12 rewrite into a numbered form), the tip's whole file was kept in its six conflicting files. Hunk-by-hunk resolution left each file half in one form and half in the other.
   * For `docs-client`, its whole work-state files were taken for `README`, `client`, `native` and `optimal-quality`. That is the form the plan names, and its `native.md` is written "against `claude/direction`'s line doc".
   * What earlier merges had added there is history, or it lives in `docs/phone-rows`, `docs/reviews` and the evidence files. It is left for the plan's §6 item 5.
5. **`cine-no-skip` (M4):** all of its product files conflict, so the tip's side. The six viewer-line commits it carries (M5, parked; MERGE-INVENTORY-2 §2) therefore do not land. That answers the inventory's owner question by default.
6. **Glossary:** `client-architecture-division` would have given *view* a second meaning, so its rows are the tip's.

## Questions for the owner

* `coldrtt-hint`'s depth hint (PR 208, −41 ms to the first exact frame at 10 ms): adopt it into the product, or leave it on its branch?
* `native-parity`'s product code (lost-session survival, the display controls, the cine in the native window): bring it in under M2's cleaning, or leave it on its branch?
* `cine-no-skip`'s viewer-line behaviour (steps stop at the ends, rotate and flip only on DX and CR, keys ignore case): it does not land here. Should it?

## Corrections to pushed merge messages

* `proposals` (`3ef14415`): "the intro line, where the branch's clean edit replaced the tip's" should say that the tip's intro line stands, and that the branch's clean edit replaced the tip's "and 23 MB" line of §Optimize.

## The merges

| # | merge | kind | commit |
| --- | --- | --- | --- |
| 1 | wip-214-DISPLAYTAGS at b3079e9b42 (-s ours) | -s ours | `4c9d6c5f` |
| 2 | wip-215-CLEANAUDIT at 6cb03d8468 (-s ours) | -s ours | `7b2b1efd` |
| 3 | onerror at ec61fba7d6 | resolved | `88970a5c` |
| 4 | wip-219-VIEWERASKS at 3e3e2d9459 | resolved | `20d14ef3` |
| 5 | wip-226-GATEGAPS at 7fc6741487 | resolved | `4cfa71e7` |
| 6 | askjump-measure at 61a69b2c19 (PR 138) | resolved | `d195431a` |
| 7 | telemetry-production-design at deb236a3ee (PR 143) | clean | `8bf3a40f` |
| 8 | coldrtt-hint at 334214d2e9 (PR 208) | resolved | `d1ae3848` |
| 9 | cine-no-skip at 440047ff35 (PR 251) | resolved | `c94a0053` |
| 10 | ask-patterns-map at 8ffe467437 (PR 224) | resolved | `cad8034d` |
| 11 | cache-policy at 680c9b4942 (PR 207) | resolved | `6459b9ce` |
| 12 | opfs-cache-measure at 38fb59a7b9 (PR 204) | resolved | `70a1731f` |
| 13 | native-step1-check at 843a3903c3 (PR 211) | clean | `e2739c5d` |
| 14 | native-parity at 02e298ef75 (PR 277) | resolved | `e866aa1f` |
| 15 | native-metrics at 224ad4e221 (PR 278) | resolved | `6a73dc8e` |
| 16 | core-start2 at a8243eca5e (PR 294) | resolved | `823ef5c5` |
| 17 | core-busy2 at 3acecc9066 (PR 296) | resolved | `3673823d` |
| 18 | opfs-theory at c01750b737 | resolved | `cf762199` |
| 19 | core-s7-fixed at 36ae72e007 | resolved | `9d16d7ec` |
| 20 | core-clock at f36a747b8c | resolved | `9563b63b` |
| 21 | opfs-c-shared at a6a2701510 | resolved | `e86775da` |
| 22 | client-architecture-division-rfri34 at 39714b4c0e | resolved | `d2561733` |
| 23 | core-asking-plan at b74ca8c513 (PR 298) | resolved | `5cdc29ff` |
| 24 | core-m5b at fba512c530 (PR 301) | resolved | `803900b3` |
| 25 | plan at 5b69cd7d9c (PR 338) | clean | `9ca613bd` |
| 26 | reviews-2026-11-10 at c9d882a814 | clean | `fadf8ec6` |
| 27 | oq-integrity at 39a7bdd35d | clean | `5147ed76` |
| 28 | dav1d-lazy at 7cf46ef7a7 | resolved | `f4e8d336` |
| 29 | fable-simplify at 460488d9df | clean | `e38a6ff0` |
| 30 | reviews-2026-11-11 at 7ab6a3aafc | clean | `94376afe` |
| 31 | fable-design at 7946ad7c66 | clean | `6a7c3e50` |
| 32 | reviews-2026-11-13 at 8da33d8ece | clean | `1206aece` |
| 33 | proposals at 5b4c334174 (PR 358) | resolved | `3ef14415` |
| 34 | demo-simplify at d70ccb9f98 | resolved | `5490444d` |
| 35 | demo-understand at 3171ee7b39 | resolved | `c2353974` |
| 36 | demo-pre-main-review at 8ecd71b6a1 | resolved | `b658f90f` |
| 37 | slice-touch at afbce9301d | resolved | `8bc0692c` |
| 38 | demo-review-2 at af91740159 | resolved | `f1fd26d6` |
| 39 | phone-run at 48f554a6d7 | resolved | `efe9ae86` |
| 40 | phone-protocol at 04797972fe | resolved | `8c323199` |
| 41 | dataset-hub at 4200d599ff | clean | `8472771a` |
| 42 | phone-devtools at eb0283449e | resolved | `3d30993a` |
| 43 | merge-plan at a376221799 | resolved | `11a85e49` |
| 44 | hidden-page-decode-beacon at 5137f44960 (PR 377) | resolved | `62795db2` |
| 45 | fill-split at 28810f62c4 | resolved | `9ef244a1` |
| 46 | phone-rows at 1354e67f31 | resolved | `3288aab4` |
| 47 | lines-ready at 96d33ad00e | clean | `9a590040` |
| 48 | ingest-oq at 68c15c2a6c | resolved | `1994a933` |
| 49 | lab-off-main at 3d196b960f | clean | `cefcf80d` |
| 50 | direction at a6e27ea5b6 | resolved | `c2f97d44` |
| 51 | hostnet-theory at 8a1f0f596e | clean | `21533762` |
| 52 | hidden-page-decode at 22c68824b8 (PR 376) | resolved | `6c5ad79e` |
| 53 | docs-client at a4cf8513ff (PR 384) | resolved | `250d48b3` |
| 54 | link-targets at a3b35708a3 (PR 386) | resolved | `721def2d` |
| 55 | hw-decode at b631179a56 (PR 387) | resolved | `d1d32f54` |
| 56 | cache-plan at f26a78f056 (PR 385) | resolved | `3368826e` |
| 57 | report-plan at cb1c90d856 (PR 388) | clean | `b17cedb7` |
| 58 | depth8 at ddd3ec0ede (PR 389) | resolved | `38423b40` |
| 59 | hw10-routes at b2c10f52bc (PR 392) | resolved | `61a0dfc3` |
| 60 | oq-ingest at 8ea8aba6d8 (PRs 321, 390) | resolved | `de15680a` |
| 61 | transport-design at 96a829c887 (PR 391) | clean | `6bd4cd97` |
| 62 | hw-probe at af4b6aeb35 | clean | `68a41678` |

## After the last merge: three fix commits

The first gate run failed. Each failure is from content the merges brought in, and each fix is its own commit.

* `6a9fccc9`: `check_links.py` failed on 20 entries. 16 were backticked paths the tree no longer holds; each is now named beside the commit that has it, or, for three that were never committed, says so. One was a regex read as a link. One was a link to `link-profiles.md`, which is in `docs/transport/`.
* `297e7352`: `check_personal_paths.sh` failed on `/home/user/` in the rows of `lab/proposals/rows/`. That prefix is now `<home>/`, and no reader uses the field. *Correction:* its message says 1 145 lines; it is 1 250 lines in ten files.
* `89e3549c`: `lab/phone/runner.test.mjs` came in with fill-split's gate lines and failed 1 of its 11 checks. The check tests the phone tools' `?run=` lever in `lab/viewer/levers.js`, which stays on their branch. That gate line was removed. The other four `lab/phone` tests stay in the gate and pass.

## Against the baseline (`claude/work-ledger:docs/queue/MERGE-BASELINE-report.md`, `unified-client` at `e5b20cba8d`)

| measure | baseline | `claude/merge-a-client` `89e3549c` | command |
| --- | --- | --- | --- |
| builds | transport WASM 0, decode WASM 0, ingest tools 0 | the same | `client/transport/wasm/build.sh`, `client/decode/wasm/build/build.sh`, `ingest/tools.sh` |
| full gate | GATE OK, 782 s, 53 steps | **GATE OK, 710 s, 53 steps** | `PYTHON=python3.13 scripts/gate.sh` |
| the gate's skips | nested workers (no `FIREFOX_PATH`); the viewer's cross-codec arm and Firefox | the same two | the gate's recap and its `skipped:` lines |
| `cargo test` lines (each run again without `--quiet`) | from-parser 2, every other line as listed | **from-parser 11** (PR 390's tests); fod… 20, native-client 11 / 16 (+1 ignored) / paint 2, series-server 134 default / 137 telemetry / 5 lab-levers / 2 lab-classify, the lab crates 68: all equal | `counts.sh` |
| JS and Python suites | as listed there | all equal, but `frame-clock measure` 13/13 (11/11; core-clock's lab test) and `beacon` 8/8 (new, lab/phone) | the gate's log |
| default `cargo build` warnings | 1 (tokio's deprecation) | 1, the same | `cargo build` |
| `scripts/check_lab_absent.sh` | OK | OK | as named |
| `scripts/comment_budget.sh` | ok | ok | as named |
| deploy image, `web` | 94,942,938 B | 94,913,173 B (built at `68a41678`, the last merge; the fix commits touch nothing it copies) | `docker build -f deploy/Containerfile --target web` |
| deploy image, `server` | not buildable here | not buildable here (the proxy refuses plain-HTTP apt) | `--target server` |
| non-blank code lines: server / client / client/native / ingest / deploy / scripts | 6977 / 15709 / 3005 / 1976 / 305 / 1666 | 6977 / **15749** / 3005 / **2354** / 305 / **1709** | `MERGE-BASELINE/measure.sh` |
| lab/ code lines; docs/ lines | 62303; 33674 | **68112; 47800** | the same |
| URL parameters (product; lab gate), cargo features, server lab levers | 3; 17; 10; 6 | the same names | the same |
| `demo-check.mjs`, `dbts_a1-q8-g8-cut` | passed, page and worker | **passed, page and worker**; the two bundles byte for byte the baseline's sizes (67,815,143 and 4,642,293 B) | `client/viewer/demo-check.mjs DIR dbts_a1-q8-g8-cut --view page` and `--view worker` |

The product's growth is client +40 (PR 376 and its test), ingest +378 (PR 390) and scripts +43 (`check_links.py` and its test, net of the gate lines). The rest is lab rows and rigs (+5 809) and docs (+14 126). Gate durations and image sizes come from one run each on a shared host. They are not measurements.

**Fixtures and limits.** The gate used the repository's committed fixtures. The demo check used `dbts_a1` alone, of the three timed DBT volumes, coded by `scripts/demo-series.sh`'s own ingest steps. The host was one 4-core cloud host with no GPU and headless Chromium (Playwright 1.63.0 preinstalled, not README's 1.56.1). Firefox is not installed. The server image cannot be built here.

## Commands

The scripts are in `claude/work-ledger:docs/queue/MERGE-A-CLIENT/`.

* `m.sh N` starts merge N of the frozen list. `c.sh` commits it, and refuses while a conflict or a marker is left.
* `res.py`, `hunks.py`, `struct.py` and `secmerge.py` show and resolve conflict hunks.
* `setup.sh` installs the prerequisites on a fresh container. `tip.sh` and `counts.sh` are MERGE-BASELINE's, pointed at this worktree with its own `CARGO_TARGET_DIR`. `demo.sh` runs the demo check.

Check the merge list:

```bash
git log --merges --first-parent --format=%P e5b20cba8d..claude/merge-a-client | awk '{print $2}'   # 62 tips, MERGE-INVENTORY-2 §4 A4
```
