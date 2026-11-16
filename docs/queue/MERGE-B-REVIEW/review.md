## Review (MERGE-B-REVIEW, 2026-11-16)

A session that merged nothing in stage B reviewed `claude/unified` at `f0278742` against `claude/merge-a-client` `4520a441`. **One blocker.** It starts amendment 17's loop: MERGE-B-FIX, then MERGE-B-FIX-REVIEW. The scripts and logs are in `claude/work-ledger:docs/queue/MERGE-B-REVIEW/`.

### Blocker

1. **B2 dropped two of `merge-a-server`'s gate checks.** B2's message says it took the tip's `scripts/gate.sh` because "the server side adds no step the tip lacks". It does add two, and `claude/unified` has neither:
   * step "lab: row 258's verdict rule", which runs `python3 lab/scripts/exec_gap_summary_test.py`;
   * the lab-levers line's filters `with_fill_resumes with_an_ask_stream`.

   Both test sets are in the tree and pass when run by hand. The lab-levers line with the server line's filters passes 12 tests, against the 5 the gate's line runs now (`lab-levers-server-filter.log`). `exec_gap_summary_test.py` passes too (`exec-gap.log`). The gate never runs them, though, so the seven lever tests behind `--fill-resumes-after-asks` and `--ask-stream-priority` (the mutant test PR 402 cites included) and the verdict rule are unguarded. No count falls below the baseline's, since `unified-server` ran 5. But PR 399 was reviewed with 12, and this queue's rule is "tests not lost". The fix is to put back both lines in `scripts/gate.sh` and see each fail with its code broken.

### (a) Resolutions against the plan

* There are 4 merges, each `--no-ff`, and their second parents are the tips the PR names.
* Conflicted files by side (`sides.txt`):
  * B1: 42 tip, 1 branch, 11 edited. Of the 42, 39 have the branch's blob in the tip's history. The other 3 are `av1-webcodecs.js`'s `stallMs` and `total-time`'s two files, which are named as not carried.
  * B2: 49 tip (19 old blobs), 6 branch, 10 edited.
  * B3: all 7 edited.
  * B4: 30 tip, 1 branch.
* B4's claim that the tree outside `docs/` and `lab/` is the tip's plus nine added files holds exactly. `lab/` is unchanged by B4.
* `server.rs`: every function of the three versions is present. That covers the tip's 94, `merge-a-server`'s 92 and `unified-pacs`' 98. Four are new: `under_root_a_raw_session_is_refused_as_a_bad_series_name` and three test helpers. `send_window_follows_cwnd` moves under `config.lab`, keeping `conflicts_with = "root"`.
* Rust test functions: none of the tip's, `merge-a-codecs`' or `merge-a-server`'s is gone, and none of `unified-pacs`' 399. The result has 452.
* Minor: hygiene's `server/src/transport/link/tests.rs` holds two tests the tip lacks. They are `a_sessions_streams_rank_an_ask_in_arrival_order` and `asks_first_streams_rank_an_ask_above_the_fills_around_it`, and both test hygiene's `FrameStreams`, which is not carried. So B4's "none holds a test the tip lacks" is not exact. The outcome is still right: the code they test is not here.

### (b) The tree against the mechanical merge (`remerge.txt`)

* B1: no path changed beyond its conflicts.
* B2: 14 paths changed beyond its conflicts, each named in its message.
* B3: one, `lab_levers.rs`, named (the clap rule's move).
* B4: the paths beyond its conflicts are the hygiene hunks put back to the tip's form, as its message says. This is checked by the exact tree diff above.
* There are no conflict markers. The five non-merge commits change only what they name.

### (c) The gate, the browser checks, the baseline

* Builds per README's cloud lines: all 0.
* Gate run 1 **failed** at `client/contract/run_browser.sh`: "1 workers outlived their closed clients", in dispatch over ts (`gate-1.log`). The step alone then passed 4 of 4 times (`run_browser-*.log`).
* Gate run 2: **OK in 713 s**, with the same 57 steps and the same two skips as MERGE-B's `gate-final.log`. So the failure in run 1 is a flake, 1 in 6 runs here, and not a blocker. It is for the owner, or a client-line row.
* `counts.sh`: every line equals MERGE-B's table. Default 161, telemetry 164, lab-levers gate line 5, and the rest as PR 402 lists. No count is below the baseline's.
* The whole lab-levers build passes 160 tests.
* Build warnings: 1, the baseline's tokio deprecation.
* `demo-check.mjs` on `dbts_a1-q8-g8-cut`: **passed, page and worker**. The bundles are 67,815,143 and 4,642,293 B, the baseline's sizes.
* The deploy images:
  * `web` builds, 94,951,257 B.
  * `server`: the committed file cannot be built here, because the proxy refuses plain-HTTP apt.
  * `server` **builds (132,424,697 B)** from a review-only copy of `deploy/Containerfile` whose one apt step fetches over HTTPS with the build CA (`image-server-https.diff`). Both targets were built through `mirror.gcr.io` at the pinned digests, because Docker Hub returned 429. The image was built, not run.

### (d) Absence checks

* `check_lab_absent.sh`: OK.
* The gate's absence steps: OK.
* `comment_budget.sh`: ok.

### For COMPLEXITY-AUDIT

* The gate's `run_browser.sh` flake.
* `read_path.rs`'s two lab arms (`windowing_two_frames`, `advising_past_slots`) are compiled into the default build, though only `lab-levers` reaches them.

The `Generated by` line was removed from this body.

**Fixtures and limits.**
* The gate used the repository's committed fixtures.
* The demo check used `dbts_a1` alone.
* The host was one 4-core cloud host with no GPU, headless Chromium (Playwright 1.63.0) and no Firefox.
* Images were pulled through `mirror.gcr.io` at the pinned digests.
* The server image was built from the HTTPS-apt copy only.
