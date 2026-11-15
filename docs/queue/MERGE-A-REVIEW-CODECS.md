state: started
started: 2026-11-15T18:41Z
heartbeat: 2026-11-15T18:46Z
outputs: findings in PR 398's body (in progress)
## Resume
Done: frozen list 34/34 tips match; (b) remerge.sh: every merge's tree equals git merge-tree's outside its
conflicted files, conflicted sets equal the plan's §3 A1 column; code resolutions (de18dbf0, a57236ba) read: as cited.
lost-lines.txt: lines of either side absent from each conflicted file's result. Next: read the big ones
(a4157c50 docs/av1/webcodecs-profiles.md tip side 98/310 lost; 928aaaf1 docs/lines/codecs.md), then (c) the gate.
Scripts: docs/queue/MERGE-A-REVIEW-CODECS/{remerge.sh,lost.sh} <unified-codecs> <merge-a-codecs>.
(a) read: a4157c50's webcodecs-profiles.md (tip's = branch's first commit 2561968a; branch's later fix taken: right),
line-doc merges carry what their messages say (spot-checked Open 8-11, decisions 0.6, the 12-bit claim). No finding yet.
Now (c): docs/queue/MERGE-A-REVIEW-CODECS/run.sh (MERGE-BASELINE's tip.sh on a worktree of a47b72bcd1, its own
CARGO_TARGET_DIR; prereqs: apt nginx mesa-vulkan-drivers xdotool libxkbcommon-x11-0, pip meson==1.9.1 then
ingest/requirements.txt separately, rustup wasm32, cargo install wasm-pack 0.15.0). Then compare to the baseline's
unified-codecs table and MERGE-A-CODECS's; write findings into PR 398's body.
## Result
