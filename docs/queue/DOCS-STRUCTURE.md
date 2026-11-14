state: done
started: 2026-11-14T17:13Z
heartbeat: 2026-11-14T17:35Z
outputs: claude/docs-client 526a54af, PR #384 (draft into claude/unified-client); loss list claude/work-ledger:docs/queue/DOCS-STRUCTURE-loss-list.md
## Resume
Done. Commits on claude/docs-client: 0c2bef28 (design.md, the split), e904d591 (CLAUDE.md §Docs), 3117d486 (product
statement), 3b1f28b5 (line docs), 526a54af (PR number in the line doc). Next row on this branch: DOCS-FOLD.
## Result
CLAUDE.md §Docs holds the structure and its keeping rules; docs/ARCHITECTURE.md §The product holds the statement,
pointed to from README.md, client/README.md, docs/lines/README.md and the three client-side line docs.
docs/client/design.md (148 lines): what it is, 15 rules, 23 decisions (the five of 2026-11-14 included), Open.
docs/adr/frame-path.md moved by line range into 14 docs/client/evidence/*.md, word for word but queue-row names and
"lever N" -> "choice N"; frame-path.md is a section map (code pointers resolve through it); sources.txt beside them.
Loss check: 0 of 3988 old lines missing; 71 headings, 7584 numbers on 1862 lines listed in the ledger file.
Line docs client, optimal-quality, native: work state only, claude/direction's state carried by edit.
Gate: scripts/gate.sh --quick --no-browser OK (379 s), skips named in #384. Left for review: the evidence files'
in-file labels (M1-M5, S1-S3, FM/VW/MAP/ARMS/WC). DOCS-FOLD links cache-options.md from design.md §Open.
Owner decision: none new.
