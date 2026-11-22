state: done
started: 2026-11-22T17:06Z
heartbeat: 2026-11-22T17:11Z
outputs: claude/reviews-2026-11-28 625b10774 (docs/decisions/ingest-optimal-quality.md; README index line; docs/lines/optimal-quality.md pointer); PR 405 (no new PR)
## Resume
Done. Nothing owed by this row. DECISION-PAGES-REVIEW reads the page.
## Result
* Page written, not provisional: INGEST-OQ-TESTS-REVIEW and NOISE-INGEST-MEASURE done. Nothing run but git and PR reads.
* Measured (git): claude/unified carries all of #390's branch claude/oq-ingest; PR 321 closed 2026-11-18, carried.
* Measured (read): both ingests' decode-back checks the decoded shape only (ingest.py; optimal.rs:137).
* Found: the flag's bare G 8 was chosen by no measurement (codecs §Open 1: no G decided for DBT); labelled a placeholder.
* PCS note on G for AV1 cine drafted in §9 (three questions), not sent; the σ_min note is noise-point.md's.
* Fixtures: none new. Inputs rest on synthetic sets, dbts_a1 parity, three timed DBT volumes (EA1141, systems A-C),
  one 4-core cloud host; no breast US clip, no PCS package, no browser run on a pair the product ingest wrote.
* check_links: 5 unresolved, all pre-existing in other pages; comment budget ok; gate not run (docs only).
* Owner decisions (the page's §2): R kept (#390); S2; Q and G from the trigger, no product default; I3 not now;
  F1 fix once pacs-sync item 7 is yes; F2 with the store layout; F3 rewrite both; a decode-back guard queued;
  merge PRs 413 and 421 (m1 first); send both PCS notes.
