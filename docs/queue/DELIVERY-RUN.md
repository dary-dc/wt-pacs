state: started
started: 2026-11-22T22:17Z
heartbeat: 2026-11-22T22:37Z
outputs: claude/delivery (rows; docs/client/evidence/delivery-comparison.md §Results)
## Resume
Done: setup (iproute2, meson 1.9.1, dockerd, fetch_data, ingest/tools.sh, cargo release builds); series.sh /home/user/S;
K2 pushed (claude/delivery 44510d21, rows/K2.jsonl, 27 loads, every one VOID by the relay's guard: p99 4-14 ms under decode load;
idle, link_impair_check.sh's self-timing p99 is 0.23 ms; 3 other checks of that script fail: GE delivered 6551/8000, the
1200 kbit trace's survivors 13, two pairs at 4 Mbit 0.50 s). Running: lab/delivery/k3.sh /home/user/S lab/delivery/rows.
Next: inputs.mjs + predict.mjs -> push predictions.json; §11 amendment on the guard (judged both ways) before any counted row;
pilots; cells CLEAN, PUB, LTE, LOSS, CR (`node lab/delivery/run.mjs --cell C --series /home/user/S --predictions lab/delivery/predictions.json ...`).
## Result
