state: done (findings, no fix; PR 434)
started: 2026-11-23T01:17Z
heartbeat: 2026-11-23T01:53Z
outputs: claude/memory-on-navigation a462542a8, draft PR 434 into claude/unified
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
Done: gate --quick OK (585 s; decoder rebuild blocked by Docker Hub 429, skips named in PR 434); PR 434 opened.
## Result
* Cause (measured): the page view holds decoded frames as SharedArrayBuffers on the page's thread; V8 counts them
  as 0 bytes toward collection, so after a navigation they stay resident until an unrelated collection.
* dbts_b1-q8-g16 + dbts_b1, headless Chromium 153, 4-core/15 GiB container, 2 interleaved rounds: page view
  1.6 -> 4.1 GiB over four loads (then a collection), worker view flat 1.53-1.74, page view with transferred buffers
  (refusal lifted in the working tree only) flat 1.55-1.57; a forced GC returns the page view to one load.
* Not the back/forward cache: same growth on or off, every pagehide persisted false. Playwright disables the
  cache by default (--disable-back-forward-cache); the rig drops it.
* Minimal page: shared buffers held by the page 863 -> 4116 MiB over 5 loads; transferred collected; worker-held freed.
* No fix in the row's bounds: transfer on the page view copies each paint and is an unrun experiment's to adopt;
  view=worker is VIEW-PAGE's; dropping references at pagehide frees nothing.
* For VIEW-MEMORY-BOUND: a FrameStore budget alone does not bound the page view's memory while frames are shared.
* Evidence docs/client/evidence/navigation-memory.md; rigs lab/viewer/navigation-memory{,-minimal}.mjs; rows lab/viewer/rows/.
* Owner decision: none asked here; the release options go to VIEW-PAGE (view worker by default) and to
  transferred-buffer-per-frame.md's cells T and W.
