state: done
started: 2026-11-14T21:14Z
heartbeat: 2026-11-14T21:50Z
outputs: claude/cache-plan a3acc442 (docs/client/evidence/cache-plan.md §7; docs/lines/client.md), on draft PR 385
## Resume
Done. Nothing owed by this row; the four CACHE-ADVOCATE rows are next (each by a session that wrote no design).
## Result
cache-plan.md §7 (theory; nothing built or timed), one design per survivor before any build:
- Shared (7.0): a store worker per arm, the decoders posting ring slot numbers; a slot stays held until written.
- OPFS-SYNC: the packed file as built, written and read from the ring's slot (no copy in script); C's copy removed.
- OPFS-ASYNC: a file per frame by createWritable, one copy in the writer; a truncate-then-abort probe at open.
- IDB: a record per frame, relaxed, one transaction a frame; cannot say whether a series fits before writing it.
- CACHESTORAGE: a Cache per series, a response per frame; the same "does it fit" gap.
- Each with what it reuses, a predicted floor at S1-S3 (OPFS from measured rates; IDB, Cache Storage no anchor), pilot settings.
- 7.5: cache-in-opfs choice 7's eight failures per survivor.
- §3's untraced paths traced from source: WebKit's worker IndexedDB passes the page's main thread on every call, its
  Cache Storage only once; WebKit keeps a large ArrayBuffer in the SQLite row, a Blob in a file; Gecko keeps IndexedDB
  and Cache Storage in private windows (encrypted, temporary); WebKit SHA-1s every Cache Storage body at write and read;
  Chromium's body goes to the simple disk cache, Gecko's to a Snappy-compressed file.
Fixtures: none run; measured numbers quoted from a 4-vCPU container (Chromium 153, Firefox 159), warm page cache.
No gate run: docs only, no code touched.
