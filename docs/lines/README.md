# Lines of work

A **line** is one direction of work on wt-pacs, each with one file here. A line file holds the line's goal, its
state now, what is open, the decisions taken and pointers into the repository; it is updated in place, and git keeps
its history.

**A session working on a line reads its file first and updates it before it ends**: state now, open, any new
decision, and the date at the top. Something learned for another line goes into that line's file.

| line | goal | file | last verified |
| --- | --- | --- | --- |
| coordination | merges, review order, branch and PR hygiene across the lines | [`coordination.md`](coordination.md) | 2026-11-09 |
| codecs and lab | HTJ2K and AV1, server, transport and disk, measured to `CLAUDE.md` §Measurement | [`codecs.md`](codecs.md) | 2026-11-12 |
| optimal quality | the chosen design built for the demo of 2026-11-13: an optimal-quality AV1 series, the exact HTJ2K frame on request | [`optimal-quality.md`](optimal-quality.md) | 2026-11-10 |
| client | the browser client: transport, decode, cache, paint, telemetry | [`client.md`](client.md) | 2026-11-12 |
| PACS receive and metadata | receive what the PCS sends, build and update each study's store, serve by UID | [`metadata.md`](metadata.md) | 2026-11-12 |
| 2D viewer | a 2D DICOM viewer product on the client, breast reading first (paused) | [`viewer.md`](viewer.md) | 2026-10-27; branches 2026-11-09 |
| native | a native client on raw QUIC, without the browser's limits | [`native.md`](native.md) | 2026-10-27; branches 2026-11-09 |

"Last verified" is the newest date the line's state was checked; "branches" means only the branch and PR state was
read again on that date, not the line's findings.

Every line shares one direction: most sessions at the lowest cost, low latency and fast fills, for mobile on lossy
wireless; the exact frame bit-exact; breast imaging first. The PCS (the separate service that receives, parses and
encodes studies) is upstream: our scope starts at the PACS, and the PCS's directory layout is our input contract.
