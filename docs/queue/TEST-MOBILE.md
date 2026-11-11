state: started
started: 2026-11-11 01:34
heartbeat: 2026-11-11 01:45
outputs: claude/demo-tests-mobile (from claude/demo-fixes-0 618e13c8)
## Resume
On claude/demo-tests-mobile (from claude/demo-fixes-0 618e13c8): 4397519b controller tests (label through a failed ask
and its retry, unchecked, `l` before connect, one ask per frame, window change; 10 mutants killed); 37f13e82 av1 route
tests (≤ 10 bits not sticky, > 10 sticky, in-group stays on WebCodecs; 2 of 3 mutants killed, the third equivalent);
f33c272f demo-check.mjs: the wrong digest's `l` retry asserted in order, and `--link "OPTIONS"` through
lab/scripts/link_impair.py (this kernel has no sch_netem: `tc qdisc add … netem` → "Specified qdisc kind is unknown").
Built (all rc 0) and the four series written (86 s); the baseline passed with the retry claim, and its mutant
(no retry after failed) failed it. Running now: the six interleaved runs. Then: write docs/reviews/demo-tests-mobile.md
with every run and mutant, push, finish. Was: once built (cargo series-server pack-series, ingest/tools.sh, client/transport/wasm/build.sh + ts/build.sh,
lab/av1/fetch_data.sh dbts_a1 dbts_b1, gen_dev_cert.sh), ingest dbts_a1, dbts_a1-q8-g8-cut, dbts_b1, dbts_b1-q8-g8
as scripts/demo-series.sh does into demo-series/, then run demo-check.mjs with no link, then --link at
"--delay-ms 40 --jitter-ms 10 --loss 2" and "--delay-ms 80 --jitter-ms 20 --loss 5", interleaved per series.
## Result
