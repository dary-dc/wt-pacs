state: started
started: 2026-11-24T23:26Z
heartbeat: 2026-11-24T23:36Z
by: LmKctNiQ
outputs: claude/us-end-to-end (PR 445)
## Resume
Pushed on claude/us-end-to-end: e1f6b817e (m1: `same` reads the served .sbnd's own metadata), 653ebb6d2 (B1:
gate.yml caches lab/av1/data's three sets, fetches on a miss, ffmpeg in apt; m2: FIXTURES.md limit). Fetched, built; the step passes (usb_cine 64, usb_cine_rgb 64, dbts_a1 56, page and worker) and the swap mutant
fails at `same`. Running `PYTHON=lab/av1/.venv/bin/python scripts/gate.sh`. Was: wait for
`OUT=lab/av1/data lab/av1/fetch_data.sh usb_cine usb_cine_rgb dbts_a1` and `ingest/tools.sh`, then
`PYTHON=python3 scripts/stacks_end_to_end.sh`, the swap mutant (usb_cine's bundle as usb_cine_rgb's) must fail, then
`scripts/gate.sh`; findings.md §Fix; PR 445 body.
## Result
