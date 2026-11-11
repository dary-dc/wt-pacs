# The two merge words: the plan

Written 2026-11-11 19:55 UTC by row MERGE-PLAN, from `origin` as fetched then. Docs only: nothing here was merged,
closed or deleted. Every hash and CI state below is **as at writing and must be read again before each word** (§2
gives the commands). The demo tip at writing is `claude/demo-fixes-2`; FREEZE-E2E has not run and CLEAN-PRODUCT is
still working, so the tip will move once more before word 1.

## 1. The order

The owner's decision of 2026-11-11: after FREEZE-E2E, two merges, each a merge commit (never squash, never rebase).

| word | PR | base | head | head commit at writing | CI on that head at writing |
| --- | --- | --- | --- | --- | --- |
| 1 | #367 | `claude/core` (`2e6fa5b2`) | `claude/demo-fixes-2` | `d46811c6` | `gate` success, `deploy` success (2026-11-11 18:44–18:57) |
| 2 | #250 | `main` (`017a3ca6`) | `claude/core` | `2e6fa5b2` now; after word 1, the merge commit word 1 makes | on `2e6fa5b2`: `gate` success, `deploy` **failure**, `decoders` success (2026-10-30); stale, superseded once word 1 moves the head |

Why this order works without a conflict, read from the graph at writing:

* `main` (`017a3ca6`) is an ancestor of the tip (`git merge-base --is-ancestor origin/main origin/claude/demo-fixes-2`
  succeeds), and `claude/core` (`2e6fa5b2`) is too. `main` is **not** an ancestor of `claude/core` today (9 commits,
  #319, #322 and #333): the tip carries them, so after word 1 it is.
* So word 1 gives `claude/core` the tip's tree exactly, and word 2 gives `main` the same tree. Nothing is resolved by
  hand at either word; a conflict at either means something moved, and the word waits.
* Both PRs are drafts: each is marked *Ready for review* just before its word, and merged with *Create a merge
  commit*. Word 2 waits for CI on #250's new head (the push of word 1 starts it: `gate.yml` runs on pushes to and PRs
  into `claude/core` and `main`).
* #250's body still describes the core as assembled on 2026-10-30; what it carries now is #367's body (the merge
  record). The owner may want #250's body to point there before word 2; this row changes no PR body.

## 2. The checks before each word

Run from any clone (`git fetch origin --prune` first). `$DEMO` is the demo commit FREEZE-E2E recorded in
`docs/queue/FREEZE-E2E.md` on `claude/work-ledger`.

**Before word 1 (#367 into `claude/core`):**

1. FREEZE-E2E's status says `done`, names `$DEMO`, and says whether `claude/clean-product` went in.
2. The tip did not move since: `git rev-parse origin/claude/demo-fixes-2` equals `$DEMO`, and #367's head is the
   same commit (the PR page, or `gh pr view 367 --json headRefOid`).
3. CI green **on that head**: #367's checks `gate` and `deploy` both success for `$DEMO`, not for an earlier head
   (`gh pr checks 367`). A green `gate` job is the full `scripts/gate.sh`, absence checks included: its step *No skip
   but those the runner cannot open* fails on any skip but the viewer's cross-codec arm.
4. The gate's absence checks green in that run's log: `client: absence check`, `server: absence check`, and, if
   CLEAN-PRODUCT went in, its lab check (`scripts/check_lab_absent.sh`):
   `gh run view <run id> --log | grep -A3 'absence check'`.
5. `main` unchanged since writing, and inside the tip: `git rev-parse origin/main` is `017a3ca6…`, and
   `git merge-base --is-ancestor origin/main $DEMO` succeeds. If `main` moved, the new commits must be ancestors of
   `$DEMO` too, or the word waits for them to be merged into the tip (by a blocker fix and a new FREEZE-E2E).
6. `claude/core` unchanged and inside the tip: `git rev-parse origin/claude/core` is `2e6fa5b2…`, and
   `git merge-base --is-ancestor origin/claude/core $DEMO` succeeds.

**Before word 2 (#250 into `main`):**

1. `claude/core` is now word 1's merge commit: `git rev-parse origin/claude/core^2` equals `$DEMO`, and
   `git diff --quiet $DEMO origin/claude/core` (the same tree).
2. #250's head is that merge commit, and its CI ran on it: `gate` and `deploy` success (`gh pr checks 250`). The
   `deploy` failure of 2026-10-30 is on `2e6fa5b2` and does not count either way; `core-ci-deploy` (#336, carried)
   fixed its cause.
3. The absence checks green in that run's log, as in word 1's step 4.
4. `main` unchanged since word 1's checks (`017a3ca6…`) and an ancestor of `claude/core`:
   `git merge-base --is-ancestor origin/main origin/claude/core`.

## 3. What PRE-DEMO checks on `main` after

PRE-DEMO's brief already checks the demo commit (CI green, nothing moved since FREEZE-E2E, README §Demo starts the
servers from a fresh clone). After the two words, on `main`:

1. `main`'s tree is the demo commit's: `git diff --quiet $DEMO origin/main` (word 2's merge commit's tree equals
   word 1's, which equals `$DEMO`'s, as §1 shows). If it differs, the demo is given from `$DEMO` and the difference is
   reported, not fixed on `main`.
2. CI on `main`'s new head: the push run of `gate` and `deploy` success.
3. README §Demo word for word from a fresh clone of `main`, as for the demo commit; the dev certificate still valid.
4. The ancestry the next section relies on still holds: each branch in §4.1 is an ancestor of `origin/main`
   (`git merge-base --is-ancestor`). Only then are the closes and deletes of §4 the owner's to give.

## 4. What the two merges carry, and what they do not

Read with `git merge-base --is-ancestor origin/<branch> origin/claude/demo-fixes-2` for every remote branch, at
`d46811c6`: 304 remote branches, 239 open PRs. After both words `main` contains the tip, so a branch whose tip is an
ancestor of the tip is carried **in full**. Re-run it after word 2 against `origin/main` before closing or deleting
anything (the script is in §5); a branch that moved since is no longer carried in full.

| | branches | open PRs |
| --- | --- | --- |
| already in `main` | 7 (with `main`) | 0 |
| carried in full by the two merges | 76 | 63 (with #367 and #250) |
| not carried in full | 221 | 176 |

### 4.1 Carried in full: these can be closed or deleted after word 2

**Open PRs.** GitHub marks a PR merged on its own when its head lands in its base by a push; that holds here for the
PRs into `claude/core` (after word 1) and into `main` (#341 after word 2). The rest have bases the words do not move
(`claude/oq-depth-cut`, `claude/demo-fixes-0`, …) and are closed by hand, saying they landed in `main` with word 2.

| PR | branch | base | tip |
| --- | --- | --- | --- |
| #367 | `claude/demo-fixes-2` | `claude/core` | `d46811c6` |
| #365 | `claude/demo-ux` | `claude/demo-fixes-1` | `14605f41` |
| #364 | `claude/source-fingerprint` | `claude/demo-fixes-1` | `c02b5f32` |
| #363 | `claude/demo-fixes-1` | `claude/core` | `daee0d1d` |
| #362 | `claude/demo-e2e-2-fixes` | `claude/demo-fixes-0` | `25c49738` |
| #361 | `claude/demo-view-worker` | `claude/demo-fixes-0` | `8f43ca7d` |
| #360 | `claude/phone-no-install` | `claude/demo-fixes-0` | `136c19f4` |
| #356 | `claude/demo-essentials` | `claude/demo-fixes-0` | `9cf2b4f3` |
| #355 | `claude/demo-fixes-0` | `claude/core` | `36d286cd` |
| #354 | `claude/demo-e2e-2` | `claude/core-next-fixes` | `9db541be` |
| #353 | `claude/core-next-fixes` | `claude/core-next` | `9eee7181` |
| #351 | `claude/core-next` | `claude/core` | `3ddc0aed` |
| #349 | `claude/double-decode-check` | `claude/core` | `c83a7465` |
| #348 | `claude/oq-depth-cut-fixes` | `claude/oq-depth-cut` | `886d05b9` |
| #346 | `claude/demo-e2e` | `claude/oq-depth-cut` | `fe28ce84` |
| #345 | `claude/core-int8-fixes` | `claude/core-int8` | `6bedbd60` |
| #344 | `claude/phone-setup-fixes` | `claude/phone-setup` | `efbda4f8` |
| #343 | `claude/phone-pair` | `claude/phone-setup` | `52b96463` |
| #342 | `claude/oq-ingest-fixes` | `claude/oq-ingest` | `a7bbadc1` |
| #341 | `claude/gate-cloud` | `main` | `7540c767` |
| #337 | `claude/core-int8` | `claude/core` | `30e8228f` |
| #336 | `claude/core-ci-deploy` | `claude/core` | `c8efab0e` |
| #330 | `claude/phone-setup` | `claude/core` | `d8a706c1` |
| #328 | `claude/oq-depth-cut` | `claude/core` | `6f61ff0b` |
| #327 | `claude/oq-client-fixes` | `claude/oq-client` | `77709134` |
| #321 | `claude/oq-ingest` | `claude/core` | `36508b0a` |
| #320 | `claude/oq-client` | `claude/core` | `51b5d256` |
| #302 | `claude/core-repaint-fix` | `claude/core` | `ef122ec6` |
| #299 | `claude/core-review2` | `claude/core` | `3ceef49f` |
| #289 | `claude/core-fold-2026-11-02` | `claude/core` | `0920153d` |
| #253 | `claude/native-view-review` | `claude/native-view` | `90d3f39b` |
| #252 | `claude/vw-exp-2-review` | `claude/vw-exp-2` | `32ac529b` |
| #250 | `claude/core` | `main` | `2e6fa5b2` |
| #247 | `claude/native-view` | `claude/native-view-design-mrev` | `141f66e7` |
| #246 | `claude/vw-exp-2` | `claude/view-worker-want` | `34ec83c0` |
| #245 | `claude/vw-exp-3` | `claude/view-worker-want` | `c3e65d44` |
| #244 | `claude/vw-cache` | `claude/view-worker-want` | `6466bbed` |
| #243 | `claude/vw-exp-1` | `claude/view-worker-want` | `33222f02` |
| #242 | `claude/opfs-arms-d` | `claude/opfs-arms` | `8f541300` |
| #241 | `claude/frame-memory-m5` | `claude/frame-memory` | `42294986` |
| #240 | `claude/native-view-design-mrev` | `claude/native-view-design` | `96dc1b32` |
| #239 | `claude/vw-experiments` | `claude/view-worker-target-rev` | `9a829a49` |
| #238 | `claude/view-worker-want` | `claude/view-worker` | `34ebe332` |
| #237 | `claude/recv-loop` | `claude/view-worker-target-rev` | `cf38708b` |
| #236 | `claude/native-view-design` | `claude/native-core-2` | `e705ddbb` |
| #235 | `claude/view-worker-target-rev` | `claude/view-worker-target` | `7f335cc0` |
| #232 | `claude/review-blind` | `claude/view-worker-target` | `a429a6c1` |
| #231 | `claude/review-red` | `claude/view-worker-target` | `9e5bd9c0` |
| #229 | `claude/view-worker` | `main` | `9c90104e` |
| #228 | `claude/view-worker-target` | `main` | `8ea7281f` |
| #227 | `claude/opfs-arms` | `claude/opfs-cache-fixes` | `57aec111` |
| #226 | `claude/frame-memory` | `claude/opfs-cache-fixes` | `cd60e0a5` |
| #225 | `claude/worker-clock` | `main` | `729f7de6` |
| #218 | `claude/native-fill` | `claude/native-core-2` | `ba56ebd0` |
| #216 | `claude/native-window` | `claude/native-paint` | `c3344986` |
| #212 | `claude/opfs-cache-fixes` | `claude/opfs-cache-measure` | `cff900bd` |
| #209 | `claude/native-cache` | `claude/native-core-2` | `a237cf3e` |
| #206 | `claude/native-paint` | `claude/native-core-2` | `642c0853` |
| #201 | `claude/native-core-2` | `claude/native-core-1` | `d9d7ac77` |
| #198 | `claude/native-core-1` | `claude/native-wire` | `f84ac3fb` |
| #189 | `claude/native-wire` | `claude/av1-unified-mainbase` | `86a14b68` |
| #132 | `claude/opfs-persist-sources` | `claude/design-opfs-cache` | `6bbe2d2c` |
| #124 | `claude/design-opfs-cache` | `claude/av1-unified-mainbase` | `bd4bc8a7` |

**Branches without an open PR, carried in full:** `claude/av1-complementary` (`5fd99d5a`), `claude/av1-lcevc-2026` (`50915873`), `claude/av1-unified-mainbase` (`696c15d6`), `claude/demo-clean` (`abbb441d`), `claude/demo-redteam` (`fcb60833`), `claude/demo-review-blind` (`c9ffd76d`), `claude/demo-tests-mobile` (`439a2556`), `claude/jxl-single-frames` (`ee183760`), `claude/nightly-xxh3-pin` (`9877ea94`), `claude/rustls-advisories-mainbase` (`f59aace7`), `claude/viewer-architecture` (`87797a02`), `claude/viewer-integration` (`d5d8c361`), `claude/viewer-survey` (`a67d7e60`).

**Already in `main` before the words** (can be deleted now, nothing to close): `claude/deploy-prebuilt-server`, `claude/docs-lines`, `claude/docs-lines-2`, `claude/lab-out-of-product-2yftz0`, `claude/rustls-advisories-main`, `claude/tidy-open-prs-ljtmay`.

**Do not delete a carried branch that is still the base of an open PR the words do not carry**, or GitHub closes
that PR: `claude/av1-unified-mainbase` (the base of 63 open PRs: the earlier lines and studies), `claude/core` (14:
#260–#267, #273, #294, #296, #298, #301, #303), `claude/demo-fixes-2` (#368, #369, #370), `claude/demo-fixes-0`
(#359), `claude/frame-memory-m5` (#259), `claude/native-core-2` (#211), `claude/opfs-arms-d` (#285),
`claude/opfs-persist-sources` (#187), `claude/viewer-architecture` (#214), `claude/vw-exp-1` (#248),
`claude/worker-clock` (#249). Close or retarget those PRs first, or keep the branch.

### 4.2 Not carried in full, and why

"Commits not in the tip" counts `git rev-list --count origin/claude/demo-fixes-2..origin/<branch>`; a small count on a
branch an earlier fold names (for example #249, #248, #259, #285, which #250's body lists as folded) means commits
were pushed to it after its fold, and those commits are what is not carried. Nothing here is closed by the two words;
each is the owner's call, on its own evidence.

Why, in four kinds:

* **On the demo tip, not for the demo** (#368, #369, #370): proposals and phone tooling into `claude/demo-fixes-2`;
  they stay open after the words, retargeted to `main` or kept on their branch.
* **Their own PRs into `main`, off the demo path** (docs and lab PRs such as #366, #358, #357, #350, #340, #339, #338,
  #335, #334, #331, #329, #324): each decided on its own; the words neither take nor close them.
* **Into `claude/core`, not folded into the demo path** (#260–#267, #273, #294, #296, #298, #301, #303): measurement
  runs and proposals from before the demo; after word 1 their diffs against `claude/core` include the demo work.
* **Earlier lines and studies** (everything else, most built on `claude/av1-unified-mainbase` or the PACS, metadata,
  native, viewer and OPFS lines): off the demo path. The coordination line's inventory
  (`claude/repo-inventory:docs/inventory-2026-11-09.md`) holds a proposed action for each.

| PR | branch | base | commits not in the tip | why |
| --- | --- | --- | --- | --- |
| #370 | `claude/telemetry-client` | `claude/demo-fixes-2` | 31 | a proposal or tool on the demo tip, not for the demo |
| #369 | `claude/phone-tools` | `claude/demo-fixes-2` | 16 | a proposal or tool on the demo tip, not for the demo |
| #368 | `claude/oq-integrity-build` | `claude/demo-fixes-2` | 42 | a proposal or tool on the demo tip, not for the demo |
| #366 | `claude/fable-simplify` | `main` | 2 | its own PR into `main`, off the demo path |
| #359 | `claude/phone-protocol` | `claude/demo-fixes-0` | 3 | carried up to its merge in #365; the second amendment of `docs/devices.md` §7 came after |
| #358 | `claude/proposals` | `main` | 99 | its own PR into `main`, off the demo path |
| #357 | `claude/av1-corrections` | `main` | 3 | its own PR into `main`, off the demo path |
| #352 | `claude/av1-groups-settings` | `claude/av1-groups` | 101 | an earlier line or study, off the demo path |
| #350 | `claude/docs-lines-3` | `main` | 2 | its own PR into `main`, off the demo path |
| #347 | `claude/demo-e2e-line` | `claude/docs-lines-oq-webcodecs` | 2 | an earlier line or study, off the demo path |
| #340 | `claude/docs-lines-oq-webcodecs` | `main` | 1 | its own PR into `main`, off the demo path |
| #339 | `claude/browser-decoding` | `main` | 17 | its own PR into `main`, off the demo path |
| #338 | `claude/plan` | `main` | 2 | its own PR into `main`, off the demo path |
| #335 | `claude/av1-noise-ratio-line` | `main` | 2 | its own PR into `main`, off the demo path |
| #334 | `claude/av1-audit-decode` | `main` | 2 | its own PR into `main`, off the demo path |
| #332 | `claude/av1-noise-ratio` | `claude/av1-noise-point` | 72 | an earlier line or study, off the demo path |
| #331 | `claude/av1-encoder-settings` | `main` | 4 | its own PR into `main`, off the demo path |
| #329 | `claude/av1-audit-quality` | `main` | 2 | its own PR into `main`, off the demo path |
| #326 | `claude/av1-groups` | `claude/av1-quality-metrics` | 87 | an earlier line or study, off the demo path |
| #325 | `claude/av1-vl-metrics` | `claude/av1-quality-metrics` | 71 | an earlier line or study, off the demo path |
| #324 | `claude/htj2k-tiles` | `main` | 22 | its own PR into `main`, off the demo path |
| #323 | `claude/av1-window-q` | `claude/av1-quality-metrics` | 73 | an earlier line or study, off the demo path |
| #318 | `claude/av1-webcodecs-profiles` | `claude/av1-unified-mainbase` | 1 | an earlier line or study, off the demo path |
| #317 | `claude/av1-noise-point` | `claude/av1-quality-metrics` | 65 | an earlier line or study, off the demo path |
| #316 | `claude/av1-preview-noise` | `claude/av1-snr-preview` | 229 | an earlier line or study, off the demo path |
| #315 | `claude/av1-residual-exact` | `claude/av1-unified-mainbase` | 7 | an earlier line or study, off the demo path |
| #314 | `claude/av1-snr-preview` | `claude/av1-profile-carriers` | 225 | an earlier line or study, off the demo path |
| #313 | `claude/us-data-search` | `claude/av1-unified-mainbase` | 3 | an earlier line or study, off the demo path |
| #312 | `claude/av1-preview-depth` | `claude/av1-quality-metrics` | 49 | an earlier line or study, off the demo path |
| #311 | `claude/av1-split-preview-b` | `claude/av1-quality-profiles` | 102 | an earlier line or study, off the demo path |
| #310 | `claude/av1-top-first` | `claude/av1-unified-mainbase` | 12 | an earlier line or study, off the demo path |
| #309 | `claude/av1-paint-depth` | `claude/av1-unified-mainbase` | 31 | an earlier line or study, off the demo path |
| #308 | `claude/av1-grey-path` | `claude/av1-unified-mainbase` | 8 | an earlier line or study, off the demo path |
| #307 | `claude/av1-lossy-pixel-work` | `claude/av1-unified-mainbase` | 46 | an earlier line or study, off the demo path |
| #306 | `claude/av1-profile-carriers` | `claude/av1-svc-preview` | 174 | an earlier line or study, off the demo path |
| #305 | `claude/av1-quality-metrics` | `claude/av1-quality-profiles` | 70 | an earlier line or study, off the demo path |
| #304 | `claude/av1-top10-why` | `claude/av1-quality-profiles` | 23 | an earlier line or study, off the demo path |
| #303 | `claude/core-onepass` | `claude/core` | 1 | into `claude/core`, not on the demo path |
| #301 | `claude/core-m5b` | `claude/core` | 33 | into `claude/core`, not on the demo path |
| #300 | `claude/viewer-seam2` | `claude/line-viewer` | 27 | an earlier line or study, off the demo path |
| #298 | `claude/core-asking-plan` | `claude/core` | 2 | into `claude/core`, not on the demo path |
| #297 | `claude/viewer-seam` | `claude/line-viewer` | 19 | an earlier line or study, off the demo path |
| #296 | `claude/core-busy2` | `claude/core` | 486 | into `claude/core`, not on the demo path |
| #295 | `claude/htj2k-progressive` | `claude/av1-unified-mainbase` | 33 | an earlier line or study, off the demo path |
| #294 | `claude/core-start2` | `claude/core` | 399 | into `claude/core`, not on the demo path |
| #292 | `claude/av1-lcevc-lossy` | `claude/av1-unified-mainbase` | 1 | an earlier line or study, off the demo path |
| #291 | `claude/av1-visually-lossless` | `claude/av1-unified-mainbase` | 1 | an earlier line or study, off the demo path |
| #290 | `claude/av1-quality-profiles` | `claude/av1-unified-mainbase` | 135 | an earlier line or study, off the demo path |
| #288 | `claude/av1-residual-apart` | `claude/av1-unified-mainbase` | 15 | an earlier line or study, off the demo path |
| #285 | `claude/opfs-arms-run` | `claude/opfs-arms-d` | 47 | an earlier line or study, off the demo path |
| #283 | `claude/av1-svc-preview` | `claude/av1-unified-mainbase` | 89 | an earlier line or study, off the demo path |
| #278 | `claude/native-metrics` | `claude/core-fold-2026-10-30` | 280 | an earlier line or study, off the demo path |
| #277 | `claude/native-parity` | `claude/core-fold-2026-10-30` | 257 | an earlier line or study, off the demo path |
| #276 | `claude/view-start` | `claude/core-fold-2026-10-30` | 311 | an earlier line or study, off the demo path |
| #275 | `claude/paint-read` | `claude/core-fold-2026-10-30` | 293 | an earlier line or study, off the demo path |
| #273 | `claude/core-fold-2026-10-30` | `claude/core` | 252 | into `claude/core`, not on the demo path |
| #267 | `claude/core-native` | `claude/core` | 5 | into `claude/core`, not on the demo path |
| #266 | `claude/core-exp1` | `claude/core` | 6 | into `claude/core`, not on the demo path |
| #265 | `claude/core-exp2` | `claude/core` | 26 | into `claude/core`, not on the demo path |
| #264 | `claude/core-m5` | `claude/core` | 59 | into `claude/core`, not on the demo path |
| #263 | `claude/core-s7` | `claude/core` | 101 | into `claude/core`, not on the demo path |
| #262 | `claude/core-review` | `claude/core` | 13 | into `claude/core`, not on the demo path |
| #261 | `claude/core-perf` | `claude/core` | 16 | into `claude/core`, not on the demo path |
| #260 | `claude/core-decoders` | `claude/core` | 2 | into `claude/core`, not on the demo path |
| #259 | `claude/frame-memory-m5-run` | `claude/frame-memory-m5` | 39 | an earlier line or study, off the demo path |
| #258 | `claude/line-pacs` | `main` | 233 | its own PR into `main`, off the demo path |
| #257 | `claude/merge-order-2026-10-29` | `main` | 1 | its own PR into `main`, off the demo path |
| #256 | `claude/line-hygiene` | `main` | 74 | its own PR into `main`, off the demo path |
| #255 | `claude/line-viewer` | `main` | 16 | its own PR into `main`, off the demo path |
| #254 | `claude/line-server` | `main` | 44 | its own PR into `main`, off the demo path |
| #251 | `claude/cine-no-skip` | `claude/viewer-requirement-fixes` | 9 | an earlier line or study, off the demo path |
| #249 | `claude/worker-clock-build` | `claude/worker-clock` | 2 | an earlier line or study, off the demo path |
| #248 | `claude/vw-exp-1-review` | `claude/vw-exp-1` | 1 | an earlier line or study, off the demo path |
| #234 | `claude/rsync-updates` | `claude/pcs-pacs-options` | 4 | an earlier line or study, off the demo path |
| #233 | `claude/rsync-options` | `claude/pcs-pacs-options` | 4 | an earlier line or study, off the demo path |
| #230 | `claude/pcs-pacs-options` | `claude/av1-unified-mainbase` | 5 | an earlier line or study, off the demo path |
| #224 | `claude/ask-patterns-map` | `claude/ask-patterns-survey` | 2 | an earlier line or study, off the demo path |
| #223 | `claude/sync-b-vs-e` | `claude/update-compression` | 30 | an earlier line or study, off the demo path |
| #222 | `claude/sync-shapes` | `claude/av1-unified-mainbase` | 1 | an earlier line or study, off the demo path |
| #221 | `claude/sync-prior-art` | `claude/av1-unified-mainbase` | 1 | an earlier line or study, off the demo path |
| #220 | `claude/sync-second-writer` | `claude/av1-unified-mainbase` | 1 | an earlier line or study, off the demo path |
| #219 | `claude/ask-patterns-survey` | `main` | 1 | its own PR into `main`, off the demo path |
| #217 | `claude/merge-order-2026-10-28` | `claude/av1-unified-mainbase` | 2 | an earlier line or study, off the demo path |
| #215 | `claude/viewer-a-step1` | `claude/viewer-requirement-fixes` | 7 | an earlier line or study, off the demo path |
| #214 | `claude/viewer-spike` | `claude/viewer-architecture` | 3 | an earlier line or study, off the demo path |
| #213 | `claude/test-race-asyncfd` | `claude/av1-unified-mainbase` | 2 | an earlier line or study, off the demo path |
| #211 | `claude/native-step1-check` | `claude/native-core-2` | 2 | an earlier line or study, off the demo path |
| #210 | `claude/viewer-requirement-fixes` | `claude/av1-unified-mainbase` | 6 | an earlier line or study, off the demo path |
| #208 | `claude/coldrtt-hint` | `claude/av1-unified-mainbase` | 4 | an earlier line or study, off the demo path |
| #207 | `claude/cache-policy` | `claude/opfs-cache-build` | 2 | an earlier line or study, off the demo path |
| #205 | `claude/day-summary-2026-10-27` | `claude/av1-unified-mainbase` | 1 | an earlier line or study, off the demo path |
| #204 | `claude/opfs-cache-measure` | `claude/opfs-cache-build` | 4 | an earlier line or study, off the demo path |
| #203 | `claude/scroll-policies` | `claude/ask-during-fill-measure` | 10 | an earlier line or study, off the demo path |
| #202 | `claude/client-simplify-r5` | `claude/client-audit-r5` | 19 | an earlier line or study, off the demo path |
| #200 | `claude/server-simplify-r5` | `claude/server-audit-r5` | 15 | an earlier line or study, off the demo path |
| #197 | `claude/opfs-cache-build` | `claude/opfs-multigb` | 2 | an earlier line or study, off the demo path |
| #193 | `claude/viewer-requirements` | `claude/av1-unified-mainbase` | 2 | an earlier line or study, off the demo path |
| #190 | `claude/server-audit-r5` | `claude/av1-unified-mainbase` | 2 | an earlier line or study, off the demo path |
| #188 | `claude/client-audit-r5` | `claude/av1-unified-mainbase` | 2 | an earlier line or study, off the demo path |
| #187 | `claude/opfs-multigb` | `claude/opfs-persist-sources` | 1 | an earlier line or study, off the demo path |
| #185 | `claude/sbnd-tail-rewrite` | `claude/late-frame-cost` | 6 | an earlier line or study, off the demo path |
| #182 | `claude/transport-seam` | `claude/carrier-quic-choice` | 6 | an earlier line or study, off the demo path |
| #181 | `claude/carriers-explained` | `claude/pcs-carrier-impl` | 7 | an earlier line or study, off the demo path |
| #180 | `claude/reply-needed` | `claude/pcs-reply-path` | 9 | an earlier line or study, off the demo path |
| #179 | `claude/late-frame-cost` | `claude/av1-unified-mainbase` | 3 | an earlier line or study, off the demo path |
| #178 | `claude/ce-compression-ratios` | `claude/study-db-layout` | 31 | an earlier line or study, off the demo path |
| #177 | `claude/sender-package-build` | `claude/pcs-carrier-impl` | 11 | an earlier line or study, off the demo path |
| #176 | `claude/update-flow` | `claude/design-records-combined` | 24 | an earlier line or study, off the demo path |
| #175 | `claude/sbnd-late-frames` | `claude/av1-unified-mainbase` | 2 | an earlier line or study, off the demo path |
| #174 | `claude/study-index-engines` | `claude/study-index-proto` | 6 | an earlier line or study, off the demo path |
| #173 | `claude/viewer-metadata-gz-row` | `claude/viewer-metadata-measure` | 10 | an earlier line or study, off the demo path |
| #172 | `claude/study-index-placement` | `claude/design-records-combined` | 23 | an earlier line or study, off the demo path |
| #171 | `claude/carrier-quic-choice` | `claude/pcs-carrier-impl` | 5 | an earlier line or study, off the demo path |
| #170 | `claude/pcs-reply-path` | `claude/pcs-carrier-impl` | 5 | an earlier line or study, off the demo path |
| #169 | `claude/receiver-process-map` | `claude/pacs-receiver-impl` | 3 | an earlier line or study, off the demo path |
| #168 | `claude/pacs-design-state` | `claude/av1-unified-mainbase` | 17 | an earlier line or study, off the demo path |
| #167 | `claude/pacs-disk-layout-measure` | `claude/pacs-disk-layout` | 7 | an earlier line or study, off the demo path |
| #166 | `claude/viewer-metadata-measure` | `claude/viewer-metadata-design` | 7 | an earlier line or study, off the demo path |
| #165 | `claude/study-index-proto` | `claude/study-index-design` | 4 | an earlier line or study, off the demo path |
| #164 | `claude/pcs-carrier-impl` | `claude/pcs-carrier` | 6 | an earlier line or study, off the demo path |
| #163 | `claude/pacs-receiver-impl` | `claude/av1-unified-mainbase` | 11 | an earlier line or study, off the demo path |
| #162 | `claude/serve-by-uid-impl` | `claude/av1-unified-mainbase` | 3 | an earlier line or study, off the demo path |
| #161 | `claude/study-db-layout` | `claude/parser-metadata-measure` | 28 | an earlier line or study, off the demo path |
| #160 | `claude/verify-tool` | `claude/av1-unified-mainbase` | 4 | an earlier line or study, off the demo path |
| #159 | `claude/metadata-consolidated` | `claude/av1-unified-mainbase` | 44 | an earlier line or study, off the demo path |
| #158 | `claude/design-records-combined` | `claude/av1-unified-mainbase` | 20 | an earlier line or study, off the demo path |
| #157 | `claude/sqlite-lock-behaviour` | `claude/sqlite-engine-fair` | 31 | an earlier line or study, off the demo path |
| #156 | `claude/update-compression` | `claude/metadata-repetition` | 25 | an earlier line or study, off the demo path |
| #155 | `claude/pcs-carrier` | `claude/pcs-transfer-design` | 5 | an earlier line or study, off the demo path |
| #154 | `claude/parser-metadata-measure` | `claude/metadata-repetition` | 25 | an earlier line or study, off the demo path |
| #153 | `claude/viewer-metadata-design` | `claude/av1-unified-mainbase` | 2 | an earlier line or study, off the demo path |
| #152 | `claude/pacs-disk-layout` | `claude/av1-unified-mainbase` | 1 | an earlier line or study, off the demo path |
| #151 | `claude/sqlite-engine-fair` | `claude/sqlite-engine-eval` | 26 | an earlier line or study, off the demo path |
| #150 | `claude/metadata-repetition` | `claude/metadata-update-cost` | 23 | an earlier line or study, off the demo path |
| #149 | `claude/pcs-transfer-design` | `claude/av1-unified-mainbase` | 1 | an earlier line or study, off the demo path |
| #148 | `claude/metadata-updates-design` | `claude/av1-unified-mainbase` | 2 | an earlier line or study, off the demo path |
| #147 | `claude/sqlite-engine-eval` | `claude/metadata-update-cost` | 24 | an earlier line or study, off the demo path |
| #146 | `claude/study-index-design` | `claude/av1-unified-mainbase` | 1 | an earlier line or study, off the demo path |
| #145 | `claude/display-metadata-design` | `claude/av1-unified-mainbase` | 2 | an earlier line or study, off the demo path |
| #144 | `claude/metadata-update-cost` | `claude/metadata-pair-bench` | 21 | an earlier line or study, off the demo path |
| #143 | `claude/telemetry-production-design` | `claude/av1-unified-mainbase` | 2 | an earlier line or study, off the demo path |
| #142 | `claude/serve-by-uid-design` | `claude/av1-unified-mainbase` | 1 | an earlier line or study, off the demo path |
| #140 | `claude/tracker-fix-gso-tiles` | `claude/av1-unified-mainbase` | 1 | an earlier line or study, off the demo path |
| #139 | `claude/pgo-measure` | `claude/av1-unified-mainbase` | 3 | an earlier line or study, off the demo path |
| #138 | `claude/askjump-measure` | `claude/av1-unified-mainbase` | 3 | an earlier line or study, off the demo path |
| #137 | `claude/tailping-theory` | `claude/av1-unified-mainbase` | 1 | an earlier line or study, off the demo path |
| #136 | `claude/readmin-cut-stream` | `claude/av1-unified-mainbase` | 2 | an earlier line or study, off the demo path |
| #135 | `claude/ask-during-fill-measure` | `claude/design-p2-ask-during-fill` | 5 | an earlier line or study, off the demo path |
| #134 | `claude/simplification-u9-u12-audit` | `claude/design-simplification-sweep` | 3 | an earlier line or study, off the demo path |
| #133 | `claude/decoders-committed` | `claude/av1-unified-mainbase` | 1 | an earlier line or study, off the demo path |
| #131 | `claude/server-licence-notices` | `claude/av1-unified-mainbase` | 1 | an earlier line or study, off the demo path |
| #130 | `claude/d4-workstation-results` | `claude/av1-unified-mainbase` | 2 | an earlier line or study, off the demo path |
| #129 | `claude/deploy-dry-run` | `main` | 15 | its own PR into `main`, off the demo path |
| #127 | `claude/queue-status-232-236` | `claude/av1-unified-mainbase` | 1 | an earlier line or study, off the demo path |
| #126 | `claude/metadata-pair-bench` | `claude/metadata-format-survey` | 18 | an earlier line or study, off the demo path |
| #125 | `claude/design-simplification-sweep` | `claude/av1-unified-mainbase` | 2 | an earlier line or study, off the demo path |
| #123 | `claude/design-disk-scaling` | `claude/av1-unified-mainbase` | 1 | an earlier line or study, off the demo path |
| #122 | `claude/design-congestion-controller` | `claude/av1-unified-mainbase` | 1 | an earlier line or study, off the demo path |
| #121 | `claude/design-p2-ask-during-fill` | `claude/av1-unified-mainbase` | 1 | an earlier line or study, off the demo path |
| #120 | `claude/metadata-format-survey` | `claude/metadata-turso` | 13 | an earlier line or study, off the demo path |
| #119 | `claude/pacs-receiver-design` | `claude/metadata-turso` | 12 | an earlier line or study, off the demo path |
| #118 | `claude/page-open-metadata` | `claude/metadata-turso` | 12 | an earlier line or study, off the demo path |
| #117 | `claude/arm64-server-build` | `main` | 1 | its own PR into `main`, off the demo path |
| #116 | `claude/smoke-not-a-default` | `main` | 1 | its own PR into `main`, off the demo path |
| #115 | `claude/deploy-readme-host-nginx` | `main` | 1 | its own PR into `main`, off the demo path |
| #114 | `claude/page-without-transport-file` | `main` | 5 | its own PR into `main`, off the demo path |
| #113 | `claude/metadata-turso` | `claude/av1-unified-mainbase` | 13 | an earlier line or study, off the demo path |
| #112 | `claude/test-separation` | `main` | 8 | its own PR into `main`, off the demo path |
| #103 | `claude/wip-260-FILLWINDOW` | `claude/av1-unified-mainbase` | 7 | an earlier line or study, off the demo path |
| #102 | `claude/wip-259-TILEWILLNEED` | `claude/av1-unified-mainbase` | 10 | an earlier line or study, off the demo path |
| #96 | `claude/wip-276-ONEQUEUEPRODUCT` | `claude/av1-unified-mainbase` | 3 | an earlier line or study, off the demo path |
| #88 | `claude/wip-258-EXECGAP` | `claude/av1-unified-mainbase` | 8 | an earlier line or study, off the demo path |
| #41 | `claude/project-thread-9jumbi-189` | `claude/av1-unified-mainbase` | 2 | an earlier line or study, off the demo path |
| #40 | `claude/project-thread-9jumbi-212` | `claude/av1-unified-mainbase` | 1 | an earlier line or study, off the demo path |
| #39 | `claude/project-thread-9jumbi` | `claude/av1-unified-mainbase` | 1 | an earlier line or study, off the demo path |
| #37 | `ccr-10b47d42-tr6zpv` | `claude/av1-unified-mainbase` | 1538 | an earlier line or study, off the demo path |

**Branches without an open PR, not carried in full** (commits not in the tip, last commit date):
`claude/audit-measure` (15, 2026-11-11), `claude/av1-mainbase` (1419, 2026-10-17), `claude/av1-pre-main` (1134, 2026-10-12), `claude/av1-unified-pre-main` (1450, 2026-10-11), `claude/av1-unified` (1450, 2026-10-11), `claude/av1` (1137, 2026-10-12), `claude/beeper-ebpf-explore` (2, 2026-10-29), `claude/clean-product` (10, 2026-11-11), `claude/client-architecture-division-rfri34` (1, 2026-11-06), `claude/core-clock` (319, 2026-11-03), `claude/core-s7-fixed` (418, 2026-11-03), `claude/dataset-hub` (1, 2026-11-11), `claude/dav1d-lazy` (84, 2026-11-11), `claude/demo-pre-main-review` (4, 2026-11-11), `claude/demo-review-2` (6, 2026-11-11), `claude/demo-simplify` (1, 2026-11-11), `claude/demo-understand` (6, 2026-11-11), `claude/next-ideas-cdydy8` (2, 2026-10-17), `claude/onerror` (1, 2026-10-03), `claude/opfs-c-shared` (298, 2026-11-04), `claude/opfs-theory` (272, 2026-11-03), `claude/oq-integrity` (84, 2026-11-11), `claude/phone-devtools` (12, 2026-11-11), `claude/phone-run` (3, 2026-11-11), `claude/probe-sched-20261029-gh-yes` (1, 2026-10-29), `claude/project-thread-9uugfm` (26, 2026-10-21), `claude/repo-inventory` (1, 2026-11-09), `claude/reviews-2026-11-10` (7, 2026-11-10), `claude/rootless-podman-and-selinux` (1, 2026-11-09), `claude/serene-rubin-wakfg7` (3, 2026-10-30), `claude/slice-touch` (1, 2026-11-11), `claude/video-containers-research-ed5fg2` (4, 2026-10-16), `claude/wip-208-DOCKERCLOUD` (11, 2026-10-14), `claude/wip-210-ASKTHENFILLMEASURE` (1559, 2026-10-14), `claude/wip-211-ASKFIRSTCAPMEASURE` (1568, 2026-10-14), `claude/wip-212-CCMEASURE` (1562, 2026-10-14), `claude/wip-213-INTERSLICE` (1558, 2026-10-14), `claude/wip-214-DISPLAYTAGS` (1560, 2026-10-14), `claude/wip-215-CLEANAUDIT` (1556, 2026-10-14), `claude/wip-219-VIEWERASKS` (2, 2026-10-14), `claude/wip-226-GATEGAPS` (2, 2026-10-14), `claude/wip-252-ONEQUEUEBUILD` (2, 2026-10-16), `claude/wip-253-ONEQUEUEMEASURE` (7, 2026-10-16), `claude/wip-dockerread` (1557, 2026-10-13), `claude/work-ledger` (356, 2026-11-11).

Among them, still in use this week: `claude/work-ledger` (the queue), `claude/clean-product` (CLEAN-PRODUCT; carried
once FREEZE-E2E merges it, which this table cannot show yet), `claude/phone-run` and `claude/phone-devtools` (the
phone session), the findings branches `claude/demo-simplify`, `claude/demo-understand`, `claude/demo-review-2`,
`claude/demo-pre-main-review`, `claude/slice-touch`, `claude/dataset-hub`, `claude/reviews-2026-11-10`, the theory
branches `claude/oq-integrity` and `claude/dav1d-lazy`, and this one, `claude/merge-plan`.

## 5. The ancestry, re-run

```bash
git fetch origin --prune
T=origin/main   # after word 2; origin/claude/demo-fixes-2 before word 1
git for-each-ref --format='%(refname:short)' refs/remotes/origin | grep -v '^origin\(/HEAD\)\?$' | while read -r r; do
  git merge-base --is-ancestor "$r" "$T" && echo "carried ${r#origin/}" || echo "not ${r#origin/} $(git rev-list --count "$T..$r")"
done | sort
```

The open PRs' heads come from the PR list (`gh pr list --state open --limit 300 --json number,headRefName,baseRefName`);
a PR is carried when its head branch is.

Fixtures and limits: one read of `origin` at 19:48–19:55 UTC; CI states from GitHub's check runs at that time; no
gate run here (docs only). The branch counts change with every push; the commands above are the source of truth.
