state: done
started: 2026-11-14T23:15Z
heartbeat: 2026-11-14T23:22Z
outputs: claude/cache-plan 3c75f5ed (docs/client/evidence/cache-plan.md §7.2, 7.5, 7.6; docs/lines/client.md), on draft PR 385
## Resume
Done. Nothing owed by this row. CACHE-PROTOCOL waits on the other advocates (IDB, CACHESTORAGE).
## Result
§7.2 amended in place, each change marked advocate with its source (theory; nothing built or timed):
- A file per group of frames up to 8 MiB (15 at S1, 1 at S2/S3): a two-point fit to B's measured Firefox rates gives
  ~17 ms a file + ~460 MB/s, so a file a frame predicts ~29 MB/s at S1 against the fill's 125; groups ~230 (theory).
- A buffer per write in flight, reused only after its write() resolves: fs copies the chunk in a queued task (fs 1213,
  1239), so the design's one reused buffer with 3 in flight would have mixed frames.
- Traced in Chromium: a writable's truncate is refused before close (AllocateQuota → FILE_ERROR_NO_SPACE), an aborted
  or disconnected writer removes its swap; only a browser crash leaves <name>.crswap, and 100 of them block the name.
- Pilot rules fixed per setting (G at S1 by write, writes in flight at S2 by write, the read at S2 by the miss p50).
- Eight disadvantages left (two renderer copies, k frames outside the ring, WebKit's main-thread hops and double write,
  Safari 26+ only, no reservation, a group lost whole by a kill, a buffer per miss, stale swaps holding quota).
- Proposed for all four, not applied: free a slot once the store holds its own copy; a shared Web Lock per open
  series so a second tab may write too (extends 7.1's reader proposal).
Fixtures: none run; numbers quoted from cache-io-thread (4-vCPU container, Chromium 153, Firefox 159, warm page cache).
Still not traced: Gecko's and WebKit's truncate refusal and crash leftovers. No gate: docs only.
