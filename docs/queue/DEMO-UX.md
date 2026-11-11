state: started
started: 2026-11-11T14:41Z
heartbeat: 2026-11-11T14:50Z
outputs: claude/demo-ux (from claude/demo-fixes-1 daee0d1d)
## Resume
On claude/demo-ux (all pushed): merges (phone-protocol re-merged with PHONE-AMEND); item 1 1952131f; item 2
4222d27b; item 5 bc5d2f54; item 3 faf03c2f; item 4 slice slider 93293abb (client/viewer/slider.js + slider.test.mjs,
6 mutants killed; demo-check uses the slider for the ?fill=0 far jump and checks End moves it). Node tests only so far;
NOT yet run in a browser on a series.
Now running (long): the build (decoders, ingest/tools.sh, clients, series-server) and scripts/demo-series.sh into
demo-series/ (scratch build.sh: dockerd, meson 1.9.1, .venv, then the README steps). If the session dies: rerun those,
then README §Demo's "Before the demo" loop with --view page and --view worker (20 runs each), then scripts/gate.sh;
fix what fails; draft PR claude/demo-ux -> claude/demo-fixes-1.
## Result
(pending)
