state: started
started: 2026-11-11T14:41Z
heartbeat: 2026-11-11T14:53Z
outputs: claude/demo-ux (from claude/demo-fixes-1 daee0d1d)
## Resume
On claude/demo-ux (all pushed, tip 8e572058): merges (phone-protocol re-merged with PHONE-AMEND); item 1 1952131f;
item 2 4222d27b; item 5 bc5d2f54; item 3 faf03c2f; item 4 slice slider 93293abb; line doc a105a33e. 93293abb and
a105a33e also carried a rebuild's in-flight changes to client/decode/wasm/built (deleted, then openjph re-added);
8e572058 restores that directory to 3cee3df6's bytes (no force-push). Stage files by name, never git add -A, while a
build runs.
Node tests only so far. Running: scripts/demo-series.sh demo-series (decoders, ingest tools, clients and
series-server already built in this container). Next: README §Demo's "Before the demo" loop under --view page and
--view worker (20 runs each, interleaved by series), then scripts/gate.sh, then a draft PR claude/demo-ux ->
claude/demo-fixes-1.
## Result
(pending)
