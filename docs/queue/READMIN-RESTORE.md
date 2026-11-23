state: started
started: 2026-11-23T11:07Z
heartbeat: 2026-11-23T11:09Z
outputs: claude/readmin-restore (pending)
## Resume
Lost at dd681539 (stage B2, "the tip's form" for frame-session.ts and dispatch-rig.ts; its message names 4019518a for the owner).
Pushed: claude/readmin-restore = origin/claude/unified + cherry-pick of b84497b3 (the failing clause). Next: install wasm-pack
(cargo install wasm-pack --version 0.15.0 --locked; rustup target add wasm32-unknown-unknown), client/transport/wasm/build.sh,
run `bash client/contract/run_browser.sh dispatch` and see the readMin clause fail; then cherry-pick 4019518a's frame-session.ts,
rebuild client/transport/ts (build.sh), update manifest.sha256, rerun, mutate, docs (CLIENTS.md, levers.md, merge-readiness.md H3,
design.md contradiction 4), gate, draft PR into claude/unified.
## Result
