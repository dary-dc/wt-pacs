# Decisions

One record per decision, corrected in place when a claim in it is wrong ([`disk-access.md`](disk-access.md) §2 is the model).

| ADR | decision | status |
| --- | --- | --- |
| [`stream-shape.md`](stream-shape.md) | one shared stream carries a session's frames | accepted, default since 2026-09-11 |
| [`frame-framing-and-loop-shape.md`](frame-framing-and-loop-shape.md) | the session loop: an ask-reader task feeding a planner, a server-driven fill, read-ahead from asks in hand | built: §6b–6d 2026-09-09, §6 closed by `stream-shape.md` |
| [`client-window-depth.md`](client-window-depth.md) | the client keeps the minimum ask depth that saturates the link | accepted; the browser client's window removed 2026-10-03 |
| [`stride-is-bandwidth-conservation.md`](stride-is-bandwidth-conservation.md) | skipping frames under a fast scroll conserves bandwidth, not fidelity | accepted |
| [`resolution-fitting-for-large-frames.md`](resolution-fitting-for-large-frames.md) | frames larger than the viewport are delivered at the resolution it shows | accepted, blocked on a dependency outside this repo |
| [`reject-server-cancel.md`](reject-server-cancel.md) | the server takes no cancel | accepted; §4–5 superseded by `reject-server-ordering.md` |
| [`reject-server-ordering.md`](reject-server-ordering.md) | the server serves asks in the order they arrive | accepted |
| [`disk-access.md`](disk-access.md) | how the server reads frame bytes: a page-cache hit inline, a miss to the ring or the pool, and its deployment | accepted |
| [`transport-idle-sessions.md`](transport-idle-sessions.md) | a keep-alive pair holds a session open while the user reads | proposed; built, off by default |
| [`transport-quic-stream-receive-window-defaults.md`](transport-quic-stream-receive-window-defaults.md) | quinn's default stream receive windows, not equalised across variants | accepted |
| [`telemetry-server-pipeline.md`](telemetry-server-pipeline.md) | server telemetry: the lab wraps the product's pipeline steps, in a feature-gated build | accepted |
| [`telemetry-instrument-clients-from-outside.md`](telemetry-instrument-clients-from-outside.md) | the browser clients are instrumented by patching `WebTransport` from outside, not by an inline recorder | accepted |
| [`exactness-in-production.md`](exactness-in-production.md) | every shown frame checked in the decoder worker against an XXH3-64 digest written at ingest, before paint; a mismatch decoded again, else blocked, and reported | proposed 2026-10-07; not built |
| [`frame-path.md`](frame-path.md) | a decoded frame goes from the decoder to the paint worker, which owns the frame store; a store worker keeps an OPFS cache of checked, decoded frames | proposed 2026-10-11; theory only |
| [`serving-by-uid.md`](serving-by-uid.md) | one server serves many series, each named in the session URL by its PCS-coded UIDs; one store per open series, a replacement seen by `stat` | proposed 2026-10-24; theory only; seven questions the owner's (§9) |
| [`display-metadata.md`](display-metadata.md) | a series' display metadata: a file per series the receiver derives from the study DB and nginx serves; the codec in the study index; no serving process opens a study DB | proposed 2026-10-25; theory only; open, conflicts with `viewer-metadata.md` and the owner's current view ([design state](../ingest/pacs-receive-design.md) §6) |
| [`viewer-metadata.md`](viewer-metadata.md) | what a viewer reads, by kind: list fields and the codec in the study index; display metadata, study fields and full metadata each derived by the receiver as a file on the page's origin; the session's first message the alternative, if measured faster under loss | proposed 2026-10-25; theory only; open, as the row above |
| [`study-index.md`](study-index.md) | the study index: list-time fields of every study and series in one MySQL database for all PACS hosts, derived from the study DBs by an outbox and a revision upsert, reached only through an API | proposed 2026-10-25; theory only; "MySQL fits" (owner, 10-25), placement to evaluate |
| [`metadata-updates.md`](metadata-updates.md) | metadata updates: one path through the receiver for every sender, differences by DECK key against a base hash, audited in the study DB, withdrawals hidden then purged | proposed 2026-10-25; theory only; the path open for the team and the product owner, the format in conflict with `pcs-transfer.md` |
| [`pcs-transfer.md`](pcs-transfer.md) | how the PCS's output reaches the PACS: one submission package per series, a resumable HTTPS upload ([`../ingest/link.md`](../ingest/link.md) §11), a polled storage commitment, updates as whole changed group files | proposed 2026-10-25; theory only; one package per series and XXH3 decided (10-25); questions the owner's and the PCS team's (§12) |
| [`pacs-disk-layout.md`](pacs-disk-layout.md) | where a study sits under the PACS's root: one hashed level of 256 folders from the study UID, no date in the path or the URL | proposed 2026-10-25; theory only; not decided: for the meeting with the team, the product owner and the DICOM-experienced members |
| [`../av1/adr-unit.md`](../av1/adr-unit.md) | AV1's group of frames as the client's unit: a `codec` in the metadata, one decoder module a codec, a group to one decoder | built for G = 1 and groups, with no wire, store or server change |
| [`pacs-receiver.md`](pacs-receiver.md) | the PACS receiver: one package checked against its name, staged in `incoming/`, read back from disk, placed by rename, recorded in one study-DB transaction, verified from disk, then "stored" or "refused" | proposed 2026-10-26; built behind no deployment, steps 9–10 open |
