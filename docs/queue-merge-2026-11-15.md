# Work queue: unification by merges, executed with caution (2026-11-15 to 2026-11-22)

Started 2026-11-15 by the owner, on `docs/queue/MERGE-ALL-PLAN-report.md` (this branch): "we can proceed with that
merge plan … analyze what needs to be done in order to execute it with high cautiousness, because I think it could be
a big source of regressions and any type of them, not only bugs and problems in the code, but also complexity,
unwanted code … You may simply proceed with what you consider best." Times UTC.

## How caution is built in

1. **A baseline before any merge**: every measurable property of today's tips, so a regression is a number, not an
   impression.
2. **Nothing existing is rewritten**: every merge lands on a new staging branch (`claude/merge-a-<line>`, then
   `claude/unified`); the `claude/unified-*` branches and their PRs stay as they are until the owner swaps them.
3. **Every merge commit explains itself**: its message names the source branch and tip, each conflicting file and why
   it was resolved that way (which decision or later commit settles it).
4. **A blind review after each stage**, by a session that merged nothing in it: resolutions against the plan, nothing
   changed that no merge asked for, tests not lost, the gate and the browser checks, the baseline compared.
5. **Complexity is audited, not assumed**: after stage B, an audit of what the merges added (product lines, flags and
   levers, duplicate implementations, dead code) against the baseline; cleaning rows follow from it.
6. **The fix loop** (`docs/queue-client-2026-11-14.md` amendment 17): a review with blockers appends its FIX and
   FIX-REVIEW rows; two rounds at most, then blocked for the owner.
7. **No merge into `main`** in this queue; the last row prepares, the owner merges.

## The owner's calls of the plan's §7, decided by the orchestrator on the owner's word ("proceed with what you consider best"), 2026-11-15; any can be reversed

* **M1**: `git merge -s ours` for each branch of the pre-`mainbase` lineage (history joined, tree unchanged).
  `client/conformance/av1` and the other unplaced `lab/av1` paths stay in that history, recorded in
  `docs/av1/README.md` with the recovery command; not restored.
* **M2**: merged for their rows and text, code resolved to the tip, then cleaning (the plan's §6 item 3); the frame
  clock's removal stays the owner's (item 11).
* **M3**: not merged; the one-queue product build goes to the transport session as a question (its PR stays open).
* **M4**: merged for history, the tip's text where they conflict.
* **M5**: the viewer line stays out (parked); its branches untouched.
* **M6**: merged now: PR 376 (the hidden-page deadline; reviewed, no trade-off) and PR 390 (the optimal-quality ingest,
  off by default, reviewed). Not merged, their PRs stay open: 368 (six review findings open), 370 (the report study
  chooses among candidates), 372, 378 (its review asks for a fix first), 309, 265.
* **M7**: the work ledger stays off the unified branch.
* **M8**: the name `claude/unified`; the four `claude/unified-*` stay until the owner's yes.
* **M9**: `hw-probe` merged after its review (done), in the client sequence after `docs-client`.

## Rows

| row | needs | output |
| --- | --- | --- |
| MERGE-BASELINE | — | `claude/work-ledger:docs/queue/MERGE-BASELINE-report.md` |
| MERGE-INVENTORY-2 | — | `claude/work-ledger:docs/queue/MERGE-INVENTORY-2-report.md` |
| MERGE-A-CODECS | MERGE-BASELINE and MERGE-INVENTORY-2 done | `claude/merge-a-codecs` from `origin/claude/unified-codecs`, draft PR into it |
| MERGE-A-SERVER | the same | `claude/merge-a-server` from `origin/claude/unified-server`, draft PR into it |
| MERGE-A-CLIENT | the same | `claude/merge-a-client` from `origin/claude/unified-client`, draft PR into it |
| MERGE-A-REVIEW-CODECS | MERGE-A-CODECS done | findings in its PR body |
| MERGE-A-REVIEW-SERVER | MERGE-A-SERVER done | findings in its PR body |
| MERGE-A-REVIEW-CLIENT | MERGE-A-CLIENT done | findings in its PR body |
| MERGE-B | every MERGE-A-REVIEW done with no blocker open | `claude/unified` from `origin/claude/merge-a-client`, draft PR into `main` titled "do not merge: review" |
| MERGE-B-REVIEW | MERGE-B done | findings in its PR body |
| COMPLEXITY-AUDIT | MERGE-B-REVIEW done with no blocker open | `claude/work-ledger:docs/queue/COMPLEXITY-AUDIT-report.md` |
| UNIFIED-CLEAN | COMPLEXITY-AUDIT done | `claude/unified` (each cleaning its own commit) |
| UNIFIED-CLEAN-REVIEW | UNIFIED-CLEAN done | findings in the PR body |
| PR-TRIAGE | MERGE-B-REVIEW done with no blocker open | `claude/work-ledger:docs/queue/PR-TRIAGE-report.md` |

At most six rows of this file run at once. No session reviews a row whose commits it wrote.

### MERGE-BASELINE (measure; nothing merged)

On `origin/claude/unified-client`, `unified-codecs`, `unified-server`, `unified-pacs` and `line-hygiene`, each at a
recorded commit: the full `scripts/gate.sh` (README's cloud lines; every skip named) with each suite's test count and
pass count; `demo-check.mjs` in both views on `unified-client`; `cargo build` warnings for the default build;
`scripts/check_lab_absent.sh`; `scripts/comment_budget.sh`; lines of code per top directory of product code
(`server/`, `client/` without `client/native/`, `client/native/`, `ingest/`, `deploy/`, `scripts/`) and of `lab/` and
`docs/`; the count of URL parameters, cargo features and lab levers the product reads; the deploy image's size if it
builds. One table per tip, the commands beside it.

### MERGE-INVENTORY-2 (read only)

The plan read `origin` at 2026-11-14 23:15 UTC. Re-read now: every branch pushed or moved since, classified as the
plan's §2 does, and the plan's order amended for them (tonight's: `docs-client`, `hw-probe`, `hw-decode`, `hw10-routes`,
`link-targets`, `depth8`, `cache-plan`, `cache-arms`, `report-plan`, `report-arms`, `oq-ingest`, `transport-design`,
`phone-protocol`, `native-notes`, and any other). A branch whose queue row is still running is merged in a later pass,
not now; say which. Freeze the list with its tips and the time: stage A merges exactly that list.

### MERGE-A-<LINE> (codecs, server, client; PACS has no merge)

Apply the plan's §3 order for the line to the frozen list, with the decided calls above: each `git merge --no-ff`
on the staging branch, its message as "How caution is built in" item 3 says; after the last merge, the full gate,
`demo-check.mjs` in both views for the client, the baseline's measures again, and a table of the differences. Push
after every few merges. Draft PR into the line's unified branch, its body the merge list, every conflict and its
resolution, the baseline comparison.

### MERGE-A-REVIEW-<LINE>

A session that merged nothing in this line: (a) each resolution read against the plan and the decision it cites;
(b) the tree against the union of the merged branches: no file changed that no merge asked for
(`git diff` of the staging tip against a mechanical re-merge with `-X ours` and `-X theirs` where needed); (c) the
gate, the browser checks and the baseline: a test count lower than the baseline's, or a check that passed and now
fails, is a blocker; (d) the product's absence checks. Blockers start amendment 17's loop.

### MERGE-B

Stage B on `claude/unified` from the reviewed `claude/merge-a-client`: B1 `merge-a-codecs`, B2 `merge-a-server`, B3
`unified-pacs`, B4 `line-hygiene`, each `--no-ff`. **`server/src/server.rs` takes a written resolution** of the three
lines' changes (the plan's §5: `Series`, `ProductPipeline::new`'s fourth argument, `banner.rs`), with a test for each
behaviour it keeps; `series-server` must build and its tests pass. Then the gate, the browser checks, the baseline.
Draft PR into `main` titled "do not merge: review".

### MERGE-B-REVIEW

As the stage A reviews, plus: every behaviour of the three `server.rs` versions present or its removal named; the
deploy image builds.

### COMPLEXITY-AUDIT (read and measure; no edit)

Against the baseline: what the merges added to the **product** (lines per module, new URL parameters, features and
levers, new dependencies), **duplicate implementations** (two runners, two decoders of one job, two names of one
concept), dead code (unreferenced modules, flags no line uses), lab code in product paths, the comment budget, docs that
contradict each other. A ranked list, each item with its proposed cleaning (a commit) and whether it is a removal (the
owner's yes) or a mechanical cleaning (the plan's §6 items 1, 2, 4, 6).

### UNIFIED-CLEAN

The plan's §6 items 1, 2, 4, 5, 6 and the audit's mechanical items, each its own commit, a failing check first where
one exists; removals only where the owner said yes. Then the gate and the browser checks.

### PR-TRIAGE (read only; a list for the owner's yes)

Every open PR (264 on 2026-11-15) against `claude/unified` once MERGE-B-REVIEW passes, in one table: **carried** (its
head is an ancestor of `claude/unified`: close it, saying it landed there), **proposal waiting on a named decision**
(which decision, which line doc or queue row owns it, and whether one of the client queue's open questions decides it:
the mobile decode comparison, the report study, the cache run), **needs a fix first** (which review asked), or
**superseded** (by what). One-screen summary first: the counts per group, then the proposals, each with its decision.
Closing is the owner's; the row closes nothing.

### UNIFIED-CLEAN-REVIEW

A session that wrote none of it: each commit does one thing, nothing behavioural changed except where a commit says
so, the gate green. Then list for the owner the preparation rows for `main` (the plan's §8 item 4).

## Procedure, rules

Each firing follows `docs/queue-2026-11-14.md` §The worker's procedure, §No work lost and §Standing rules, applied to
**this file's rows only**, with these changes: at most six running; no 22:00–06:00 restriction; the queue closes
2026-11-22 23:59. The merges of this file are the owner's word (2026-11-15) for the staging branches named here and
nothing else: no merge into `main`, into any `claude/unified-*` branch, or anywhere this file does not name; never a
force-push. Status files `docs/queue/<ROW>.md` on `claude/work-ledger`; draft PRs through
`mcp__github__create_pull_request`.
