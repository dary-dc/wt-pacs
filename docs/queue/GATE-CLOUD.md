state: done
started: 2026-11-10 04:21
heartbeat: 2026-11-10 05:45
outputs: claude/gate-cloud 7540c767, draft PR #341 into main
## Resume
Done. Commits on claude/gate-cloud: 91a3abd2 (rig skips the HTJ2K frame check without built/xxh3), b1248805 and
7540c767 (README cloud setup, ingest rebuild per branch, docs/lines/coordination.md).
## Result
Cause: dispatch-rig's HTJ2K frame check needs client/decode/wasm/built/xxh3 (build.sh, Docker) and did not skip
without it; a cloud container has no Docker daemon running. Not a product bug.
Fix: the check skips by name like the AV1 one (7 FAILs -> SKIPPED; mutant: line removed, FAILs return).
Setup (README §Prerequisites): start dockerd by hand, pip install meson==1.9.1, build.sh, ingest/tools.sh, .venv.
Full gate OK on main+fix (439 s) and on claude/oq-depth-cut 6f61ff0b (324 s). Skipped: nginx (apt has none here)
and the GL-display arms.
Found: the gate does not check ingest/.build for staleness. With a libdecode.so built from main, oq-depth-cut's
lossy_test.py failed 6 claims; after rebuilding it, every claim held.
Owner decision: should the gate refuse a stale ingest/.build, as it refuses a stale decoder WASM? (Not implemented.)
