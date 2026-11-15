state: started
started: 2026-11-14T23:15Z
heartbeat: 2026-11-15T00:51Z
outputs: claude/depth8 (rows lab/av1/depth8/rows/, results in docs/av1/depth-cut-8.md §9; PR 389)
## Resume
Done: amendment A1–A6 in docs/av1/depth-cut-8.md §7 before any run (bc012920); lab/av1/depth8/measure.py and its
tests (9aaa5323, 2388b188; mutants m1–m4 killed). Harness: claude/av1-noise-ratio at 0a9d33ca.
Stage a running: 78 cells pushed at 00:51Z.
Stage b running: 18 cells pushed at 00:51Z.
Rows land in lab/av1/depth8/rows/stage-a.jsonl (+ stage-a.cpu.txt, /proc/stat a minute). measure.py skips every row
already in the file, so a resume re-runs only what is missing.
Setup on a fresh host (commands):
  git worktree add --detach H origin/claude/av1-noise-ratio   # 0a9d33ca
  python3.11 -m venv H/lab/av1/.venv && H/lab/av1/.venv/bin/pip install --require-hashes -r H/lab/av1/profiles/requirements.txt
  pip install meson; BUILD=B bash H/lab/av1/tools/tools.sh aom dav1d
  OUT=DATA VENV=H/lab/av1/.venv bash H/lab/av1/fetch_data.sh dbts_a1 dbts_b1 dbts_c1 dbt12_ea1141 dbts_b2 dbts_c4
  LD_LIBRARY_PATH=B/dav1d/lib H/lab/av1/.venv/bin/python lab/av1/depth8/measure.py H B WORK DATA \
    lab/av1/depth8/rows/stage-a.jsonl --stage a --jobs 4        # then --stage b into stage-b.jsonl
Next: Stage B (G 16), then the report (P1–P6 per cell against predictions.json) in depth-cut-8.md §9; Stage C if time.
## Result
