state: started
started: 2026-11-11T16:28Z
heartbeat: 2026-11-11T17:22Z
outputs: claude/oq-integrity-build (from claude/source-fingerprint), draft PR pending
## Resume
As before; the cost run is in progress: 259 of 504 fills, rows pushed per series to lab/oq-integrity/rows/cost.jsonl. Restart: bash cost.sh logic (skips ids already in cost.jsonl). Summary: python3 summary.py cost.jsonl (median fill on/off per series and throttle). Then docs + PR.
## Result
