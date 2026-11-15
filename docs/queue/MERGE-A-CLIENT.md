state: started
started: 2026-11-15T17:41Z
heartbeat: 2026-11-15T18:09Z
outputs: claude/merge-a-client 68a41678b7 (in progress)
## Resume
Merges done: all 62 rows of MERGE-INVENTORY-2 §4 A4 on claude/merge-a-client 68a41678 (pushed; 62 of 62 frozen tips are
merge parents). Now: the gate. Prereqs (fresh container): dockerd, pip meson==1.9.1 + ingest/requirements.txt for
python3.13, apt nginx mesa-vulkan-drivers xdotool libxkbcommon-x11-0 strace xvfb, rustup wasm32, wasm-pack 0.15.0.
Then MERGE-BASELINE/tip.sh's steps in /home/user/mac with CARGO_TARGET_DIR=/home/user/target-mac (its own):
transport wasm, decoder vendors, decode wasm, ingest/tools.sh, scripts/gate.sh, cargo build warnings,
check_lab_absent, comment_budget, counts.sh; then demo-check.mjs both views (MERGE-BASELINE/demo.sh). Then the
comparison table and draft PR into claude/unified-client.
