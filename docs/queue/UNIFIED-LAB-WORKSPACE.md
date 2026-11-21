state: started
started: 2026-11-21T11:46Z
heartbeat: 2026-11-21T11:47Z
outputs: claude/lab-workspace (not yet created)
## Resume
Plan (from origin/claude/unified 4a2b4277f): lab/Cargo.toml a workspace of the five crates no product feature names
(disk-access-bench, container-bench, window-harness, telemetry-bench, metadata-store), excluding cc-classify and
server-telemetry (series-server's optional deps, stay root members); the root's [patch.crates-io], release profile and
workspace.dependencies copied; lab/Cargo.lock pruned from the root's (no version moves); lab/.cargo/config.toml
target-dir ../target so every script's target/release/<bin> path holds; lab scripts and READMEs build lab crates by
`(cd lab && cargo ...)`; gate step split; Containerfile and both ignore files drop the five. Next: write it.
## Result
