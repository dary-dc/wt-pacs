state: started
started: 2026-11-14T23:15Z
heartbeat: 2026-11-15T01:07Z
outputs: claude/depth8 (rows lab/av1/depth8/rows/, results in docs/av1/depth-cut-8.md §9; PR 389)
## Resume
Done: amendment A1–A6 in docs/av1/depth-cut-8.md §7 before any run (bc012920); lab/av1/depth8/measure.py and its
tests (9aaa5323, 2388b188; mutants m1–m4 killed). Harness: claude/av1-noise-ratio at 0a9d33ca.
Stage a done (78 cells): 78 cells pushed at 00:51Z.
Stage b done (18 cells): 18 cells pushed at 00:51Z.
Rows land in lab/av1/depth8/rows/stage-a.jsonl (+ stage-a.cpu.txt, /proc/stat a minute). measure.py skips every row
already in the file, so a resume re-runs only what is missing.
Setup on a fresh host (commands):
  git worktree add --detach H origin/claude/av1-noise-ratio   # 0a9d33ca
  python3.11 -m venv H/lab/av1/.venv && H/lab/av1/.venv/bin/pip install --require-hashes -r H/lab/av1/profiles/requirements.txt
  pip install meson; BUILD=B bash H/lab/av1/tools/tools.sh aom dav1d
  OUT=DATA VENV=H/lab/av1/.venv bash H/lab/av1/fetch_data.sh dbts_a1 dbts_b1 dbts_c1 dbt12_ea1141 dbts_b2 dbts_c4
  LD_LIBRARY_PATH=B/dav1d/lib H/lab/av1/.venv/bin/python lab/av1/depth8/measure.py H B WORK DATA \
    lab/av1/depth8/rows/stage-a.jsonl --stage a --jobs 4        # then --stage b into stage-b.jsonl
Results of A and B in docs/av1/depth-cut-8.md §9 (5b4ac407), per cell in lab/av1/depth8/rows/report.md.
Stage c running: 17 cells pushed at 01:07Z.
Stage C's rows: lab/av1/depth8/rows/stage-c.jsonl (same command, --stage c; fetch the 13 volumes of measure.py's
STAGE_C first). Next: report Stage C in §9 (report.py takes stage-c.jsonl in place of
stage-a for P1–P3; it has no cut-only or 4:2:0 rows), state done, PR 389's body.
## Result
