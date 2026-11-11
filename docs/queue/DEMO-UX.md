state: started
started: 2026-11-11T14:41Z
heartbeat: 2026-11-11T15:05Z
outputs: claude/demo-ux (from claude/demo-fixes-1 daee0d1d)
## Resume
On claude/demo-ux (all pushed, tip 8e572058): every item built (1 1952131f, 2 4222d27b, 3 faf03c2f, 4 93293abb,
5 bc5d2f54), merges done (phone-protocol re-merged with PHONE-AMEND). 8e572058 restores client/decode/wasm/built,
which 93293abb/a105a33e had disturbed while a rebuild ran.
Built here: decoders (match manifest), ingest tools, clients, series-server; demo-series/ 18 series, bytes equal to
README's table. Browser: demo-check passed on a1-q8-g8-cut and a1-q8-g16-cut --refuse-webcodecs; browser mutants
killed: lever unplugged in viewer.js, slider follow removed, label text reverted.
Running: README loop, 20 runs x {page, worker} interleaved by series (scratch loop.sh, ~30 min). Next: scripts/gate.sh,
then a draft PR claude/demo-ux -> claude/demo-fixes-1, then the Result.
## Result
(pending)
