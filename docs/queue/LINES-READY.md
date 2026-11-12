state: started
started: 2026-11-12 05:01
heartbeat: 2026-11-12 05:20
outputs: claude/lines-ready (findings, docs only)
## Resume
Done (not yet pushed as a doc): cherry and trial merges onto the demo tip 18d2d1ff in a scratch worktree (aborted):
none of line-hygiene (29 conflicted files), line-server (3), line-pacs (6), line-viewer (6) merges cleanly; git cherry
shows no commit of any line already in the tip by patch. Next: classify each branch's commits (product worth bringing,
experiment in use, superseded), cleaning-rule check, PR mapping, write docs/reviews/lines-ready.md on claude/lines-ready.
Recompute: for b in line-hygiene line-server line-pacs line-viewer; do git cherry origin/claude/demo-fixes-2 origin/claude/$b; done
## Result
