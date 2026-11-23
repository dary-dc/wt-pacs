state: started
started: 2026-11-23T00:47Z
heartbeat: 2026-11-23T00:57Z
outputs: claude/selinux-build-restore 29a5682aa (PR to come)
## Resume
Done: the decoder build with the flag matches its manifest (cloud, Docker Hub 429 so the pinned digest via mirror.gcr.io); the merge that dropped it is dd681539d (stage B2; all four files of 5ce4f0876 lost their hunks); restored in
29a5682aa. Next: gate on the branch (dockerd; client/decode/wasm/build/build.sh; ingest/tools.sh; scripts/gate.sh),
then the draft PR into claude/unified, docs/lines/<line>.md, done.
## Result
