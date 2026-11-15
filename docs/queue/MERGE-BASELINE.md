state: done
started: 2026-11-15T12:41Z
heartbeat: 2026-11-15T14:41Z
outputs: claude/work-ledger:docs/queue/MERGE-BASELINE-report.md, raw logs and scripts in docs/queue/MERGE-BASELINE/
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
Five tips measured at e5b20cba8d (unified-client), 9c050c073b (codecs), b9abdc290f (server), 7afeb9cac2 (pacs),
8d5112fd74 (line-hygiene): every full gate OK (pacs on its 4th attempt: one unexplained viewer-check failure in
attempt 1, one proxy-port collision in attempt 3); series-server tests 134/135/140/151/130 default; one default-build
warning (tokio deprecation) on four tips, none on line-hygiene; comment budget OK everywhere; check_lab_absent.sh only
on unified-client, OK; web image ~94.8-94.9 MB where built; server image not buildable here (proxy refuses plain-HTTP
apt). demo-check.mjs on unified-client, dbts_a1-q8-g8-cut: passed, page and worker. Fixtures: the repository's for
the gate; dbts_a1 alone of the three DBT volumes for the demo check; 4-core cloud host, no GPU, headless Chromium
(playwright 1.63.0, not the pinned 1.56.1), no Firefox.
Host limit for the next rows: a CARGO_TARGET_DIR per worktree (a shared one serves stale artifacts across tips).
