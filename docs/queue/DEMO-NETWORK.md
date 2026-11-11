state: started
started: 2026-11-11T19:49Z
heartbeat: 2026-11-11T20:32Z
outputs: claude/demo-network (from claude/demo-fixes-2 d46811c6)
## Resume
Pushed on claude/demo-network: 8e84bcda (test, failing), cc90ffea (scripts/demo-network.py + gate line; 8 mutants
killed), 445b29fd (docs/devices.md §8), 0eb91921 (README §Demo "On arrival"). Also pushed: lines/optimal-quality.md. Checked with real series-server x2 (smoke bundle) + dev-server --bind on the
container address: ok; one server stopped: FAIL by port. Next: the gate (GATE-CLOUD setup:
claude/gate-cloud README; or --quick/--no-browser and say so), draft PR into claude/demo-fixes-2.
Commands: git checkout claude/demo-network; python3 scripts/demo-network.test.py; scripts/gate.sh --quick
## Result
