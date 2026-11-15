# MERGE-A-REVIEW-CLIENT: review of `claude/merge-a-client` at `ed11ea72` (draft PR 401)

Done by a session with no commit on `claude/merge-a-client`. **No blocker.**

## (a) Resolutions against the plan and the decisions they cite

* 62 of 62 second parents are the frozen tips of MERGE-INVENTORY-2 §4 A4, in its order (`parents.txt`). The base is
  `unified-client` `e5b20cba8d`, which has not moved. The two `-s ours` merges (M1) leave the tree unchanged.
* Conflicted files, classified by which side the result holds (`conflict-sides.txt`): 351 the staging side, 10 the
  branch's, 40 edited. Only one of the branch-side or edited files is product code: `scripts/gate.sh` at fill-split,
  where the lab/phone tests were added, as its message says. Later, `89e3549c` took the runner's test out again,
  because its lever stays with PR 369. Every other code conflict is the staging side (M2, and "code: the tip's later
  form").
* Product delta against the base: PR 376 (`downloader.js` and its test; the same as its tip but for the tip's
  `requestFrame` name), PR 390 (`ingest/from-parser`, identical to `oq-ingest`'s tip), and `check_links.py` with its
  test. `client/transport/*` is otherwise the base's, as MERGE-INVENTORY-2 §2 asks for 52bfb33a. The Cargo.lock lines
  belong to `lab/window-harness`.
* Two deviations from the plan's §3 text. Both are named in their merge messages and in PR 401's body. Neither is a
  blocker:
  1. `direction` (`c2f97d44`, row 51). The plan says "the branch's new lines carried by edit". The merge kept the
     tip's whole file in six line docs instead. Of those six, docs-client's whole files later replaced README, client
     and optimal-quality. For `codecs.md`, `coordination.md` and `metadata.md`, `direction`'s rewrite (its §Decided,
     its ranked §Open, §Unsupervised) is now in no file of the tree (`lost.txt`: 136, 145 and 101 lines). The queue
     of 11-14 cites §Decided "as they stand on `claude/direction`". **UNIFIED-CLEAN's §6 item 5 must carry those
     sections back** (`git show a6e27ea5b6:docs/lines/<line>.md`).
  2. `native-parity` (`e866aa1f`, row 13). `client/native/src/{load,look,resume}.rs` were not added: they would be
     dead files under M2. This is an owner question in PR 401.

## (b) The tree against the mechanical merge

`remerge.txt`: 12 merges change paths beyond their conflicts. Each such path is named in its merge message
(`beyond-named.txt`). Each holds the staging side (`beyond-sides.txt`), except three docs that carry the one sentence
their messages announce (`docs/decode/README.md`, `docs/av1/queue.md`, `lab/page-open/README.md`). The four non-merge
commits change only what they name. There is no conflict marker in the tree.

## (c) Gate, browser checks, baseline

| measure | baseline `e5b20cba8d` | `ed11ea72` |
| --- | --- | --- |
| full gate | OK, 782 s, 53 steps | OK, 718 s, 53 steps |
| skips | nested workers (no FIREFOX_PATH); the viewer's cross-codec arm and Firefox | the same two |
| `cargo test` lines | from-parser 2, others as listed | from-parser 11; every other line equal (20, 11, 16+1 ignored, 2, 5, 137, 134, 68, 2) |
| JS/Python suite lines | as listed | equal, plus `beacon` 8/8 (new) and `frame-clock measure` 13/13 (from 11/11) |
| Rust test functions in the tree | 265 | 274, none of the base's gone; no test file gone |
| default build warnings | 1 (tokio's deprecation) | 1, the same |
| `demo-check.mjs`, `dbts_a1-q8-g8-cut` | passed, page and worker | passed, page and worker; bundles 67,815,143 and 4,642,293 B, the same sizes |

No count is lower than the baseline's, and no check that passed now fails.

## (d) Absence checks

The gate's telemetry, server and lab absence checks: OK. `scripts/check_lab_absent.sh`: exit 0.
`scripts/comment_budget.sh`: ok.

## For COMPLEXITY-AUDIT

* 13 lab test files new on this branch run outside the gate (for example `lab/phone/runner.test.mjs`, which fails
  here, and `lab/phone/devtools_test.py`).
* The wire section of `docs/ARCHITECTURE.md` still calls the view worker proposed (`cad8034d`'s message).

## Also

PR 401's body ended with a Generated-by line and a session link. It is removed.

**Fixtures and limits.** The gate used the repository's committed fixtures. The demo check used `dbts_a1` alone, of
the three timed DBT volumes. Host: one 4-core cloud host, no GPU, headless Chromium (Playwright 1.63.0, not the
pinned 1.56.1), no Firefox. The decoder image's Debian base came through mirror.gcr.io at the pinned digest, because
Docker Hub answered 429; `pins.sh` was edited for that build only and then restored. The deploy image was not built.
