state: done
started: 2026-11-23T03:47Z
heartbeat: 2026-11-23T04:16Z
outputs: claude/view-memory-bound 4cc8df2b3, 3fa0a8c86; PR 435 (draft into claude/unified)
## Resume
Done. Next: VIEW-MEMORY-BOUND-REVIEW by a session that wrote none of it (findings in PR 435's body).
## Result
* Controller's default budget is framesWithin(256 MiB, meta): the whole decoded frames of the series that fit, at
  one byte a sample at <= 8 bits or in colour, else two; farthest first, asked again on return; a passed budget overrides.
* Test: 8 frames of 4096^2 at 12 bits, 16 at 8 bits, 14 of 3000^2 at 12 bits; mutants killed: no default, always two
  bytes, 512 MiB, ceil. The floor of one frame survived and was removed (no real frame nears 256 MiB).
* Docs: what-a-view-asks-for.md *M, the budget* (built), design.md/html rule, client/README.md Frames, lines/client.md.
* Gate OK (521 s; PYTHON with ingest/requirements.txt); skipped: native painter and window (no lavapipe or Xvfb), the
  viewer's cross-codec arm and Firefox, the web host's check (no nginx). The decoder WASM rebuild failed on Docker Hub
  429; the gate used the committed build (untouched).
* Not measured: on V8 an evicted frame's SharedArrayBuffer is freed only at a collection (M2; PR 434), so the bound
  is on what the store keeps, not the tab's resident memory. deviceMemory named, not built; size per class is phase 2's;
  PHONE-ROUND-2's two values need a lab lever (not added). PR 428's "no frame leaves memory" is now stale.
* Fixtures: unit tests on synthetic frame sizes; nothing run on a device or in a browser for memory.
