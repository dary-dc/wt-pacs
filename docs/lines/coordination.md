# Coordination

Last verified 2026-11-23 02:10 UTC (§Resume 2026-11-23; earlier: 2026-11-09, branches and PRs read from `origin`); §Open 6 added 2026-11-15, stage A2 and its review the same day.

## Resume 2026-11-23 (read this first; everything below it is older)

A session that coordinates wt-pacs starts here. Everything lives on `origin`; nothing is held only on a machine.

**The plan.** `docs/queue-2026-11-14.md` on this branch: its **Amendment 27** (the rest of the program by 2026-11-23
23:59; six rows at once; Fable one at a time; scope breast US and DBT, stacks first, no row dropped; FINAL-STATE;
VALUE-STATEMENT) and **Amendment 28** (the owner's yes of 2026-11-22: reviewed PRs merge into `claude/unified`
without a word, gate green, never `main`; recommended measurements run; **phase 2, 2026-11-24 to 11-27, toward the
evaluation release**, written by PHASE2-PLAN on 11-23 into `docs/queue-2026-11-24.md`; and every owner word of the
evening, quoted: transport stays a main investment, the HTJ2K fit control arm, the cache as which store, budgets as
ranges, limitations with how found, improvement rounds, the view's memory bound, the device kit kept, hardware-decoded
view frames shown unchecked with the mark describing the view).
2026-11-24: the phase 2 file reviewed (three blockers) and fixed in place by PHASE2-PLAN-FIX: staging merges
into `claude/phone-run` for the next phone round, DEFAULTS-TABLE and US-END-TO-END into `claude/unified`, S5 held;
its re-review is PHASE2-PLAN-FIX-REVIEW.
2026-11-24: PHASE2-PLAN-FIX-REVIEW: B2, B3, m1–m4 closed; B1 open in part (PR 436's base is `claude/phone-run`,
so the staging merge would mark it merged): PHASE2-PLAN-FIX-2 moves the round's code to `claude/phone-run-2`.

**The routines** (claude.ai routines; their prompts switch from the program to phase 2 on 11-24 00:00 and close
after 11-27 23:59): queue workers (Opus) A `trig_01Y6vNmyv6K54Uqcs8RXV1Gu` at :45, B `trig_014L1Sgp7h8TW8qnzWMZ1HEQ`
at :05, C `trig_01Ax5o7S1Su75LUsYrg99mgu` at :25; Fable worker `trig_01YLsjSbhwbThdUxmqydUve2` at :20; CACHE-DESIGN
(Fable with subagents) `trig_01J8qVddPdmn495MrJuiJXXo`, once on 2026-11-24 00:30 (disable it after). One-offs that
ran: PHONE-TONIGHT, RESULTS-BRIEF, PHONE-READ-3D (`trig_01Hm8kXPmbo3K4Nj7pi7dou1`, started 01:52). A routine fires at
most hourly; a one-off has an empty cron and is started with `run`.

**The phone, 2026-11-22** (Samsung-class Android phone, Chrome; local session; records on this branch
`docs/queue/PHONE-ROUND.md`, `PHONE-ROUND-3C.md`, `PHONE-ROUND-3D.md`; raw rows on `claude/phone-run` under
`docs/phone-rows/raw/2026-11-22*/`): cells 1, 2 and 4 complete (cell 2 biased by the memory carry-over); cell 3 complete
in 3D (48 loads, a fresh Chrome per load, the lab-only beacon fix `f5252051`, follow-up `86a8a350`). Read: PHONE-READ
(main round) done; PHONE-READ-CODE-CHECK and PHONE-READ-3D (cell 3: **which view won, page or worker**) owed.
Found and queued as bugs, each with test and review: MEMORY-LEAK-TRACE (a renderer kept each same-origin load's
memory; test the SharedArrayBuffer accounting first), VIEW-MEMORY-BOUND (256 MiB a tab, our number), BEACON-LOSS
(the end batch over the beacon quota; the product's report paths too), STALE-CODE (Chrome ran cached older code),
DEVICEKIT-TOOLS (the session tools into `lab/devices`). PHONE-ROUND-2 (cell 3 needs no rerun now; what the pages ask
of a phone, with the fixes) on the owner's next evening; its preparation is PHASE2-PLAN's. The built worktree for it:
`~/Desktop/projects/wt-pacs-phone-962` on `claude/phone-run` (clean; node and openssl through containers, its
`PHONE-TONIGHT` and `TONIGHT.md` say how).

**Results.** `claude/reviews-2026-11-28:docs/reviews/results-2026-11-22.md` (RESULTS-BRIEF, every result with how
found and limits, §9 refuted, §10 unknown). Bugs it named, queued: FAILED-FRAME-WITHHELD (§8.1, a failed frame
leaves the previous slice on screen), READMIN-RESTORE (§4.2, a fix lost in a merge). Decision pages:
`claude/reviews-2026-11-28:docs/decisions/` (FINAL-STATE: *bench-verified* the state, *evaluation release* the name).

**Owed to the owner** (weekend 2026-11-28/29, ~21-01 UTC): the brief with one table of every yes/no; the merge words for
`claude/eval-release` into `main`; the second phone round. **Open, no owner word needed:** UNIFIED-SYNC-1122 blocked
on a personal path in PR 410's log (ENGINES-PATH-FIX appended); the delivery rig's relay should get its own CPU core so
decode cannot void the loads (RESULTS-BRIEF §1.12; for DELIVERY-PAGE, not mid-run).

## Goal

Get finished, reviewed work from the lines into `main`, keep `main` deployment-ready, and keep the branch and PR set
small enough that every open item has an owner and a next step.

## State now (2026-11-09)

* `main` is at #319 (`patch_crate.sh` with `git apply`); before it, #184 (rustls 0.23.46, rustls-webpki 0.103.16,
  tokio 1.53.3 for RustSec advisories, 2026-10-26).
* About 230 remote branches and about 190 open PRs, nearly all drafts. The full table, with a proposed action per
  branch, is `docs/inventory-2026-11-09.md` on `claude/repo-inventory` (temporary, no PR; it is removed once the
  owner has decided).
* `claude/av1-unified-mainbase` is the de-facto integration branch: 62 commits ahead of `main`, 3 behind; 65 open PRs
  target it. Its product change is small (`client/decode/av1*.js`: one-pass merge on by default, a signed 8-bit range
  fix; two `ingest/` fixes); the rest is `lab/av1` and `docs/`.
* On 2026-10-30 the drafts were folded into one branch per line: `claude/core` (#250, client and native),
  `claude/line-server` (#254), `claude/line-hygiene` (#256), `claude/line-pacs` (#258, not for merge yet),
  `claude/line-viewer` (#255, parked). Most older drafts are carried by one of these and need closing, not review.
* **CI `deploy` fails on `claude/core`**: the root `Cargo.toml` lists `claude/core:client/native`, which
  `deploy/Containerfile` does not copy. `main` would stop being deployment-ready if `core` merged as it is.
* 89 open PR bodies carry a "Generated with/by" line and a session link, and many commits a Co-Authored-By trailer
  (listed in the inventory). New work must not add either (`CLAUDE.md` §Agents).

## Open (ordered)

1. The owner decides the inventory's proposed actions (merge, keep, archive, delete, close).
2. The demo path into `main` by 2026-11-13 ([`optimal-quality.md`](optimal-quality.md)), each step reviewed by a
   session that did not write it, gate and CI green:
   fix `core`'s image build → #289 into `core`, then #299, then #302 rebased → `av1-unified-mainbase` into `core`
   (resolving the four `client/decode/av1*` files once, instead of #303) and `main`'s newer commits → the demo
   branches → one approving review of #250 → merge with `--no-ff`.
3. The proposed order into `main` after that: `av1-unified-mainbase` ← `line-hygiene` ← `line-server` ← `core` ←
   `line-pacs`; `line-viewer` stays parked.
4. Where the archive index lives (33 `archive/*` tags exist, no index file on `main`; `docs/archive.md` is a candidate).
5. Strip "Generated by" lines from the PR bodies listed in the inventory; trailers stay in history unless the owner
   approves a rewrite.
6. The unification by merges (`docs/queue-merge-2026-11-15.md`): stage A merges exactly the frozen list of
   `docs/queue/MERGE-INVENTORY-2-report.md` §4 (2026-11-15 12:53 UTC); its §2 names one owner question (viewer commits
   riding in with `cine-no-skip`). The baseline every stage compares against: `docs/queue/MERGE-BASELINE-report.md`
   (2026-11-15; five tips, every gate OK, `unified-pacs` on its fourth attempt; a cargo target dir per worktree).
   Stage A2 (row MERGE-A-SERVER, 2026-11-15): `claude/merge-a-server` holds the server line's 11 branches merged into
   `claude/unified-server` (five by `-s ours`, call M1), the gate green, no test count lower; the product gains the
   two lab levers of `scroll-policies` (behind `lab-levers`), its downloader lab config, and `deploy-dry-run`'s page
   without a transport file. Its blind review (MERGE-A-REVIEW-SERVER, 2026-11-15, in PR 399's body): no blocker.
   Next: stage B once the client review is done with no blocker open.
9. **The two weeks' program** (`claude/work-ledger:docs/queue-2026-11-14.md`, PROGRAM-PLAN, 2026-11-19): its
   review (PROGRAM-PLAN-REVIEW, 2026-11-19, §Program review there) found four blockers, the first that no worker
   takes its rows; PROGRAM-PLAN-FIX (2026-11-19) closed the four in place and its minors (§Program review, *Fixed*):
   the client queue's worker now takes the program's rows when none of its own is due. PROGRAM-PLAN-FIX-REVIEW
   (2026-11-19, §Program review §Re-review) found each blocker closed and none open, two nits: the program runs.

## Unification (the owner, 2026-11-09)

Every build adds code paths, tests and terms; before the owner steps back from steering, the repository is unified so
that unsupervised work starts from one clear state. For the sessions that take it on, in order:

1. Decide the inventory line by line (§Open 1), then archive or delete what it settles (`archive/<name>` tag plus one
   index line).
2. One path into `main` (§Open 2–3), each merge reviewed by a session that did not write it; nothing else merges.
3. One name per concept: reconcile `docs/glossary.md` across the merged branches (e.g. *exact series*, *optimal
   quality*, *pairing*, *lossy series*), and rename in code where two names mean one thing.
4. One implementation per job: where two branches or two clients do the same work, keep one and record the other's
   removal; experiment flags that no line still uses leave `main`; lab code stays on its line branch.
5. Every line file in `docs/lines/` reflects the unified state; stale lines say so.

## Decisions (the owner's)

* 2026-10-03: push any branch but `main`; never force-push or rewrite pushed history.
* 2026-10-07: an independent product, fully MIT; author `dary-dc <crespoydelgado@gmail.com>`, no trailers.
* 2026-10-14: a work branch takes finished work only. 2026-10-17: every merge needs the owner's explicit word per PR.
* 2026-10-18: direction, not destination: designs show what decides each choice and stay switchable; test-only code
  stays out of product functions.
* 2026-10-28: wt-pacs's choices are the owner's; the PCS's are its team's, so the two may differ by design (XXH3
  here, BLAKE3 at the PCS).
* 2026-11-04: experiments live in a line branch while still used; `main` is deployment-ready only; a dropped
  experiment becomes an `archive/<name>` tag and one index line.
* 2026-11-09: nothing reaches `main` without review; the demo is built on `claude/core`.

## Pointers

`CLAUDE.md`, `README.md`, `scripts/gate.sh`; `claude/repo-inventory:docs/inventory-2026-11-09.md`; the line branches
above; `docs/merge-readiness.md`.
