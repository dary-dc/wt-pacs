state: done
started: 2026-11-14T23:14Z
heartbeat: 2026-11-14T23:32Z
outputs: claude/work-ledger:docs/queue/MERGE-ALL-PLAN-report.md
## Resume
Done. The report is docs/queue/MERGE-ALL-PLAN-report.md on this branch; test merges were local and are not pushed.
## Result
334 remote branches; 155 carried by main or a unified-* tip; 127 uncarried tips judged (86 merge, 4 patch-carried,
10 superseded, 2 history, 11 not relevant, 14 owner calls). Plan: each line into its unified branch (A), then the
lines into one branch, `claude/unified`, from unified-client (B). Test merges (--no-ff, cumulative, provisional
resolution): A codecs 30 merges/18 conflicting, server 8/6, PACS none, client 63/47; B codecs 11 files, server 31,
PACS 7, hygiene 29. series-server compiles after A, not after B: `server.rs` needs a written resolution of three
lines' changes (§5). Expected tree: 1 523 files, +610 744 lines, mostly lab rows. Not run: the gate, browser checks.
Limits: one read of origin at 23:15 UTC; PR numbers by head commit; relevance one reading per branch.
docs/lines/coordination.md is not updated (the row pushes nothing but the report); a pointer is owed there.
Owner: approve the plan and the name (M8); calls M1–M9 in the report's §7 (M1: `-s ours` for the pre-mainbase
lineage and whether `client/conformance/av1` returns; M6: merging a proposal adopts it).
