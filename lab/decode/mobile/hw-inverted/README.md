# hw-inverted: the 220-level form's cloud cells

The two byte cells of [`docs/decode/mobile/hw-inverted.md`](../../../../docs/decode/mobile/hw-inverted.md) §8, as
amended there: C1 (`inv220-420` against DEPTH8-MEASURE's rows, plus cut-only and A/A `cut8` cells) and C2 (picture A
at Q_A 24 and 40, picture B over it). `predictions.json` is `predict.py`'s, written before any cell ran.

Setup, all outside the repository (data, builds, y4m and work files are never committed):

```bash
git -C <repo> worktree add $H 0a9d33ca                         # H: claude/av1-noise-ratio, the harness
pip install meson && BUILD=$B $H/lab/av1/tools/tools.sh aom    # libaom 3.15.1, dav1d 1.5.4
OUT=$D $H/lab/av1/fetch_data.sh <the 19 DBT sets>              # checked against their pins
$H/lab/av1/.venv/bin/pip install --require-hashes -r $H/lab/av1/profiles/requirements.txt
git show origin/claude/depth8:lab/av1/depth8/rows/stage-a.jsonl > $R/stage-a.jsonl   # and stage-c.jsonl
```

Run, test, report (each run skips the rows already written; a cell in flight when stopped is coded again whole):

```bash
export LD_LIBRARY_PATH=$B/dav1d/lib PY=$H/lab/av1/.venv/bin/python
HARNESS=$H $PY -m unittest measure_test.py
$PY measure.py $H $B $W $D $R c1 --jobs 4     # rows/c1.jsonl; then c2 → rows/c2.jsonl
$PY report.py $R > rows/report.md
```

`rows/c1.cpu.txt` and `c2.cpu.txt` are `/proc/stat`'s first line once a minute during the runs; `rows/mutants.txt`
records n1–n5.
