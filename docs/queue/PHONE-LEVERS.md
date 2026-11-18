state: started
started: 2026-11-18T00:17Z
heartbeat: 2026-11-18T00:30Z
outputs: claude/phone-round def86ef4 (PR 400)
## Resume
Pushed def86ef4 on claude/phone-round: lab/devices/bench.js (bench, exactFill), round-page.js wiring, levers.js
?decoders and refusals, head.js gate list, round.py PAGE_KEYS, roundOrder (cell 1 ×3 Williams, drift at the end,
C2 exactFill), beacon frameRow decodedAt; tests: levers.test.mjs, round.test.mjs, round_headless.sh (16 loads, all
claims hold). Note: the synthetic view carries no reconstruction digests here, so its frames are `unchecked` (as
the product's); the bench fails only on exact false.
Next: mutate each new check (scratch copies, revert after), README §The round, docs/lines/client.md, gate --quick,
PR 400 body section. Commands: PYTHON=.venv/bin/python bash lab/devices/round_headless.sh; node lab/viewer/levers.test.mjs;
node lab/devices/round.test.mjs.
## Result
