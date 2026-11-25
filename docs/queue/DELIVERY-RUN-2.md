state: started
started: 2026-11-25T08:27Z
heartbeat: 2026-11-25T10:44Z
by: 3ZzgE9v4
outputs: claude/delivery (rows; docs/client/evidence/delivery-comparison.md §Results 2)
## Resume
Counted cells running since 10:45Z (first counted row after predictions d126fac79a8b2145 and R4, claude/delivery 02fa1c379): scratch cells.sh CLEAN PUB LTE LOSS CR runs node lab/delivery/run.mjs --cell <CELL> --series /home/user/series --predictions lab/delivery/predictions.json --pilot-medians lab/delivery/rows/run2/<CELL>-pilot.pilot-medians.json --out lab/delivery/rows/run2/<CELL>.jsonl and pushes rows every 15 min. A cell cut by a restart: keep its rows as rows/run2/<CELL>.partial-<hhmm>.jsonl (in no bar) and rerun that cell whole (as §11 A5). Paces from the pilot: CLEAN/PUB/LTE/LOSS ~60-70 min, CR ~175 min. Then: judge each cell (node lab/delivery/judge.mjs lab/delivery/predictions.json rows/run2/<CELL>.jsonl > rows/run2/judged/<CELL>.txt; python3 lab/scripts/aa_rule.py rows/run2/<CELL>.aa.json --bar 0.05), §Results 2 in delivery-comparison.md, line doc docs/lines/client.md.
## Result
