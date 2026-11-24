state: started
started: 2026-11-24T19:27Z
heartbeat: 2026-11-24T19:37Z
by: Zz3Kihvk
outputs: claude/engines (rows); claude/page-runs (page-runs.md §Engines)
## Resume
Done: Firefox 159.0.1 and 160.0.1 fetched from archive.mozilla.org, SHA256SUMS checked, in /tmp/claude-0/ff/<ver>/firefox/firefox
(refetch the same way in a new container). 3a's trace built and pushed: claude/engines 7048b6534
(client/contract/webcodecs-trace.js, clause aGroupTracedThroughWebCodecs in dispatch-rig.ts, run only when named);
mutant drop=instance fails its completeness check (docs/decode/engine-cells/3a/mutant-drop-instance-ff160.log).
Next: the six counted runs, 159,160,160,159,159,160, each
`(cd client/transport/ts && ./build.sh) ; FIREFOX_PATH=<ver> client/contract/run_firefox.sh dispatch aGroupTracedThroughWebCodecs > docs/decode/engine-cells/3a/run<N>-ff<ver>.log`
(needs bash client/decode/wasm/fetch_openjph.sh and fetch_xxh3.sh first). Then 3b on claude/frame-memory-m5-run@1a90eb9 + core-m5b lab/opfs-cache.
## Result
