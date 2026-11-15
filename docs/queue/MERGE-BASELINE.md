state: started
started: 2026-11-15T12:41Z
heartbeat: 2026-11-15T14:01Z
outputs: claude/work-ledger:docs/queue/MERGE-BASELINE-report.md (pending)
## Resume
Running sequentially in one container: per tip (unified-client, unified-codecs, unified-server, unified-pacs,
line-hygiene) a detached worktree, client/transport/wasm/build.sh, the decoder vendor fetches,
client/decode/wasm/build/build.sh, ingest/tools.sh, scripts/gate.sh (PYTHON=python3.13 with ingest/requirements.txt,
the preinstalled playwright 1.63.0 via NODE_PATH), cargo build warnings, check_lab_absent.sh, comment_budget.sh, the
deploy image's server and web targets. Static measures (LOC, URL parameters, features, levers) read with git.
Prereqs a resume must redo: dockerd, pip meson==1.9.1 and requirements.txt, apt nginx mesa-vulkan-drivers xdotool
libxkbcommon-x11-0 strace, rustup wasm32 target, cargo install wasm-pack 0.15.0.
Done: unified-client, unified-codecs, unified-server (first runs, fresh worktrees: valid). Found: one CARGO_TARGET_DIR
shared across worktrees serves stale path-crate artifacts to a worktree older than the last build (cargo hashes path
crates workspace-relatively), so the unified-pacs and line-hygiene reruns (13:48, 13:53) and unified-client's counts
are void. Now: run-3.sh, a target dir per tip (target-<tip>), pacs and hygiene again, then unified-client counts.
Then demo.sh on unified-client (dbts_a1 exact + q8-g8-cut, demo-check both views), assemble.sh, the Result.
## Result
(pending)
