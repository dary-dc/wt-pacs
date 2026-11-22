state: started
started: 2026-11-22T22:17Z
heartbeat: 2026-11-22T23:17Z
outputs: claude/delivery (rows; docs/client/evidence/delivery-comparison.md §Results)
## Resume
Done (claude/delivery): K2 44510d21; K3 + inputs.json + predictions.json (xxh3 e7d61c6d15ea6bdb) + §11 A1-A3 c9a44bd1.
Series in /home/user/S (lab/delivery/series.sh /home/user/S; ~2 min). Setup as above (iproute2, meson, dockerd, ingest/tools.sh, cargo --release).
Done: CLEAN, PUB pilots (0f138aad; 4/30, 2/30 VOID, all the guard; no guard amendment needed). Running: pilots LTE LOSS CR (same command).
Next: pilots LTE LOSS CR; push rows/*-pilot.jsonl; judge each pilot (writes *.pilot-medians.json); §11 A4 (the guard: VOID on every
decode-load row here -> report as written and guard-waived) before CLEAN's first counted row; then counted cells CLEAN, PUB, LTE, LOSS, CR,
one background job each (`--pilot-medians lab/delivery/rows/C-pilot.pilot-medians.json`), rows pushed every 15 min.
## Result
