state: started
started: 2026-11-12T07:05Z
heartbeat: 2026-11-12T09:10Z
outputs: claude/clean-2 18f96938 (no PR yet)
## Resume
Claimed by the session started for DIRECTION-COORD (already done). Branch claude/clean-2 from claude/demo-fixes-2 18d2d1ff.
Scope (what CLEAN-PRODUCT, PR 371, did not do): S3 one starter for a pair (scripts/demo-pair.sh used by demo-check.mjs
and README §Demo); S6 ws-session/race-session bundles out of `ts/build.sh --product`; S7 lab levers out of the connect
options (spread lab opts before digests/decoder: DEFAULTS-FIND 4); DEFAULTS-FIND 2 (cine, two levers) and 3 (trace,
settle, after outside head.js's gate); CLEAN-FIND §4 duplicate viewer/store.js in web-files.sh, §7 lab pointers in
product comments. Each one commit, failing test first, mutated. Then gate, demo-series.sh, demo-check.mjs both views.
Setup (long, in background): dockerd; pip install meson==1.9.1; venv from ingest/requirements.txt; ingest/tools.sh;
client wasm+ts builds; cargo build --release -p series-server; gen_dev_cert.sh; scripts/demo-series.sh.
Pushed on claude/clean-2: 7b7ab20f S6 (product_test.sh); 215156f9 web-files dup; 5414aa1a trace/settle/after gated
(crafted.mjs + levers.test); 603da24d opts.digests never off; 8b8aa3a3 check's cine = ?check=cine; 0981aef0 S3
scripts/demo-pair.sh (+ demo-pair_test.sh, README §Demo's 3 blocks, demo-check.mjs through it); 911a4781 comment
pointers to docs (CLEAN-FIND §7); e4369cdc glossary "demo pair"; 18f96938 client.md line doc. S7 removals: none (every lever named by a check or rig).
Setup done (21 series in demo-series/). Running now: demo-check.mjs on 20 series x {page, worker}
interleaved (README §Demo's loop, + --view), full gate (INGEST_BUILD=$PWD/ingest/.build PYTHON=.venv/bin/python
scripts/gate.sh), draft PR into claude/demo-fixes-2, review row in docs/queue-2026-11-14.md.
## Result
