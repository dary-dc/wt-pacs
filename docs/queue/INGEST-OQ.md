state: done
started: 2026-11-12T05:12Z
heartbeat: 2026-11-12T06:05Z
outputs: `claude/ingest-oq` 68c15c2a (docs/reviews/ingest-oq.md; docs/lines/optimal-quality.md Open 6, metadata.md Open 7), no PR (design, docs only)
## Resume
Done; nothing left for this row. A build row would start from docs/reviews/ingest-oq.md §7 (tests T1–T5) after the owner's §8 calls.
## Result
* Design only, read from code at the demo tip claude/demo-fixes-2 18d2d1ff and claude/line-pacs:docs/ingest/; nothing run or measured.
* Input: build for raw frames (layout A) and the PCS's HTJ2K codestreams (layout B) alike, one step from source samples; the PCS's own AV1 left out (settings not ours to show).
* Q and G: the PCS's trigger passes them while the ingest runs at the PCS host; they travel in `lossy` after.
* Writer: the Rust ingest's phase 2 (decided language, reads the contract, already links av1_decode), aomenc as a subprocess so its
  bytes equal ingest.py's `lossy` by construction, held there by a parity test as phase 1 was; Python from_dicom.py --lossy (~40 lines) only as a stopgap.
* Order: exact series first, the optimal-quality series from the same samples and one display dict, never published alone; a refused OQ leaves the exact series served.
* Any value: Q 1–63, any G, unsigned D > 10 always cut (the lab's uncut default is wrong for the product); gap: signed sources over 10 bits after the offset have no form on the product path.
* Found (read, not run): pairOf's /^[\w.-]+$/ refuses PCS-coded ids, whose alphabet has `~`; the OQ series' own id does not fit the serving grammar (no `.`).
* Tests proposed T1–T5 with the mutants each must kill (parity, value matrix, pair invariants via checkPair, publish order, demo-check.mjs).
* Owner: which ingest (R recommended); signed gap S1 (cut after the offset, extends a decided approach) or S2 (exact only); Q/G source;
  whether the PCS may code OQ; for the PACS line F1–F3 (id grammar, two bundles a series, a late instance rewrites both).
