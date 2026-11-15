state: started
started: 2026-11-15 17:17 UTC
heartbeat: 2026-11-15 17:55 UTC
outputs: claude/phone-round (from origin/claude/hw-probe af4b6aeb), draft PR into claude/hw-probe (not yet)

## Resume

Done: steps 1–6 on claude/phone-round (27336c4b..), README (c1c3e6a0), the order (63908f5d), line doc. Next: gate --quick (running), then the draft PR into claude/hw-probe, then done.

Plan (worktree: `git worktree add W origin/claude/phone-round`; build: venv + ingest/requirements.txt, meson 1.9.1,
`cargo build --release -p series-server -p pack-series`, `ingest/tools.sh`, `client/transport/ts/build.sh`):
1. Port 11-11's beacon into the kit (`lab/devices/beacon.js` + test, `server/dev-server.py --beacon`), citing
   claude/phone-rows 1354e67f.
2. `lab/devices/round.mjs` (pure, node-tested): the plan's grammar, the timer-gap rule (> 2 s outside a load's own
   work: VOID: stopped), the load's verdict (a failure recorded, the next taken).
3. `lab/devices/round.py`, the laptop's script: start page with one Start, `GET /next?after=k` (adb reads between
   loads, servers per block, the gap, 302 to the next load once its servers answer), run-commit check before load 1,
   stay-on 7 before and restored after, `adb start-server` once, `adb reboot` after a block marked so; `round_test.py`
   with a fake `adb` on PATH.
4. The viewer's hook `?round=` (`lab/devices/round-page.js` through `lab/viewer/levers.js`): wake lock acquire,
   release, refusal; the ticker; the fill check; navigate to the host's next.
5. `round.test.mjs`: headless, real viewer and servers, >= 6 loads, the brief's checks each mutated once.
6. Cell actions: steps (dispatched), busy lever on/off on the viewer's thread, cine due/painted, exact presses,
   getStats at fill end, §10 item 4 fields; then README, PR body (what of lab/phone/ it supersedes), gate, draft PR.

## Result
