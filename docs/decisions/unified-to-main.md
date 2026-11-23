# What `claude/unified` still needs before `main`

Written 2026-11-23 by row UNIFIED-PAGE (`claude/work-ledger:docs/queue-2026-11-14.md`, inventory row 20, the brief
*UNIFIED-PAGE*), from pushed results, read-only GitHub queries and one test merge (§3.1); nothing else run, the gate
not run. Inputs at: `origin/claude/unified` `4a2b4277f` (2026-11-20 06:35 UTC, unchanged since); the unified track's
status files on `claude/work-ledger` (UNIFIED-REMOVALS to UNIFIED-SYNC-1122, SELINUX-BUILD-RESTORE) and
`docs/queue/MERGE-ALL-PLAN-report.md` §7 (M3, M5, M6, M7); [`final-state.md`](final-state.md) §5 (the seven
conditions, this page's checklist); [`lab-list.md`](lab-list.md); the pages that already decided an M-call
([`frame-integrity`](frame-integrity.md), [`reports`](reports.md), [`ingest-optimal-quality`](ingest-optimal-quality.md),
[`asking`](asking.md), [`paused-lines`](paused-lines.md), [`repository`](repository.md)); the open PRs as GitHub
returned them on 2026-11-23 at about 02:10 UTC.

## 1 · The question

What stands between `claude/unified` and one draft PR into `main` called the *evaluation release* (amendment 27
item 7; [`final-state.md`](final-state.md) §2): which of the track's PRs go in and in what order, which older
proposals in product paths (M6) are adopted, and which of the seven *bench-verified* conditions the tip does not meet
yet. It is the owner's because merging adopts code, removes things, and fixes what `main` will say it is.

Amendment 28 rule 1 (the owner, 2026-11-22) changed the mechanics: a sync row now merges, without a word, any PR into
`claude/unified` whose latest independent review has no blocker open and after which the gate passes. So most rows
of the table below no longer need a yes; the owner's calls are the ones rule 1 does not settle (§2, items 2–6).

## 2 · The recommendation, and the owner's yes or no

**Let the sync rows merge the eleven reviewed track PRs in the order of §3.1, PR 433 and PR 410 once their open rows
close; take M6 as the pages already say (PRs 368 and 378 ported onto `claude/unified`, PRs 370, 309, 265 and 372 left
open, PRs 376 and 390 already in); and open the evaluation release's PR into `main` only after four phase-2 rows
close the conditions the tip misses (§4): a table of defaults, an ultrasound clip (`usb_cine`) end to end, the full
gate in CI, and the 47 unread `lab/` directories removed.**

How it serves the value statement (README §Purpose, PR 432): "one small MIT-licensed server" is condition 4; the
rest makes `main`'s claim about speed and exactness one a reviewer can check on the branch.

| # | the owner's yes or no | recommended | a yes changes | a no leaves |
| ---: | --- | --- | --- | --- |
| 1 | Rule 1 covers removals and structural PRs too (411, 412, 424), whose rows said "merging is the owner's yes" (§Standing rules, the older word) | **yes** | the next sync row merges them with the rest, in §3.1's order | 411, 412 and 424 wait for the owner's merge; the rest go in |
| 2 | M6: PR 368 and PR 378 ported onto `claude/unified` (their base is the old demo tip), each reviewed, then merged by a sync row | **yes** (368 provisional, §6) | two port rows in phase 2 (368's is the fix row [`frame-integrity`](frame-integrity.md) row 6 names) | both stay open drafts on the demo tip |
| 3 | M6: PRs 370, 309, 265, 372 stay open, none merged | **yes** | nothing; each keeps its record | a merge row for the one named |
| 4 | The 47 `lab/` directories no gate step reads ([`lab-list.md`](lab-list.md)) removed from `claude/unified` in one PR, after 11-28, keeping `htj2k-tiles`, `faultbench` and the device kit; recovered from history, **no archive tag** | **yes** | one removal row in phase 2 (`claude/eval-release`, amendment 28 item 3.1) | `lab/` keeps 26 391 code lines nothing reads; condition 4 not met |
| 5 | The evaluation release waits on the four rows of §4 | **yes** | PHASE2-PLAN queues them before the PR into `main` | the PR into `main` opens with conditions 2, 3 and 5 unmet and says so |
| 6 | Audit item 8 (`docs/` doubled; two files owning one subject): a findings row lists the pairs after LINES-FOLD, a fold row per pair after the list | **yes** | one findings row in phase 2 | doubled files stay; each is found by its next reader |

The calls that need no new word, recorded so no row asks again: **M3** (PR 96, the one queue) held for the shallow
commitment's run ([`asking`](asking.md) row 4); **M5** (the viewer line) stays out of `claude/unified`
([`paused-lines`](paused-lines.md)); **M7** (the work ledger) never merges ([`repository`](repository.md) row 5).

## 3 · The options

### 3.1 The track's PRs, in the order to merge

Order and conflicts are **measured** here: one sequential `git merge --no-ff` of each branch onto
`origin/claude/unified` `4a2b4277f`, in the order listed, a conflicting merge aborted and the next taken (so a later
"clean" is clean without the aborted ones). Not run: the gate at any of these tips.

| order | PR | what | latest review (by a session that wrote none of it) | gate on its branch | test merge here | merged by |
| ---: | --- | --- | --- | --- | --- | --- |
| 1 | 415 | three line docs in the work-state form | UNIFIED-DOCS-REVIEW-FIX-REVIEW: no blocker | docs only | clean | sync row |
| 2 | 416 | AV1 audits' corrections applied | the same re-review: no blocker; merge after 415 | docs only (5 `lab/**/*.md`) | clean | sync row |
| 3 | 428 | `client/README.md` *Frames*: no frame leaves memory | CLIENT-README-CACHE-FIX-REVIEW: no blocker | docs only | clean | sync row |
| 4 | 432 | README opens with the value statement | VALUE-STATEMENT-REVIEW: no blocker, m1–m6 | docs only | clean | DOCS-SYNC-1123 |
| 5 | 412 | remove `handoff/` | UNIFIED-REMOVALS-REVIEW: no blocker | OK (811 s or 477 s, UNIFIED-REMOVALS, which does not say which branch took which); the review's merge gate `--quick` OK, 292 s | clean | sync row (item 1) |
| 6 | 411 | remove the frame clock (`git revert 24b80bcd`) | the same: no blocker, m1 m2 in docs | OK (the other of 811 s and 477 s); the review's merge gate full, OK 790 s | clean | sync row (item 1) |
| 7 | 423 | lab levers set on `Sessions` by one call | UNIFIED-BUILDS-REVIEW: no blocker | OK, 58 steps | clean | sync row |
| 8 | 424 | the five lab crates in a workspace of their own | the same: no blocker; m1 the two locks unchecked | OK 754 s | conflict: `docs/lines/coordination.md` | sync row (item 1), the line doc resolved |
| 9 | 425 | OpenJPH 0.31.0 → 0.33.0 in the decoder | the same: no blocker | `--quick` OK | conflict: `docs/lines/client.md` | sync row |
| 10 | 426 | P9's moves (depth cut, one clock, store worker) | UNIFIED-SIMPLIFY-REVIEW: no blocker, m1 m2 | full OK | clean | sync row |
| 11 | 427 | NAMES-1's leftovers | the same: no blocker; m1 no gate step runs `r3_arm.test` | OK 883 s | conflict: `docs/lines/coordination.md` | sync row |
| 12 | 433 | SELinux build flag restored | **owed**: SELINUX-BUILD-RESTORE-REVIEW (latest 11-23 16:00) | full OK 727 s | conflict: `docs/lines/coordination.md` | sync row, after its review |
| 13 | 410 | which client results hold in which engine | ENGINE-REVIEW-FIX-REVIEW: no blocker; **gate fails** on two personal paths | `--quick` fails (UNIFIED-SYNC-1122) | conflict: `docs/lines/client.md` | sync row, after ENGINES-PATH-FIX and its review |

Every conflict but one is a line doc that two PRs each dated; the one in code is outside the track: PR 419 against
PR 418 in `client/viewer/demo-check.mjs` (both from [`client-calls`](client-calls.md), "after one review"). Rows 1–7
merge in sequence with no conflict at all.

The other PRs into `claude/unified` are decided by their own pages, not here: 407, 417, 422 ([`pacs-sync`](pacs-sync.md):
yes, 417 after its review; each conflicts in `docs/lines/metadata.md` after 415), 413 and 421 ([`ingest-optimal-quality`](ingest-optimal-quality.md):
yes; 413 conflicts in `docs/lines/codecs.md` after 415, 421 clean), 418 and 419; the theory PRs 420, 429, 430, 431
(each re-reviewed with no blocker open, so rule 1 merges them); 434 (MEMORY-LEAK-TRACE, review owed). Never merged:
402, 405, 409 ("do not merge"); 406 and 408 are the delivery and A1 rigs, read on their branches.

### 3.2 M6: proposals in product paths

| PR | what merging adopts | its state on `claude/unified` | decided by | recommended |
| --- | --- | --- | --- | --- |
| 368 | the view's reconstruction digest and coding error (I1–I3) | not carried, 73 commits ahead; base the old demo tip, unmergeable as is | [`frame-integrity`](frame-integrity.md) row 6 | port, review, merge (**provisional**, §6) |
| 370 | the telemetry module (off by default) | not carried | [`reports`](reports.md) row 11: "no; keep it open" | open |
| 372 | the demo room's network check (`scripts/demo-network.py`, README §Demo) | not carried, 5 commits | no page; the demo is suspended (coordination §Decisions, 2026-11-11 evening) | open |
| 376 | the hidden-page decode deadline given again | **carried** (`claude/hidden-page-decode` is an ancestor of the tip) | adopted by the unification | nothing to do; the PR's close is the owner's |
| 378 | a lost exact ask asked again once, 1 s later | not carried, 23 commits; "carries lab code, fix first" (M6) | [`frame-integrity`](frame-integrity.md) row 7: once is enough, "PR 378 as it stands" | port without its lab code, review, merge |
| 390 | the optimal-quality ingest behind `--optimal-quality` | **carried** (`claude/oq-ingest` an ancestor) | [`ingest-optimal-quality`](ingest-optimal-quality.md): kept, off by default | nothing to do |
| 309 | a reduced-depth view painted at its own depth, behind a flag | not carried, 6 commits | no page; nothing timed (SwiftShader), its GPU protocol owed on the owner's machine | open |
| 265 | `waitAhead` k = 8 | not carried, 14 commits; its downloader fix `52bfb33a` **is** carried | [`asking`](asking.md): `waitAhead` off | open (nothing left in it the product needs) |

### 3.3 The seven conditions at the tip

Each condition of [`final-state.md`](final-state.md) §5, checked at `4a2b4277f` (**read, not run**, except where a
row's gate log is quoted).

| # | condition | at the tip | what closes it |
| ---: | --- | --- | --- |
| 1 | the scope written | **not met**: README §Purpose is on PR 432 | DOCS-SYNC-1123 merges 432 |
| 2 | complete, end to end, DBT and ultrasound | **not met**: the gate serves its small fixtures, no DBT volume (UNIFIED-SIMPLIFY-REVIEW: "no DBT volume served"; `demo-check.mjs` on `dbts_*` runs by hand, no gate step); `fixtures/us_cine_smoke/` is "3 frames, 19-byte placeholders … not HTJ2K" (`docs/FIXTURES.md`) | §4 row 2 |
| 3 | every default chosen by measurement | **not met**: no table; `docs/reviews/understand/defaults.md` (2026-11-11, the demo tip) lists defaults with no measurement each | §4 row 1 |
| 4 | lean | **partly**: `check_lab_absent.sh` and the comment budget pass on every track branch; 411 and 412 open; 47 `lab/` directories (26 391 code lines) read by no gate step (this page's reading: `final-state.md` §5's condition 4 names no `lab/` directory; it rests on §Decided's "`lab/` on `main` is the harness only") | §3.1 rows 5–6, item 4 |
| 5 | gate green, full, only the allowed skip | **not shown**: `gate.yml` runs on PRs into `claude/av1-unified-mainbase`, `claude/core` and `main`, not `claude/unified`; every cloud gate on the track skipped the native painter and window and the web host's check besides the allowed "the viewer's cross-codec arm and Firefox" | §4 row 3 |
| 6 | reviewed, no blocker open | **met** for rows 1–11 of §3.1; owed for 433, 410's path fix, 434 | their review rows |
| 7 | every number names its bench | **not checked** across `docs/`; the decision pages meet it | DECISION-PAGES-REVIEW, for the pages |

## 4 · Where it holds

Fixtures and limits: one tree (`4a2b4277f`) and the 20 branches of §3.1's test merge; conflicts measured, nothing
built or run on the merged tree; the gate figures are each row's own, on 4-core cloud hosts without a GPU, headless
Chromium, the gate's tracked fixtures (the track's PRs ran no DBT volume but UNIFIED-SIMPLIFY's two by hand). No
device, engine or link enters this page.

For US and DBT stacks (amendment 27 item 6): the track's PRs are layout, docs and build changes, so whether they
hold does not depend on the modality (**theory**: no PR here changes what a frame carries or how it is decoded,
except 425, whose decoder was checked on 80 synthetic 8–16-bit frames, not on a DBT or ultrasound frame). Condition
2 is where the modality binds, and today neither is run end to end by the gate.

The four rows the recommendation asks of phase 2, each with its limit:

1. **DEFAULTS-TABLE**: one table of every default (server flag, client option, codec setting), each row a pointer to
   the measurement that chose it or "not measured", from `defaults.md` re-read at the tip.
2. **US-END-TO-END**: `usb_cine` (breast ultrasound cine, 64 × 512², 8-bit, `docs/FIXTURES.md`) coded as the product
   codes it, through the gate's end-to-end step; it is lossy-sourced, so the run shows the path complete and its
   numbers stay provisional by `docs/FIXTURES.md`'s rule. Until it runs, condition 2 is **unmet**: the status line
   "DBT stacks measured; ultrasound stacks carried by theory" states that, it does not close it (corrected 2026-11-23,
   `README.md` §Review B3); US-DBT-CARRY (amendment 28 item 3.3) says by which property the rest carries. A DBT volume (one of `dbts_a1`/`b1`/`c1`) in the same step closes condition 2's DBT half.
3. **GATE-ON-UNIFIED**: `claude/unified` (and `claude/eval-release`) in `gate.yml`'s branch lists, so CI runs the full
   gate with only the allowed skip; the evaluation release's PR into `main` triggers it in any case.
4. **LAB-REMOVE**: item 4's PR.

## 5 · The mechanism

Rule 1 turned most merges into a check (an independent review with no blocker, the gate green after), so what is
left for the owner is what a check cannot decide: whether the older "the owner's merge is the yes" still binds
removals (item 1), what adopting old proposals means (M6), and what the release claims (conditions 2, 3, 5). The
conflicts are almost all in `docs/lines/`, because every row dates its line doc and PR 415 rewrote three of them:
they are resolved by keeping both dated lines, which a sync row's merge message names.

`docs/merge-readiness.md`'s one hole ("the product page takes code and pixels from any address a link names",
2026-10-14) no longer stands at the tip, **read, not run**: `client/viewer/head.js` loads the page's lab parameters
only from `/lab/viewer/levers.js` and refuses them by name where the host does not serve `lab/`, and
`deploy/nginx/wt-pacs.conf.template` sends `default-src 'self'` with `connect-src 'self' ${WT_ORIGINS}`. One residue:
its `script-src` still allows `'unsafe-eval'`. The file should say so in place, the `disk-access.md` §2 way (a
docs-only line in DEFAULTS-TABLE's row).

## 6 · What would change the recommendation

* **PR 368** is provisional: the owner's word of 2026-11-23 ~02:00 (view frames decoded in hardware shown unchecked;
  the mark describes the view, not a check) reopens [`frame-integrity`](frame-integrity.md) row 6 for the view, so
  its port waits for INTEGRITY-PAGE's re-read; the exact frame's check is unchanged.
* A sync row's gate failing after a merge in §3.1's order (none was run on the merged tree): that PR waits, the
  rest go on.
* The commits whose added lines merge `dd681539d`'s rule dropped: two are known losses (`5ce4f0876`, restored by PR
  433; `4019518a`, READMIN-RESTORE), and PR 433's body lists twelve more, not judged. If more are losses, they go in
  before the release; a findings row judges each (§8).
* `usb_cine` run end to end (US-END-TO-END): condition 2's ultrasound half closes; nothing else closes it.

## 7 · What it would reopen

Nothing among the decided approaches. Item 4 follows coordination §Decisions (2026-11-04, corrected 2026-11-11: a
removed experiment is "recovered from history … not from a kept branch or tag"), so it departs from
[`lab-list.md`](lab-list.md)'s "behind an archive tag" on purpose; the device kit is kept (amendment 28).

## 8 · Rows and links

Track rows and their PRs: UNIFIED-REMOVALS, -REVIEW (411, 412); UNIFIED-LINE-DOCS (415), CORRECTIONS-APPLY (416),
UNIFIED-DOCS-REVIEW, -FIX, -FIX-REVIEW; CLIENT-README-CACHE, -REVIEW, -FIX (428), -FIX-REVIEW; UNIFIED-LEVERS (423),
UNIFIED-LAB-WORKSPACE (424), OPENJPH-BUMP (425), UNIFIED-BUILDS-REVIEW; UNIFIED-SIMPLIFY (426), UNIFIED-NAMES (427),
UNIFIED-SIMPLIFY-REVIEW; UNIFIED-LAB-LIST ([`lab-list.md`](lab-list.md)); VALUE-STATEMENT (432), -REVIEW;
SELINUX-BUILD-RESTORE (433), its review owed; UNIFIED-SYNC-1122 (blocked on 410's paths), ENGINES-PATH-FIX and its
review owed; FINAL-STATE and its fix loop ([`final-state.md`](final-state.md)). M-calls:
`claude/work-ledger:docs/queue/MERGE-ALL-PLAN-report.md` §7. Rows this page asks of PHASE2-PLAN: the ports of 368 and
378, DEFAULTS-TABLE, US-END-TO-END, GATE-ON-UNIFIED, LAB-REMOVE, the audit item 8 listing, and a findings row on the
twelve commits `dd681539d` left (from PR 433's body); and, from the reviews, 424's lock check (m1), a test or the
removal of `--advise-tile-names` (423; the removal recommended, the lever never adopted), and the ingest's encoder at
OpenJPH 0.33.0 (425, "a separate call").
