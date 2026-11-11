state: started
started: 2026-11-11T16:28Z
heartbeat: 2026-11-11T17:10Z
outputs: claude/oq-integrity-build (from claude/source-fingerprint), draft PR pending
## Resume
Built, tested, mutated, gate OK (838 s, skipped lavapipe/Xvfb/Firefox/nginx). Rows on the branch:
lab/oq-integrity/rows/correct.jsonl (18 series x 2 routes, every frame as coded), mutants.jsonl (all caught).
Running now: the cost run, node lab/oq-integrity/run.mjs $SCRATCH/demo-int lab/oq-integrity/rows/cost.jsonl
--rounds 7 --throttles 1,4 (504 fills, ~1-2 h), rows appended as they land. If it died: rerun for the ids missing in
cost.jsonl with --ids (demo-int must be rebuilt: INTEGRITY=1 VENV=$PWD/.venv scripts/demo-series.sh DIR, ~20 min).
Then: summary (median fill on/off per series and throttle) into docs/av1/payload-format.md §Integrity, apply the
protocol's rule, draft PR into claude/demo-fixes-2 marked a proposal. Finding to report: noiseBandRatio 1.25-2.35
on every demo series (σ over all samples, the study took in-window samples) - I2's own protocol would catch it.
## Result
