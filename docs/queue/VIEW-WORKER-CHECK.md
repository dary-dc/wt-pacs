state: started
started: 2026-11-11 01:34
heartbeat: 2026-11-11 01:58
outputs: claude/demo-view-worker (from claude/demo-fixes-0 618e13c8)
## Resume
* claude/demo-view-worker: 66521fc5 the failing check (failed under --view worker before the fix, shown on
  dbts_a1-q8-g8-cut), then the fix (`&view=${VIEW}` in pass()'s URL), passing. Mutants killed: no view in the URL;
  the URL hardcoded to worker under --view page. view/clock.js is already in deploy/web-files.sh.
* Setup done in this container (/tmp/claude-0/setup.sh). Running now: 20 series x {page, worker}, order alternating
  by series, rows appended to docs/reviews/view-worker-check.md on the branch and pushed every few series.
* To continue: skip series already in that file; for the rest, as README §Demo's loop with `--view page` and
  `--view worker`. Then README §Demo mention of --view, docs/lines/client.md note, draft PR into claude/demo-fixes-0.
## Result
