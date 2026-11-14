state: done
started: 2026-11-14T23:17Z
heartbeat: 2026-11-14T23:23Z
outputs: claude/cache-plan b0d1acf1 (docs/client/evidence/cache-plan.md §7.4, 7.5, 7.6; docs/lines/client.md), on draft PR 385
## Resume
Done. Nothing owed by this row; CACHE-PROTOCOL is next once every CACHE-ADVOCATE row is done.
## Result
cache-plan.md §7.4 amended in place (theory; nothing built or timed), each change marked advocate with its source:
- Body: one reused ArrayBuffer per put in flight (fetch copies a BufferSource at construction), or a stream of the
  slot's own views where an engine takes a shared chunk (not traced; the pilot's first check); reads streamed into the slot.
- Fit: navigator.storage.estimate() at open and after eviction; Chromium refuses a put before writing it.
- Traced: Chromium has no entry-size limit, a path-less cache is in memory (~2 GiB a series); Gecko always Snappy-compresses
  and CRC32Cs every block both ways; put buffers the whole body by spec.
- Disadvantages left: two copies in script when buffered; no reservation (estimate is rough and blind to the disk);
  WebKit's SHA-1 and Gecko's Snappy + CRC32C on every frame; WebKit's no rollback; space lag after caches.delete;
  URL keys.
- Proposed for all four (same as OPFS-ASYNC's advocate's): a slot freed once a writer holds its copy.
Fixtures: none run. Sources fetched at pinned commits (sha256 in 7.6). No gate run: docs only.
