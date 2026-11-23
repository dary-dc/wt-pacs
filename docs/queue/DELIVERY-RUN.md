state: started
started: 2026-11-22T22:17Z
heartbeat: 2026-11-23T00:03Z
outputs: claude/delivery (rows; docs/client/evidence/delivery-comparison.md §Results)
## Resume
Done (claude/delivery): K2 44510d21; K3, inputs.json, predictions.json (xxh3 e7d61c6d15ea6bdb), §11 A1-A3 c9a44bd1; five pilots
and §11 A4 4431dd87 (VOID 4, 2, 3, 0, 0 of 30, all the guard; no failure). Series in /home/user/S (lab/delivery/series.sh /home/user/S).
Running: CLEAN counted, 150 loads (~65 min), rows pushed every 15 min by a wrapper:
  node lab/delivery/run.mjs --cell CLEAN --series /home/user/S --predictions lab/delivery/predictions.json --pilot-medians lab/delivery/rows/CLEAN-pilot.pilot-medians.json
Next: PUB, LTE, LOSS, CR the same (one job each); then judge.mjs per cell + aa_rule.py --bar 0.05; §Results in
docs/client/evidence/delivery-comparison.md; docs/lines/client.md; PR 406 body. A resumed run: a cell partly pushed restarts whole as
<CELL>-2 is not in the driver; judge what is pushed and note the cut.
## Result
