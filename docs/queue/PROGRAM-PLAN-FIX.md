state: done
started: 2026-11-19T03:16Z
heartbeat: 2026-11-19T03:18Z
outputs: `claude/work-ledger` at `8c011bf6`: `docs/queue-2026-11-14.md` (rows, briefs, §Program review *Fixed*);
`docs/queue-client-2026-11-14.md` §Procedure, rules (B1's line); `docs/lines/coordination.md` §Open 9. No PR (the ledger only)
## Resume
Done. Next: PROGRAM-PLAN-FIX-REVIEW (client queue), by a session that wrote none of the program, its review or this fix:
`git diff 8c011bf6~1 8c011bf6 -- docs/queue-2026-11-14.md docs/queue-client-2026-11-14.md`.
## Result
* Docs only: the gate not run; `scripts/check_links.py` 451 → 454 unresolved, the three new ones paths that live on
  `claude/unified` (`docs/htj2k-tiles.md`, `lab/htj2k-tiles/improve/stage3/` twice), the same class as before.
* B1: the client queue's worker takes the program's first due row when none of its own is due (at most four running);
  a Fable session the §Fable rows by their days.
* B2: DOCS-SYNC never merges `claude/work-ledger`, `claude/reviews-*`, or a branch whose PR says "do not merge".
* B3: HTJ2K-A1-BUILD (D+T1 and its mutant in `stage3/`, 11-19 08:00 → 11-20 20:00), its review (→ 11-21 08:00), then
  HTJ2K-A1-RUN (from 11-20 08:00, latest 11-22 20:00 kept).
* B4: DECISION-PAGES-REVIEW needs every -PAGE row, latest 11-27 22:00; PROGRAM-CLOSE needs it and its fixes, latest 11-28 12:00.
* m1–m6 fixed one line each (§Program review *Fixed*); m7 unchanged, the owner's call.
* Owner: the DOCS-SYNC rows still need the owner's word to push merges to `claude/unified` (m7).
