# Queue close, 2026-11-13

QUEUE-CLOSE's output for `docs/queue-2026-11-10.md`, written 2026-11-13 21:30 UTC from the status files on
`claude/work-ledger` and the branches they name. Nothing was run, measured or merged; nothing is scheduled.

## 1. Rows not done

| row | state | why | Resume |
| --- | --- | --- | --- |
| BRIEF-THU | no status file | dropped by the owner's decisions of 2026-11-11 21:15 | none; BRIEF-FRI covered 11-11 and 11-12 |
| PRE-DEMO | no status file | dropped (21:15); "its check of `main` runs after the owner's words" | `main` is still `017a3ca6` and `claude/core` `2e6fa5b2` at 21:25: neither word given, so the check has not come due (§3, row MAIN-CHECK) |

Every other row's status file reads `done` (90 files, none `started`, none `blocked`, none stalled). PHONE-RUN is
`done` with its analysis left to the next round by the owner (2026-11-12); its Resume holds the asks and the local
state on the owner's laptop, outside git.

## 2. Left open by rows marked done

Findings and decisions written in done rows that no row of `docs/queue-2026-11-14.md` takes, so they are not lost:

* `lab/faultbench/index.html:28` reads `info.path`, now `info.route` after NAMES-1 (UNIFY-REVIEW; not fixed, its
  failing test needs a browser run with built decoders). Belongs on PR 374; NAMES-1-REVIEW should take it.
* REVIEW-E2E2: the demo loop's `tail -1` hides the failing claim; its guard file may be partial (PR 362, not fixed).
* PROPOSALS-CONSOLIDATE's next wave, outside the 11-14 queue: P6-RULE3, HTJ2K-A1, BBR-IW-READ, TILES-STEP.
* UNIFY-REVIEW: PR 379 and `claude/direction` both rewrite `docs/lines/*.md`, a conflict ahead of either merge.
* The owner decisions BRIEF-FRI lists (`claude/reviews-2026-11-13:docs/reviews-2026-11-13.md` §3), the two merge words
  first. They are the owner's, not rows.

## 3. The next queue (proposal)

Start `docs/queue-2026-11-14.md` (QUEUE-2W: 36 rows, 11-14 to 11-27, at most four running, no merges) with these
amendments, each the owner's yes:

1. **NAMES-1-REVIEW** also fixes `info.route` in `lab/faultbench/index.html` on PR 374, a failing test first (§2).
2. **MAIN-CHECK** (after word 2, or not at all): PRE-DEMO's check of `main`: CI green, the README's commands start the
   servers from a fresh clone, and whether `main`'s tree equals the demo commit's plus the docs-only commits.
3. **Next wave** from `docs/lines/proposals.md` §Consolidated: P6-RULE3, HTJ2K-A1, BBR-IW-READ, TILES-STEP, each a
   protocol row then a measure row by another session, placed in the days the 11-14 queue leaves light (11-24 on).
4. **E2E-LOOP-FIX**: REVIEW-E2E2's two unfixed findings on PR 362, a failing test first, with a review row.
5. **LAB-E** and **LAB-E-REVIEW** (§4), only if the owner picks option E.

What it still leaves out is listed in `docs/queue-2026-11-14.md` §What this queue leaves out, and why; owner decisions stay out of every row.

## 4. `lab/` off `main` entirely (the owner, 2026-11-11)

The proposal is LAB-OFF-MAIN's: `claude/lab-off-main:docs/reviews/lab-off-main.md` (3d196b96, docs only, no PR). It
counts eight ties from `main` to `lab/` (T1–T8: workspace crates, server lab features, the viewer's lab gate, product
tests using lab helpers, build output under `lab/`, the optimal-quality series writer, the gate's 11 lab steps and
the perf job, about 1 500 doc citations) and weighs five options:

| option | what moves | cost (an assumption, not measured) |
| --- | --- | --- |
| A | nothing: today's rule, the absence check | none |
| B | all of `lab/` to one lab branch, merged from `main` | E plus T1, T2, T7 and the citation rewrite (T8); two to four days |
| C | `lab/` split onto each line's branch | B's, per line; dominated by B |
| D | `lab/` to its own repository | B's plus cross-repo CI; dominated by B |
| E | only the product's reach into `lab/` (T4–T6) | the smallest step |

Its recommendation: **E now, B judged after E on its total effect.** As queue rows, if the owner picks E:
**LAB-E** (one branch from `main` after word 2, one tie per commit: T4's helpers into the product's test trees, T5's
build directory renamed, T6's writer to `ingest/` as INGEST-OQ's design decides; the gate and `check_links.py`) and
**LAB-E-REVIEW** (another session: each moved test still fails on its mutant, nothing under `lab/` is imported by
product code). B would be its own proposal after E lands, with the lab branch's name and CI cadence for the owner.

## 5. Owner decisions

1. Start `docs/queue-2026-11-14.md`, with which of §3's amendments, and its pace.
2. `lab/`: option A–E (E then B recommended).
3. Once read, this file and `docs/queue-2026-11-10.md` can be removed from `claude/work-ledger` (the queue file says
   so; nothing is deleted here without the owner's yes).
