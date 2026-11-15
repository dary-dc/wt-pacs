
## Review (MERGE-A-REVIEW-CLIENT, 2026-11-15, by a session with no commit here): no blocker

Reviewed at `ed11ea72`. The full record and its scripts are in `claude/work-ledger:docs/queue/MERGE-A-REVIEW-CLIENT/`.

* **(a)** 62 of 62 second parents are the frozen A4 tips, in order. The base is unmoved. Of the conflicted files, 351 hold the staging side, 10 the branch's and 40 are edited. The only product code among the branch-side or edited files is `scripts/gate.sh` at fill-split, as its message says. The product delta is PR 376, PR 390 and `check_links.py` with its test. `client/transport/*` is otherwise the base's.
* **Deviations from the plan's §3, both named here and neither a blocker.**
  * `direction`: the tip's whole file was kept in six line docs, where the plan says the branch's lines are "carried by edit". In `codecs.md`, `coordination.md` and `metadata.md`, its §Decided, ranked §Open and §Unsupervised are now in no file of the tree. **UNIFIED-CLEAN's §6 item 5 must carry them back** (`git show a6e27ea5b6:docs/lines/<line>.md`).
  * `native-parity`'s `load`, `look` and `resume.rs` were not added. That is the owner's question above.
* **(b)** 12 merges change paths beyond their conflicts. Each path is named in its message and holds the staging side, except three docs that carry the one sentence their messages announce. There is no marker in the tree. The non-merge commits change only what they name.
* **(c)** GATE OK, 718 s, 53 steps, with the baseline's two skips. `cargo test` counts are equal, except from-parser 2 → 11. The suite lines are equal, plus `beacon` 8/8 and `frame-clock measure` 13/13. There are 274 Rust test functions against 265, and no test of the base is gone. There is one build warning, the baseline's. `demo-check.mjs` passed in both views, with the same bundle sizes.
* **(d)** Every absence check passes, `check_lab_absent.sh` included. The comment budget is ok.
* For COMPLEXITY-AUDIT: 13 new lab test files run outside the gate (`lab/phone/runner.test.mjs` fails here).
* This body's Generated-by line and session link were removed.

**Fixtures and limits.** The gate used the repository's fixtures. The demo check used `dbts_a1` alone. Host: one 4-core cloud host, no GPU, headless Chromium (Playwright 1.63.0), no Firefox. The decoder image's base was pulled through mirror.gcr.io at the pinned digest, because Docker Hub answered 429. The deploy image was not built.
