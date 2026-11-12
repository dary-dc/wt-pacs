state: started
started: 2026-11-12T07:05Z
heartbeat: 2026-11-12T07:20Z
outputs: claude/clean-2 (not yet pushed)
## Resume
Claimed by the session started for DIRECTION-COORD (already done). Branch claude/clean-2 from claude/demo-fixes-2 18d2d1ff.
Scope (what CLEAN-PRODUCT, PR 371, did not do): S3 one starter for a pair (scripts/demo-pair.sh used by demo-check.mjs
and README §Demo); S6 ws-session/race-session bundles out of `ts/build.sh --product`; S7 lab levers out of the connect
options (spread lab opts before digests/decoder: DEFAULTS-FIND 4); DEFAULTS-FIND 2 (cine, two levers) and 3 (trace,
settle, after outside head.js's gate); CLEAN-FIND §4 duplicate viewer/store.js in web-files.sh, §7 lab pointers in
product comments. Each one commit, failing test first, mutated. Then gate, demo-series.sh, demo-check.mjs both views.
Setup (long, in background): dockerd; pip install meson==1.9.1; venv from ingest/requirements.txt; ingest/tools.sh;
client wasm+ts builds; cargo build --release -p series-server; gen_dev_cert.sh; scripts/demo-series.sh.
## Result
