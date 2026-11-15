# PACS receive and metadata

Last verified 2026-10-29 (the design state); branches and PRs 2026-11-09.

## Goal

The PACS side of wt-pacs: receive what the PCS produces, check it, build and **update** each study's store, and serve
every series by UID. The PCS receives, parses and encodes (HTJ2K `mf.mxf`, AV1 `mf.mp4`, `sf.jxl`); its directory
layout is our input contract. Depth over breadth; theory and a pre-registered measurement first.

## State now

* **Built, draft, carried by `claude/line-pacs` (#258, not for merge yet):** the sender at the PCS, the receiver,
  `pacs-verify` and `claude/line-pacs:common/from-disk`, serve-by-UID, the carrier; metadata, SQLite and
  study-index labs; ADRs. No resend-identity logic anywhere, on purpose.
* **Delivery reopened 2026-10-28:** rsync is the proposed PCS → PACS delivery, so the design became generic:
  `claude/line-pacs:docs/ingest/pcs-pacs-options.md` (#230) has eight parts with defaults per profile and four
  profiles (rsync into a cleared `incoming/`; the package as built; tar over rsync as a bridge; a **kept mirror**,
  `rsync -a --delete` into `mirror/<exam>/` outside the serving tree). Proposed; the structure awaits review.
* **rsync, theory (#233, #234; quotes not re-verified):** rsync's whole-file checksum covers the wire, not a read-back
  from disk, quick-check skips or corruption at rest at the PCS. Proposed order: read back the frame container in
  `incoming/` → rename → one DB transaction → read rows back → "stored" → study index → clean `incoming/` last.
* **The hash bridge, open:** under rsync the group files arrive BLAKE3-named, while our side checks XXH3. Options:
  (a) the PACS verifies the PCS's BLAKE3 names, our DB keeps XXH3 (recommended: only the parser's write-time hash
  catches corruption at rest); (b) our trigger lists XXH3 per file; (c) an XXH3-named copy before rsync. The PCS's raw
  frame files carry no hash.
* **Synchronization protocol:** #221 prior art, #222 shapes (A + F recommended), #220 a second writer, #223 measured
  B vs E (a one-group CT fix: E 35 KB, B 10–11 KB, a gap of one round trip; the pre-registered verdict is E).
  Two conflicts remain: the hash bridge ((a) in #233, (b) in #234) and update pattern P3 (#234) vs E (#223).
  Neither compared the kept mirror.
* **Layout:** the PCS's code and its design document agree at exam and series, disagree below; following the code
  now (A) is recommended, the design document's target is B. Not chosen.
* The 2026-10-28 night items in the logs are leanings, not decisions.

## Open (ordered)

1. Evaluate under rsync, in order: cleared `incoming/` or kept mirror (turns on the PCS team's answers); the hash
   bridge; for a cleared `incoming/`, P3 vs E; layout A or B and who builds the `.sbnd`.
2. The synchronization protocol: A + F or E + F; the second writer is the fork (#220's questions for the product
   owner); then implement in sender and receiver.
3. Owner decisions waiting: hash column type, reply file and words, carrier, study-DB layout, viewer metadata, DB
   engine, study index (engine and placement: open), serving defaults, verdict travel.
4. Questions for the PCS team: is each exam's tree kept as the record while updates can come; does it show the current
   state; can it sync a quiet or snapshotted tree; frame-file hashes; layout details.
5. A signed 8-bit source off centre once wrapped in Int8 past the ingest gate and the client digest; fixed on
   `claude/av1-unified-mainbase` (`docs/av1/payload-format.md` P4), not yet on `claude/core`. Whether the receive
   path needs its own check is open.
6. One or two commits each on `pacs-design-state` (#168), `pacs-disk-layout-measure` (#167), `pcs-pacs-options`
   (#230), `rsync-options`, `rsync-updates` are not yet in `line-pacs`.
7. The optimal-quality pair at ingest (INGEST-OQ, 2026-11-12, [`../reviews/ingest-oq.md`](../reviews/ingest-oq.md)
   §6, design only): the client's `exactSeries` grammar refuses a PCS-coded id with `~`; the optimal-quality series'
   own id under the serving grammar; whether two bundles a DICOM series is allowed; a late instance writes both
   series again.

## Decisions (the owner's)

* 2026-10-24: our scope starts at the PACS; the PCS encodes; the server stays on `.sbnd` (no MXF or MP4 reading);
  file-name hashes in this repo are XXH3; display metadata is updated in place, no kept history.
* 2026-10-25: final checks read from disk, not memory; extraction stages in `incoming/`, the serving tree changes only
  by rename.
* 2026-10-26: the PCS decides when a series is complete; replies and retries required; frames stay contiguous in
  display order; metadata compression configurable per site, the receiver accepting both by zstd magic; one
  disk-read helper; nothing unfinished is merged; QUIC chosen at build time.
* 2026-10-26/27: late instances are merged by a full `.sbnd` rewrite with a rename; a tail rewrite only if merges
  prove frequent.
* 2026-10-28: XXH3 here and BLAKE3 at the PCS is by design; the layout contract follows the PCS's code and design
  document; the trigger is the completeness signal; design generic, options per part.
* 2026-10-29: the tar package is one profile of our own choosing, not an agreement with the PCS team; the kept
  mirror added as an option, not decided; organize and evaluate from the research done, no new investigations.

## Pointers

`docs/ingest/`, `docs/disk-layout/target.md`, `ingest/`, `common/series-bundle`;
`claude/line-pacs:docs/ingest/` (`pacs-receive-design.md`, `pcs-pacs-options.md`, `rsync-delivery.md`,
`rsync-updates.md`, `sync-protocol/`); PRs #258, #168, #230, #233, #234, #220–#223.
