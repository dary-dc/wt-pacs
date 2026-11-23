state: started
started: 2026-11-23T01:17Z
heartbeat: 2026-11-23T01:39Z
outputs: claude/memory-on-navigation a462542a8 (from origin/claude/unified)
## Resume
Reproduced in the cloud (headless Chromium 153, dbts_b1-q8-g16 + dbts_b1 via scripts/demo-pair.sh, probe
lab/viewer/navigation-memory.mjs, uncommitted until the counted run lands): ?view=page grows one renderer
~0.8-0.9 GiB a load (1.57 -> 4.09 GiB over 4 loads), with the bfcache on or off, pagehide.persisted false;
a forced GC (CDP HeapProfiler.collectGarbage) brings it back to one load; ?view=worker flat (+30-60 MiB a load);
page view with pixels "transfer" (scratch edit of lab/viewer/levers.js, reverted) flat. Minimal page (scratch):
SABs held by the main thread after navigation 863 -> 4115 MiB over 5 loads; transferred ArrayBuffers collected;
SABs held only in a worker freed. Cause: V8 counts a SharedArrayBuffer as 0 bytes toward collection
(transferred-buffer-per-frame.md), so the page thread's references keep them past the document. No fix inside
the row's bounds (transfer on the page view copies each paint; view=worker is VIEW-PAGE's call): findings.
Done: counted run (lab/viewer/rows/), evidence docs/client/evidence/navigation-memory.md, line doc, pushed a462542a8.
Next (was): counted interleaved run -> lab/viewer/rows/navigation-memory.jsonl; docs/client/evidence/navigation-memory.md;
line doc; push branch; draft PR into claude/unified.
Now: scripts/gate.sh --quick on the branch, then the draft PR into claude/unified.
## Result
