state: done
started: 2026-11-14T23:16Z
heartbeat: 2026-11-14T23:20Z
outputs: claude/cache-plan d95efdf0 (docs/client/evidence/cache-plan.md §7.1, §7.5, §7.6; docs/lines/client.md), on draft PR 385
## Resume
Done. Nothing owed by this row. CACHE-PROTOCOL waits on the other three advocates.
## Result
OPFS-SYNC's design (§7.1) amended in place, each change marked *advocate* with its source (theory; nothing run):
- Reads first: the write goes in pieces; the view worker raises a shared count with each read and the writer serves
  reads between pieces, so a miss waits at most one piece, not a 21–33 ms frame write. Pilot added: piece = whole
  frame or 2 MiB, rule stated (was "nothing to tune").
- truncate at open of a series not present (was at its first frame): fit answered before any fetch.
- Traced: no engine-side copy beyond the page cache in Chromium (pwrite in the renderer) and Gecko (NS_ASSIGNMENT_DEPEND);
  Chromium asks no capacity inside the truncated length; Gecko's quota IPC per 1 MiB block confirmed unavoidable; reads
  send none.
- Disadvantages left: one writer a series (exclusive lock); Gecko's 17–26 sync IPCs a frame; WebKit's main-thread waits
  once a series; no flush (re-check covers); quota held by a series opened and left.
- Named, not adopted: Chromium-only createSyncAccessHandle mode (BCD: off the standard track).
- Proposed for all four (7.5, the protocol author's call): a second tab reads what is present, writes nothing.
- Shared-input cost: a miss needs a free slot; the read cell should run with the ring full as well as idle.
Fixtures: none run; sources fetched 2026-11-14 at pinned commits (7.6). No gate run: docs only.
