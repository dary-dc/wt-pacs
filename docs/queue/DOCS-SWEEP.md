state: done
started: 2026-11-14T17:12Z
heartbeat: 2026-11-14T17:50Z
outputs: claude/work-ledger:docs/queue/DOCS-SWEEP-inventory.md (95ea5ae0 and this commit); no PR, no other branch written
## Resume
Done. Nothing owed by this row; DOCS-FOLD reads the inventory.
## Result
Inventory in 7 parts (513 lines): 1 owner decisions O1-O20, contradictions K1-K3, the seven doc corrections C1-C7 (the five named, verified on the tip, plus the exactness-report gate and the mismatch-marking check); 2 direction's client/optimal-quality/native line docs against the tip; 3-6 four branch-group readers (wip/ask, core/opfs/native, phone/demo/telemetry/integrity, av1 client side), each with its own doc-corrections list; 7 branches skipped as not client side.
Scope: 228 non-ancestor branches changing docs; about 160 read by group, 67 screened by path and keyword.
Findings: the page still marks (not blocks) a mismatched frame (screen.js:6), contradicting owner decision 2; the exactness report is gated by the rate in code (load-report.js) though the ADR says always sent; client/README.md contradicts itself on who writes OPFS by default.
Limits: readers judged the five large av1 branches by blob comparison, not line by line; G3 read no code; part 1 line numbers into optimal-quality.md are approximate.
Owner decisions: none new.
