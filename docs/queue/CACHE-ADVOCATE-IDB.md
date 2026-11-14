state: done
started: 2026-11-14T23:16Z
heartbeat: 2026-11-14T23:22Z
outputs: claude/cache-plan 3c75f5ed (docs/client/evidence/cache-plan.md §7.3, §7.5, §7.6; docs/lines/client.md), on draft PR 385
## Resume
Done. Nothing owed by this row. CACHE-PROTOCOL waits for the other advocates (OPFS-ASYNC running, CACHESTORAGE).
## Result
cache-plan.md §7.3 amended in place, each change marked *advocate* with its source (theory; nothing built or run):
- Value a Blob on every engine: Chromium Snappy-compresses a large value at put (default-on feature) and Gecko a clone
  over 1 MiB, neither a Blob; WebKit keeps an ArrayBuffer in its SQLite row. ArrayBuffer stays a pilot option on Gecko.
- One reused scratch buffer (the Blob copies it); commit() after put.
- One write transaction in flight, reads served first; the batch of 3 dropped (a read-only transaction waits for every
  earlier overlapping read/write one, IndexedDB 1130-1133).
- estimate() at open answers "does it fit" before the fetch (a check, not a reservation).
- Traced: Chromium's backend (LevelDB on disk by default, SQLite in a private window, so IDB works there in memory);
  its deleted files removed by a journal up to 5 s later, so the eviction retry waits for the room.
- Left: two copies a write and one a read in script, WebKit's main thread on every call, a miss waits one frame's write,
  no reservation, a commit IPC a frame, Gecko private-window encryption.
- Proposed for all four: a miss on a frame not yet written served from its held slot; the eviction retry waits for room.
Fixtures: none run; sources fetched 2026-11-14 at the pinned commits in §7.6. No gate: docs only.
