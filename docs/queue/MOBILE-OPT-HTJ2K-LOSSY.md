state: started
started: 2026-11-15 14:28 UTC
heartbeat: 2026-11-15 14:36 UTC
outputs: claude/mobile-decode (docs/decode/mobile/htj2k-lossy.md), PR 397 (draft, existing)
## Resume
Done: pre-registration pushed (claude/mobile-decode f6f0416d, docs/decode/mobile/htj2k-lossy.md §4). Brief and
amendments re-read at this push: unchanged.
Next: lab/av1/htj2k-lossy/measure.py (Cell B) on the 19 volumes; rows pushed as they land to
lab/av1/htj2k-lossy/rows/cell-b.jsonl. Setup: BUILD=<dir> ingest/tools.sh (needs meson from pip);
OUT=<dir> lab/av1/fetch_data.sh <the 19 sets>; harness = worktree of 0a9d33ca; venv from lab/av1/profiles/requirements.txt.
## Result
