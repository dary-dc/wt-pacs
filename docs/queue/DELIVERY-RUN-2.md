state: started
started: 2026-11-25T08:27Z
heartbeat: 2026-11-25T08:30Z
by: 3ZzgE9v4
outputs: claude/delivery (rows; docs/client/evidence/delivery-comparison.md §Results 2)
## Resume
Setup (no rows yet): apt-get install -y iproute2; lab/delivery/series.sh /home/user/series (ingest/tools.sh, fetch, code the three volumes, prefixes, FIT's dbts_b1 series); client builds (README Quick start 1) and cargo build --release -p series-server -p pack-series. Next: K2 (run.mjs --bench, then FIT's level decode), K3 (k3.sh), K3' (run.mjs --k3-prime --cell LTE|LOSS), inputs.mjs, predict.mjs, push predictions.json; pilot per cell; counted cells CLEAN, PUB, LTE, LOSS, CR (12 rounds, 216 loads each), rows pushed to claude/delivery lab/delivery/rows/ as they land.
## Result
