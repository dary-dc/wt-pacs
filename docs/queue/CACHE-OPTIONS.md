state: done
started: 2026-11-14T17:15Z
heartbeat: 2026-11-14T17:23Z
outputs: claude/docs-client cc64c984 (docs/client/evidence/cache-options.md), 4c84013e (docs/lines/client.md §Open 7); no PR of its own (DOCS-STRUCTURE opens the branch's PR)
## Resume
Done. Nothing owed by this row; DOCS-FOLD links the file from design.md §Open.
## Result
Theory only, sources verbatim at pinned commits (IndexedDB, ServiceWorker, Fetch, HTML, Web IDL, fs, Storage, Storage Buckets,
File System Access, Web Locks, browser-compat-data; Chromium, Gecko, WebKit sources); nothing measured.
* IndexedDB and Cache Storage refuse a SharedArrayBuffer (HTML forStorage DataCloneError; BufferSource TypeError): a copy in script,
  then the engine's (Chromium Snappy + blob > 64 KiB; Gecko file > 1 MiB). Both share OPFS's bucket, quota and eviction.
* Their atomicity is redundant beside the XXH3 re-check on read. Storage Buckets: Chromium 122 only; the store already evicts by series.
* User-picked directory: Window only, activation, Chromium only: a desktop workstation case.
* Phone (dbts_b1-q8-g8, 2560x3328): decoded 852 MB/series vs coded 23 MB; decoded wins reopen only if a cold read + XXH3 of 17 MB
  is under ~45 ms (135 ms decode / 3 decoders), >= ~0.4 GB/s; writing at the decode rate asks ~358 MB/s of flash. Both unmeasured.
Leaning: OPFS as built (sync handle, dedicated worker, decoded, packed per series); decoded vs coded holds until the phone read is measured.
Fixtures: one phone (Chrome 157), one series, one evening; a 4-vCPU container, no GPU, warm page cache; WebKit by source only.
Owner: if a phone reads slower than ~0.4 GB/s, the no-re-decoding rule and reopen time pull apart (§3, §5 of the file).
