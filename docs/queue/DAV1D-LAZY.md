state: started
started: 2026-11-11T14:44Z
heartbeat: 2026-11-11T14:45Z
outputs: claude/dav1d-lazy (from origin/claude/proposals 2026-11-11), no commit yet
## Resume
Branch claude/dav1d-lazy pushed (= claude/proposals). Read: demo tip claude/demo-fixes-1 daee0d1d head.js (preloads dav1d
glue+wasm on every AV1 page), decode/av1.js init (each of 3 workers fetches glue+wasm and imports av1-dav1d.js at start),
wasm-glue.js, decoder.js, av1-webcodecs.js probe; lab/page-open/README.md §Cold round trips by codec (COLDRTT: +67 ms cold
at 0 ms on the WebCodecs path from dav1d's 238 KB gzip arriving with the first frame; "Not built: a depth hint").
Sizes: dav1d.wasm 623 146 B (238 KB gzip, nginx template gzips; dev-server.py does not), dav1d.js glue 10 779 B.
Next: write docs/lines/proposals.md §P6 (mechanism, sources, bands, protocol), add to the table and §Sources, push;
then state done here.
## Result
