state: done
started: 2026-11-14T21:32Z
heartbeat: 2026-11-15T00:05Z
outputs: claude/docs-client 67a49208 (fold commits since 61d4a974, subjects "fold:"), PR #384 body section "Fold"
## Resume
Done. Nothing owed by this row. Next on this branch: DOCS-PAGE (needs this row and CACHE-OPTIONS, both done).
## Result
Inventory folded by four writers (asking; cache, view worker, native; phone and telemetry; optimal quality's client
side), each on disjoint files, plus the coordinator on Part 1 and the reserved files.
* design.md: 10 decisions added to §Decided with dates; §Open rewritten, every folded question with what decides it
  and its evidence (211 lines, over "about three screens": flagged for DOCS-REVIEW).
* 40 new docs/client/evidence/ files; dated sections in 7 existing ones; cache-options.md and frame-integrity.md linked.
* Corrections C1-C7 applied in place (exactness ADR §5, §8; client/README.md; decode/hardware.md; fill-bound and
  view-target evidence); the parts' corrections in WIRE.md, the stride ADR, decode/README.md, native/README.md,
  CLIENTS.md, levers.md, merge-readiness.md, av1/*, devices.md, glossary.md.
* Left (PR body): codecs, ingest, server, transport and viewer items; decode/README.md 1828-1861, 2016, 2886; three
  glossary rows; the cine bullet (code not on this branch).
* Gate --quick --no-browser OK in 381 s (skips named in #384); check_links 0 unresolved.
* Phone and laptop named by kind only (a writer had named the phone's model).
Owner: contradictions in design.md §Open (stride ADR vs never skipping; frame-memory questions 3 and 4; the phone
run's 10-minute rule and bbr; readMin not merged; bar 1.00 or 1.03); the coded-bytes digest is a candidate for the owner.
