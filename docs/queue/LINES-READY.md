state: done
started: 2026-11-12 05:01
heartbeat: 2026-11-12 06:35
outputs: claude/lines-ready 96d33ad0 (docs/reviews/lines-ready.md; docs/lines/coordination.md §Open 3), no PR (findings, docs only)
## Resume
Done; nothing left for this row. The UNIFY rows read docs/reviews/lines-ready.md §7 (the mapping) and §2–§4 (per branch).
## Result
* Read at 05:00–06:10 UTC against the demo tip claude/demo-fixes-2 18d2d1ff. Nothing merged; trial merges in a scratch worktree, aborted.
* No line branch is in the tip by patch, and none merges onto it cleanly: hygiene 29 conflicted files, server 3, pacs 6, viewer 6.
* Gate on the merged tree not run (resolving conflicts = preparing a merge). In its place: each PR's 10-30 CI (gate green on #254,
  #255, #256, #258; deploy red on #258 only) and each branch's default series-server built: no lab source, no lab default member
  (the check shown to fire with --features lab-frame-cache).
* line-hygiene (#256): product hygiene worth bringing, mostly absent from the tip (tests.rs split, licence notices, arm64 build,
  AsyncFd fix, fifth-round V3/V9/V10); V8 superseded.
* line-server (#254): docs and rows worth bringing; rows 258-260's arms sit in product modules, not adopted: leave in history.
* line-pacs (#258): crates and serve-by-UID are proposals awaiting metadata.md §Open 3; labs done; 6 commits of #167/#168/#230/
  #233/#234 missing from it.
* line-viewer (#255): parked; #297, #300, #251 not on it.
* Mapping (§7): client+OQ+native -> unified-client; codecs -> unified-codecs (from av1-unified-mainbase); server and hygiene have no
  line doc; metadata -> unified-pacs; viewer and coordination none.
* Fixtures and limits: one read of origin; no gate on any merged tree; review state from titles, bases and status files only.
* Owner: line docs for server and hygiene or not; hygiene's V1 (seven lab dirs) and #116 (no default series); line-server's arms.
