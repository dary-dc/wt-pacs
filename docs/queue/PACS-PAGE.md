state: done
started: 2026-11-22T16:46Z
heartbeat: 2026-11-22T16:50Z
outputs: claude/reviews-2026-11-28 e525c855f (docs/decisions/pacs-sync.md; README index line; docs/lines/metadata.md §Open 6 corrected); PR 405 (no new PR)
## Resume
Done. Nothing owed by this row. DECISION-PAGES-REVIEW reads the page.
## Result
* Page written, not provisional: all three needs were done. Nothing run except git over the branches; no new investigation (2026-10-29).
* Measured (git): metadata §Open 6 is closed; claude/unified carries every commit of pacs-design-state, pacs-disk-layout-measure,
  pcs-pacs-options, rsync-options, rsync-updates and line-pacs. Corrected in place in metadata.md on claude/reviews-2026-11-28.
* The PCS team's note drafted in the page's §9 (ten questions, each with what its answer decides), not sent.
* Fixtures: none new. Inputs rest on the receiver's synthetic packages, #223's one CT fix on loopback, #234's estimates
  (five TCIA series, a synthetic 2 000); no DBT or US series has been through the PCS's parser or the receive path.
* check_links: 5 unresolved, all pre-existing in other pages (none from this row); comment budget ok; gate not run (docs only).
* Owner decisions (the page's §2): merge PRs 407 (xxh3 TEXT), 422, 417; one writer for now (P5), so E + F; hash bridge (a);
  layout A until the PCS answers; §14's remaining defaults (D3, D5, D6, D7, D9, D10, D13) as one yes; one group-file reader
  queued as a proposal row; viewer metadata (viewer §4 item 8) not now; send the PCS note.
