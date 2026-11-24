# The evaluation release's cleanup

Row EVAL-RELEASE of `claude/work-ledger:docs/queue-2026-11-24.md` (amendment 28 item 3.1; `unified-to-main` §4).
`claude/eval-release` was created from `origin/claude/unified` at `b059388b6` (UNIFIED-SYNC-1124's tip, its full gate
OK in 722 s on `b7cc007f7`; `b059388b6` adds one line-doc entry). Re-derived on that tip, 2026-11-24.

## 1 · COMPLEXITY-AUDIT's items on the tip

The audit (`claude/work-ledger:docs/queue/COMPLEXITY-AUDIT-report.md`, at `ff2bc154`) ranked nine items. Each, read
again on `b059388b6`:

| # | item | on the tip | how it was found |
| ---: | --- | --- | --- |
| 1 | two study-DB schemas | **landed**: `common/study-db/src/lib.rs` writes `xxh3 TEXT NOT NULL` and a `series` column, and both `ingest/receiver` and `tools/pacs-verify` depend on it (their `Cargo.toml`) | `grep`, this row |
| 2 | the owner's first name in three public files | **landed** (UNIFIED-CLEAN and AUDIT-MECHANICAL `2b0064cb`); `handoff/` itself is still on the tip, its removal the owner's (audit: "removal") | `docs/lines/coordination.md`; `ls handoff/` |
| 3 | a gate step that runs nothing | **landed**: no M5 step in `scripts/gate.sh` | `grep`, this row |
| 4 | two names of one concept | **landed** (UNIFIED-NAMES, PR 427): no product file uses *lossy stream*; `docs/glossary.md` keeps it as the earlier name; the 11 lines left in `docs/` use it for any lossy AV1 stream (the glossary's second sense) or are dated records | `git grep`, this row |
| 5 | two readers of the parser's group file | **open**, a proposal (below) | `ingest/from-parser/src/group.rs`, `ingest/receiver/src/group.rs` still both present |
| 6 | lab levers in `Sessions` as field pairs | **landed** in UNIFIED-LEVERS's form (PR 423): one `lab: LabLevers` in `ServeConfig`, one `cfg(not(feature = "lab-levers"))` left in `server/src` (`main.rs:134`, the default build refusing the flags) | `grep`, this row |
| 7 | `lab/` grew to 104 334 lines | **open**, a removal: LAB-REMOVAL-LIST and LAB-REMOVAL (this queue) | — |
| 8 | `docs/` doubled | **open**, in part: LINES-FOLD (this queue, running) folds `docs/lines/`; two files owning one subject is `unified-to-main` item 6's DOCS-PAIRS, held | — |
| 9 | two HTTP/3 stacks | recorded, nothing to clean | — |

**So no mechanical item is left to build here**: the cleanup commits of this row are none, and the branch's tree
equals `claude/unified`'s but for this file. The gate was not run again (a docs-only commit on a tree whose full gate
passed); `scripts/check_links.py` and the comment budget were.

## 2 · Proposals, not built

Each is structural or waits on a page; one line each, with the page that holds it. Sources: FABLE-SIMPLIFY's P-list
(`claude/fable-simplify` `460488d9`, `docs/proposals/simplify-fable.md` §3), OPT-SIMPLIFY's S-list
(`claude/demo-simplify` `d70ccb9f`, `docs/lines/proposals.md` §Simplify), the audit. The pages are
`claude/reviews-2026-11-28:docs/decisions/<page>.md`. Which page holds which P item is this row's reading of
UNIFIED-SIMPLIFY's brief ("they wait on the `view-target`, `cache`, `asking` and `visually-lossless` pages").

| item | the proposal | held on |
| --- | --- | --- |
| audit 5 | one reader of the group file in a common crate, which duplicate tag wins decided and tested | a design (the PACS line's; `pacs-sync`) |
| audit 2 | `handoff/` removed, or folded into `docs/ingest/` | the owner's yes (`unified-to-main` item 4, with the lab removals) |
| P4 | one way to ask (the want), whichever view | `asking` |
| P5 | one view | `view-target` |
| P6 | one start order: `pageDials`, `viewWorkerFirst`, `glAfterDial`, `shortRuns` become the code (19 uses on the tip) | `view-target` |
| P7 | one cache writer (`store`): `cache.js`'s `files()`, `view/frame-file.js` and the writer plumbing go | `cache` |
| P8 | one cine: `Cine` (`client/view/clock.js`) out of the product tree once the frame clock's rule names its source | `view-target` |
| P10 | the AV1 deep route the ≤ 10-bit rule leaves unreachable (`refusedDeep`, `av1-mixed`) out of `decode/av1.js` | `visually-lossless` (the stored form's rig) |
| S2 | one view on the demo path | `view-target` (as P5) |
| S4 | — | **done** (`7d93e0305`, on the tip; `client-calls` item 9) |
| S5 | `client` and `view` off the reader's status line into `?overlay=1` | `client-calls` item 9 (S5 **yes** recommended, unanswered) |

Two review minors of PR 426 (UNIFIED-SIMPLIFY-REVIEW) are still on the tip and are one line each, left for
EVAL-RELEASE-REVIEW to take or drop: `client/view/clock.js`'s first line still calls it the view worker's clock only
(m2), and PR 426's claim that `Cine` stays lazily imported no longer holds (m1).

**Fixtures and limits.** Nothing run but `grep`, `git` and the docs checks; nothing timed. The audit's own limits
stand (read at `ff2bc154`; contradictions in `docs/` beyond items 1 and 4 not looked for).
