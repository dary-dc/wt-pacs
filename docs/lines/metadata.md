# PACS receive and metadata

Last verified 2026-11-20 (PR state and branches; the study-DB schema 2026-11-19, reviewed 2026-11-20; the design state as of 2026-10-29). The design state, its open
conflicts and the owner's decisions on it: [`../ingest/README.md`](../ingest/README.md) §4a; the ingest's decisions
table: §4 there.

## Goal

The PACS side of wt-pacs: receive what the PCS produces, check it, build and **update** each study's store, and serve
every series by UID. The PCS receives, parses and encodes (HTJ2K `mf.mxf`, AV1 `mf.mp4`, `sf.jxl`); its directory
layout is our input contract. Depth over breadth; theory and a pre-registered measurement first.

## In flight

No row runs on this line (2026-11-20).

* **Built, draft**: the sender at the PCS, the receiver, `pacs-verify` and `common/from-disk`, serve-by-UID, the
  carrier; metadata, SQLite and study-index labs; ADRs. No resend-identity logic anywhere, on purpose. Its branch,
  `claude/line-pacs`, and `pacs-design-state`, `pacs-disk-layout-measure`, `pcs-pacs-options`, `rsync-options`,
  `rsync-updates` are all in `claude/unified` (checked 2026-11-20).
* **The rsync delivery, proposed** (2026-10-28): [`../ingest/pcs-pacs-options.md`](../ingest/pcs-pacs-options.md),
  eight parts, four profiles; the structure awaits review. Open in it: the hash bridge, P3 against E, the layout, the
  kept mirror ([`../ingest/README.md`](../ingest/README.md) §4a).
* **The study DB's schema**: one schema, `xxh3 TEXT`, with a test that `pacs-verify` reads what the receiver writes
  (STUDY-DB-TEST, 2026-11-19, draft PR 407); its review is due. SYNC-RECONCILE and RECEIVER-RANGE follow; all three
  end in the `pacs-sync` decision page (`claude/work-ledger:docs/queue-2026-11-14.md`).
* **The optimal-quality pair at ingest**: built behind a flag (OQ-INGEST, 2026-11-14,
  [`../ingest/README.md`](../ingest/README.md) §7); its design's three questions below.

## PRs

| PR | what | state |
| --- | --- | --- |
| #258 | the line, `claude/line-pacs` | closed 2026-11-18, not merged; its branch in `claude/unified` |
| #168, #167, #230, #233, #234 | design state; disk layout measured; PCS → PACS options; rsync delivery; rsync updates | closed 2026-11-18, not merged; branches in `claude/unified` |
| #220–#223 | the synchronization protocol: a second writer, prior art, shapes, B against E measured | closed 2026-11-18, not merged |
| #153 | the viewer-metadata ADR | closed 2026-11-18, not merged |
| #407 | the study DB's one schema | draft; review owed; merging it is the yes to `TEXT` |

## Owed runs

* None pre-registered. The synchronization protocol's A + F against E + F is decided by theory and #223's B-against-E
  measurement (E the pre-registered verdict); neither compared the kept mirror.

## Open, in order

1. Evaluate under rsync, in order: cleared `incoming/` or kept mirror (turns on the PCS team's answers); the hash
   bridge; for a cleared `incoming/`, P3 vs E; layout A or B and who builds the `.sbnd`.
2. The synchronization protocol: A + F or E + F; the second writer is the fork (#220's questions for the product
   owner); then implement in sender and receiver.
3. Owner decisions waiting: hash column type (one schema, `xxh3 TEXT`, built on `claude/study-db-schema` (draft PR
   407) with a test that `pacs-verify` reads what the receiver writes; `INTEGER` the alternative; 2026-11-19; reviewed 2026-11-20, no blocker, findings in PR 407's body), reply
   file and words, carrier, study-DB layout, viewer metadata, DB engine, study index (engine and placement: open), serving defaults, verdict travel.
4. Questions for the PCS team: is each exam's tree kept as the record while updates can come; does it show the current
   state; can it sync a quiet or snapshotted tree; frame-file hashes; layout details.
5. A signed 8-bit source off centre once wrapped in Int8 past the ingest gate and the client digest; fixed on
   `claude/av1-unified-mainbase` (`docs/av1/payload-format.md` P4), not yet on `claude/core`. Whether the receive
   path needs its own check is open. *Corrected 2026-11-20:* the fix is in `claude/unified`, through
   `claude/av1-unified-mainbase`.
6. One or two commits each on `pacs-design-state` (#168), `pacs-disk-layout-measure` (#167), `pcs-pacs-options`
   (#230), `rsync-options`, `rsync-updates` are not yet in `line-pacs`. *Corrected 2026-11-20:* all five are in
   `claude/unified`, with `line-pacs`.
7. The optimal-quality pair at ingest (INGEST-OQ, 2026-11-12, [`../reviews/ingest-oq.md`](../reviews/ingest-oq.md)
   §6, design only): the client's `exactSeries` grammar refuses a PCS-coded id with `~`; the optimal-quality series'
   own id under the serving grammar; whether two bundles a DICOM series is allowed; a late instance writes both
   series again.

## Waits for the owner

Item 3's decisions; the second writer (#220's questions); cleared `incoming/` or a kept mirror; layout A or B; any
merge, close or removal. Item 4 waits for the PCS team.

## Pointers

[`../ingest/`](../ingest/README.md) (`pacs-receive-design.md`, `pcs-pacs-options.md`, `rsync-delivery.md`,
`rsync-updates.md`, `sync-protocol/`), `docs/disk-layout/target.md`, `ingest/`, `common/series-bundle`,
`common/from-disk`, `tools/pacs-verify`; [`../reviews/ingest-oq.md`](../reviews/ingest-oq.md).
