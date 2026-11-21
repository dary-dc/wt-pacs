state: started
started: 2026-11-21T15:47Z
heartbeat: 2026-11-21T15:58Z
outputs: claude/noise-ingest (rows; the crate under lab/noise-ingest), PR 413
## Resume
Done (claude/noise-ingest f755599d): crate, golden test (mutants 1–3 killed; 4 survives: equivalent on integer
gradients as far as searched), run.py, report.py; M1 equals the rows on 175/175 frames in a first pass.
Next: ingest/tools.sh (needs `pip install meson`), `cargo build --release -p from-parser -p noise-ingest`, then
`lab/av1/.venv/bin/python lab/noise-ingest/run.py lab/av1/data WORK lab/noise-ingest/rows` (rounds 0–4; pass round
numbers to resume), pushing lab/noise-ingest/rows after each round; then report.py rows → noise-point.md §Measured.
## Result
