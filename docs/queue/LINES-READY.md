state: started
started: 2026-11-12 05:01
heartbeat: 2026-11-12 06:15
outputs: claude/lines-ready ea9c2e2d+ (docs/reviews/lines-ready.md, docs/lines/coordination.md), no PR (findings, docs only)
## Resume
Done, raw (scratch only, not yet in the doc): cherry and trial merges onto the demo tip 18d2d1ff, aborted: none of
line-hygiene (29 conflicted files), line-server (3), line-pacs (6), line-viewer (6) merges cleanly; no commit of any
line is in the tip by patch; 10-30 CI on each line PR head (gate green on all four; deploy red on #258 only); open
PR containment computed (240 open PRs, 63 carried by the tip, 103 by neither the tip nor a line branch).
Running: the default series-server build of each line branch, checked for lab sources (as check_lab_absent.sh does).
Pushed: docs/reviews/lines-ready.md (ea9c2e2d) and the coordination.md line. Next: fill §5 from
/tmp/claude-0/lrdata/labbuild.out (re-run: cargo build --release -p series-server on each line branch, grep its .d for
lab/), then status done. Earlier plan was: write docs/reviews/lines-ready.md on claude/lines-ready (per branch: content, merge, gate, cleaning rule,
verdict; then the line doc -> unified branch mapping with PRs), update docs/lines/coordination.md, push, draft PR? no:
findings only, no PR named in the row; status done.
Recompute: for b in line-hygiene line-server line-pacs line-viewer; do git cherry origin/claude/demo-fixes-2 origin/claude/$b; done
## Result
