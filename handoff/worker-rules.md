# Rules for every worker today (2026-10-15)

Repository: dary-dc/wt-pacs, local clone /home/user/wt-pacs (do not change its checkout; use your own worktree).
SP=/tmp/claude-0/-home-user-wt-pacs/2ce64a11-5f26-57e7-b016-bd416db51bc6/scratchpad

1. Worktree: `cd /home/user/wt-pacs && git fetch origin && git worktree add -b claude/wip-<row>-<NAME> $SP/w<row> origin/claude/av1-unified-mainbase`.
   Always absolute paths. Never touch other worktrees.
2. Prerequisites (decoder builds, hasher vendor, node_modules, WASM pkg, paint frames, dev cert): copy them in with
   `cp -r $SP/kit/. $SP/w<row>/` (they are git-ignored). Ingest coders: `export INGEST_BUILD=$SP/fresh/ingest/.build PYTHON=$SP/fresh/.venv/bin/python`.
3. Builds, tests and the gate are HEAVY and run one at a time on this 4-core host. Wrap every cargo/npm build, test
   run or gate in: `flock /tmp/wt-pacs-heavy.lock bash -c '<touch this worktree's tracked *.rs, Cargo.toml and build.rs files first (from git ls-files; never create one)> && bash client/transport/wasm/build.sh && <command>'`
   with `CARGO_TARGET_DIR=/home/user/cargo-target-shared`. If a script hardcodes target/release, `ln -s /home/user/cargo-target-shared $SP/w<row>/target` (row 234 is fixing that).
   Wait in the foreground for your own commands (use long timeouts); never end your turn while a command you need is still running.
   Known environment caveat: `deploy/check_equivalence.sh --local` fails with nginx 403 because $SP sits under a 0700
   directory; that one gate step is not your failure. Every other step must pass.
4. Read CLAUDE.md first and follow it: essentialist code, the comment rules and budget, docs where they belong,
   mutate every new test (break the code on purpose, watch the test fail, restore), interleave any measured arms.
5. Commits: author and committer `dary-dc <crespoydelgado@gmail.com>` (`git -c user.name=dary-dc -c user.email=crespoydelgado@gmail.com commit ...`),
   no attribution trailers, clear messages. Push only your own branch `claude/wip-<row>-<NAME>`: `git push -u origin claude/wip-<row>-<NAME>`.
   Never push to main, claude/av1-unified-mainbase or claude/av1-mainbase; never force-push; do not open pull requests
   (the orchestrator does). Do not install packages beyond what the repo's own scripts fetch.
6. Disk is limited (about 10 GB free): no new full clones, no extra cargo target dirs; delete scratch you create.
7. Report back, briefly: the branch and head hash, what changed (files, +/− lines), what it removes and the capability
   kept, each check you ran with its result (gate time, named skips), each mutation and that it failed, anything you
   found and did not fix.

## Parallel phase (2026-10-16, while row 253's campaign holds /tmp/wt-pacs-heavy.lock)

The owner asked for parallel work. Row 253 is measuring on this host for hours and holds the heavy lock the whole time.
So, for workers started in this phase, rule 3 changes:
- Builds, unit tests, mutations and the gate run under a SEPARATE lock, one at a time, pinned to the last core at the
  lowest priority, so they barely touch the campaign's timings:
  `flock /tmp/wt-pacs-build.lock nice -n 19 taskset -c 3 bash -c '<touch your tracked files> && <command>'`
  with `CARGO_TARGET_DIR=/home/user/cargo-target-shared` and `CARGO_BUILD_JOBS=1`.
  Expect builds to be slow. Use long timeouts and wait in the foreground.
- Do NOT run any timed measurement (no A/B rounds, no campaigns), and do not take /tmp/wt-pacs-heavy.lock. Build
  the arms, prove each with tests and mutations, run at most one tiny smoke of the rig (untimed, under the build lock),
  write the exact measurement command, push, and report. The orchestrator runs the measurements one at a time
  once the host is free.
- Do not touch $SP/w253, $SP/series252, $SP/bin253 or any rows253* file.
- Disk is tight: also set `CARGO_INCREMENTAL=0` for every cargo command, and delete any `target/` tool cache a WASM build
  creates inside your worktree once your checks are done. Remove nothing else.

## Restart phase (2026-10-16 afternoon, the owner's "continue")

The workers of rows 253 (analysis), 255, 256, 257, 259, 260 and 261 were stopped part-way by a usage limit. Their
worktrees keep their uncommitted work, and a backup of each diff is in `$SP/wip-patches/w<row>.patch`. The owner's word:
"be careful if there's any corrupt or invalid data to discard it, but in general we don't want to throw away work."
- Resume in your existing worktree `$SP/w<row>`; do not re-create it. Read the diff first and judge each part: keep what
  is sound, finish what is half-done, and discard only what is corrupt, invalid or broken beyond a fix, saying in your
  report what you discarded and why.
- Commit your work on your branch early (as dary-dc) and push, so it survives the container.
- Rows 251 (#72) and 254 (#74) are now merged into `origin/claude/av1-unified-mainbase`, so read
  `docs/adr/disk-access.md` §9 from there. Bring unified into your branch with `git merge` (no rebase, no force-push).
- Builds, unit tests, mutations and the gate keep the Parallel phase's build lock (`/tmp/wt-pacs-build.lock`, nice 19,
  `taskset -c 3`, `CARGO_BUILD_JOBS=1`, `CARGO_INCREMENTAL=0`).
- Row 253's campaign is over and the heavy lock is free. Once your arms are built and proven, run your row's timed
  protocol yourself under `flock /tmp/wt-pacs-heavy.lock`, which serializes campaigns: one at a time on the host,
  interleaved arms, nothing else of yours running beside it. Builds of other rows may still run on CPU 3 at nice 19;
  record that in the results. If a protocol would hold the heavy lock for more than about 2 hours, time one round, report
  the estimate, and stop before the campaign. Results go in the docs that own the subject, as the protocol says.
