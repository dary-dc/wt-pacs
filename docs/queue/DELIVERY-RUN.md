state: started
started: 2026-11-22T22:17Z
heartbeat: 2026-11-23T01:16Z
outputs: claude/delivery (rows; docs/client/evidence/delivery-comparison.md §Results)
## Resume
Done (claude/delivery): K2 44510d21; K3, inputs.json, predictions.json (xxh3 e7d61c6d15ea6bdb), §11 A1-A3 c9a44bd1; five pilots
and §11 A4 4431dd87; the container restarted 00:29Z inside CLEAN (89/150 loads kept as rows/CLEAN.partial-0029.jsonl, §11 A5, 71b7af0d).
CLEAN done 01:16Z (150 loads, 56a514cd). Running since 00:30Z, detached: the chain CLEAN PUB LTE LOSS CR (scratchpad chain.sh -> cell.sh: per cell
  node lab/delivery/run.mjs --cell C --series /home/user/S --predictions lab/delivery/predictions.json --pilot-medians lab/delivery/rows/C-pilot.pilot-medians.json
  rows pushed every 15 min). Expected: CLEAN ~45 min, PUB ~45, LTE ~50, LOSS ~55, CR ~126; done ~06:30Z.
If the container restarts again: setup (apt-get install -y iproute2; series.sh /home/user/S if /home/user/S is gone), move a
partial <C>.jsonl to <C>.partial-<HHMM>.jsonl, note it in §11 A5, restart from that cell.
Next: judge.mjs per cell + aa_rule.py --bar 0.05; §Results; design.md §Open line; docs/lines/client.md; PR 406 body.
## Result
