# Repository: housekeeping calls outside the product

Written 2026-11-22 by row REPOSITORY-PAGE (`claude/work-ledger:docs/queue-2026-11-14.md`, inventory row 22), from
pushed results and read-only GitHub queries; nothing run, nothing closed or edited. Inputs at: `origin/claude/unified`
`4a2b4277` ([`../lines/coordination.md`](../lines/coordination.md) §Open 4 and 6, [`../reviews/dataset-hub.md`](../reviews/dataset-hub.md),
[`../reviews-2026-11-10.md`](../reviews-2026-11-10.md) §2 F1, `README.md` §Map); `claude/work-ledger` `0e927733`
(`docs/queue/AGENTS-DOCS.md`, `AGENTS-DOCS-REVIEW.md`, `PR-TIDY.md`, `LATER-PASS.md`, `DOCS-SYNC-1119.md`,
`PR-TRIAGE-report.md` and `PR-TRIAGE/prs.tsv`, `MERGE-ALL-PLAN-report.md` §7 M7); PR 404's body; the repository's
tags and open PRs as GitHub returned them on 2026-11-22 at about 19:30 UTC.

## 1 · The question

Six calls about the repository itself, none of which changes what the server or the client does: where the agents'
rules live (`docs/agents/`, PR 404, BRIEF-WED B9); where the archive index lives; the "Requested by … project thread"
lines in old PR bodies; the dataset hub and who uploads to it; what becomes of the work ledger (M7); and the two
routines left `started` since 2026-11-18, PR-TIDY and LATER-PASS. Each is the owner's because it either changes the
file every session loads, edits public text, needs a credential only the owner can issue, or closes PRs.

## 2 · The recommendation, and the owner's yes or no

**Accept `docs/agents/` with the three git lines kept in `CLAUDE.md` (option b) after one fix row; let the tags be
the archive index, with one line in `README.md`; strip the "Requested by" lines from every PR body that has one;
adopt release assets as the dataset hub only after a two-host digest check, uploaded by a session holding a token
the owner issues; keep the work ledger a branch that never merges; close LATER-PASS as done by DOCS-SYNC-1119 and
resume PR-TIDY's closes after re-verifying them.**

| # | the owner's yes or no | recommended | a yes changes | a no leaves |
| ---: | --- | --- | --- | --- |
| 1 | `docs/agents/` is the one home of the agents' rules, with the author, no-trailer and no-session-link lines kept in `CLAUDE.md` §Agents beside the pointer (option b of PR 404's review) | **yes** | one Opus row in phase 2: PR 404 brought onto today's `claude/unified` (`--no-ff`; it conflicts, §4), option b and the review's minors 1–6 applied, retitled without "do not merge", reviewed; then a sync row merges it (amendment 28 rule 1); the queue files point to it as PR 404's body lists | the rules stay in `CLAUDE.md` and each queue file's §Standing rules, as today; PR 404 stays an open draft |
| 2 | The archive index is the tags themselves: `README.md` §Map gets one line with the command that lists every `archive/*` tag and its message, and names the five tags that carry none | **yes** | one line in `README.md` (docs-only row, phase 2); coordination §Open 4 closes; no `docs/archive.md` | §Open 4 stays open; an index file would be a second record of what the tags already say |
| 3 | The "Requested by … project thread" line is removed from every PR body that has one (21 by GitHub's search, §3), each body otherwise byte for byte, by one row with a written list; the edit history's old revision deleted by hand | **yes** | one row edits 21 PR bodies (no comment, no close); the owner deletes each body's old revision in the web page (§5), or accepts that the history keeps it | a first name and a private link stay in public PR bodies, against amendment 23's "the owner's first name out of public files, yes" in spirit (a PR body is not a file) |
| 4 | The dataset hub: release assets on this repository (option A of `dataset-hub.md` §2), keyed by recipe, adopted only after the same bundle digests come out on two hosts; uploads by a cloud session holding a write token the owner stores once as a network secret | **yes, in that order** | first one cloud row runs `scripts/demo-series.sh` on two cloud hosts and compares every bundle's SHA-256 (§6); on 23 of 23 equal, one row builds the pin file and the fetch; the owner issues one token | every session codes the demo series again, ~11 minutes of 4 cores and a tool build each (**measured**, `dataset-hub.md` §0) |
| 5 | M7: `claude/work-ledger` stays a branch of its own, never merged into `claude/unified` or `main`, never deleted | **yes** | nothing (amendment 28 rule 1 already excludes it from every sync) | it is merged for history at the end: 783+ commits of queues and status files enter the product's history |
| 6 | LATER-PASS's status file is set `done` with a pointer to DOCS-SYNC-1119, which redid its four merges; PR-TIDY resumes as a phase 2 row that first re-verifies each remaining PR as carried by today's `claude/unified`, then closes it with its comment, under amendment 26's standing yes | **yes** | two ledger edits and one Opus row; 57 carried and 7 superseded PRs closed (§3), the four staging PRs left to M8 | 64 PRs stay open that triage found carried or superseded; two status files keep reading as stalled to every worker |

**How it serves the value statement** (amendment 27 item 7; VALUE-STATEMENT is not yet done, so its draft text in
the program is used): the statement promises "one small MIT-licensed server". Items 1, 2, 5 and 6 keep the public
repository that ships it small and legible (one home per rule, one index, a ledger outside the product's history,
an open-PR list that is the work in flight); item 3 keeps a public, licensed repository free of a private name;
item 4 lowers the cost of the measurements that back the statement's "fast" and "lowest cost" claims, not the
product's.

## 3 · The options

| call | options | the numbers |
| --- | --- | --- |
| 1 `docs/agents/` | (a) PR 404 as proposed: `CLAUDE.md` §Agents one pointer line; (b) the pointer plus the three git lines (rec.); (c) no `docs/agents/` | PR 404: 5 files, +152 −11, 3 commits, base `71c4a720`, GitHub's `mergeable_state` "dirty" against `claude/unified` (**measured**, 2026-11-22); its review: no blocker, six minors (**measured**, PR 404 §AGENTS-DOCS-REVIEW) |
| 2 archive index | (a) the tags as the index, one `README.md` line (rec.); (b) `docs/archive.md`, one line a tag; (c) nothing | 34 `archive/*` tags on `origin`, 29 annotated with a message saying what and why, 5 lightweight with none (`arms-2026-10-03`, `backup/w1-preclean`, `claude/disk-access-adr-validation-saz6m8`, `cursor/l1-loss-run-dbae`, `feat/set-priority-per-frame`) (**measured**, `git ls-remote`, `git for-each-ref`); coordination §Open 4 says 33 (written before one more tag) |
| 3 "Requested by" | (a) strip every body (rec.); (b) strip the six FOOTERS-CHECK named (#39, #40, #41, #96, #102, #103); (c) leave | 21 PRs match "project thread" in GitHub's search, 3 open (39, 40, 96), 18 closed, the six among them (**measured**, `search/issues`, 2026-11-22); six body edits was FOOTERS-CHECK's count (**source**, `reviews-2026-11-10.md` §2 F1) |
| 4 dataset hub | A release assets (rec.), B Git LFS, C container registry, D Zenodo, E a model hub, F a paid bucket, G none (today) | A: "Each file included in a release must be under 2 GiB. There is no limit on the total size of a release, nor bandwidth usage." (**source**, [R1] of `dataset-hub.md`); B: 10 GiB of bandwidth a month ≈ 27 full fetches of 368 MB (**derived**, §2 there); largest bundle 107.4 MB (**measured**); recoding 637 s and 689 s on 4 cores (**measured**, MEASURE-1, E2E-3) |
| 5 work ledger | (a) a branch, never merged (rec.); (b) merged for history at the end; (c) an `archive/` tag at the queue's close | 783 commits at MERGE-ALL-PLAN (2026-11-15), more since (**measured** then); every file under `docs/`, so the docs-only test alone would admit it (PROGRAM-PLAN-REVIEW B2) |
| 6 PR-TIDY, LATER-PASS | (a) LATER-PASS `done` by pointer, PR-TIDY resumed after re-verification (rec.); (b) both left as they are; (c) PR-TIDY resumed from its Resume as written | PR-TIDY's file: 150 closed, the last 289, heartbeat 2026-11-18 01:12; GitHub today: of the 237 carried, 57 open (327–393, with 388, 389, 391 which PR-TIDY left open as moved past the tip), so 180 are closed; the 7 superseded and the 4 staging PRs all open; 118 PRs open in all, 29 of them from 403 up (**measured**, 2026-11-22). LATER-PASS: 384, 392, 359, 396 merged locally, never pushed; DOCS-SYNC-1119 redid those four merges and pushed them (**source**, its status file, coordination §Open 8) |

## 4 · Where it holds

**Fixtures and limits.** No fixture: the evidence is the repository's own state, read once on 2026-11-22 about 19:30
UTC, and the counts move with every row. GitHub's issue search is an index, not the store: a body edited since may
not be re-indexed, so the 21 is a search count, to be re-read by the row that edits (limitation found here, by the
gap between FOOTERS-CHECK's six and the search's 21). PR 404's conflict is GitHub's `mergeable_state`, not a test
merge (not run here). The 180 closed carried PRs are more than PR-TIDY's file says (150): the file was not updated
after its last close, or another session closed the rest; which is not known (found here, by comparing the file with
GitHub's open list).

**The population.** These calls hold for this repository on GitHub, as of the sources' dates; nothing here carries
to devices, engines or links. **US and DBT stacks** (amendment 27 item 6): the calls do not depend on modality, with
one exception: a hub keyed by recipe (item 4) carries breast ultrasound sets the day a US source is pinned in
`lab/av1/data.json` (**theory**: the key names the source, not a modality); there is no US cine fixture today.

## 5 · The mechanism

* **One home per rule** (`CLAUDE.md` §Names, one concept one name, applied to rules): a rule in two places drifts;
  a rule only in a file a session must choose to open is not read. `CLAUDE.md` is the file every session loads, and a
  cloud session's own prompt asks for a trailer and a session link, so the three git lines must stay where they are
  loaded (PR 404's review, the owner's call).
* **A tag already carries its reason**: an annotated tag's message is a record kept beside the commit it names; a
  file listing the same is a second thing to keep true. Five tags have no message and cannot gain one without
  replacing the tag, which the standing rules forbid, so only those five need a line.
* **An edit does not erase**: "Anyone with read access to a repository can view a comment's edit history"; "Comment
  authors and anyone with write access to a repository can delete sensitive information from a comment's edit
  history" (**source**, GitHub Docs, *Tracking changes in a comment*, fetched 2026-11-22, docs.github.com, no
  revision number published). The deletion is a step in the web page; no API for it was found here (not searched
  exhaustively), so it is the owner's hands, or the old revision stays.
* **The hub's integrity is the pin, not the host**: a fetched file whose SHA-256 differs from the pin is refused, so
  the host may be mutable; only availability depends on it. Whether the pin can be checked by recoding depends on
  the same bytes on two hosts, which is assumed, not shown (`dataset-hub.md` §1).
* **A status file left `started` is read as stalled by every worker** (procedure step 2), and a worker picks stalled
  rows first; neither routine is a row of the program's tables, which is the only reason they have not been
  re-taken.

## 6 · What would change the recommendation

* Item 1: if the owner prefers the rules to stay only in `CLAUDE.md` and the queue files (the program's last day is
  2026-11-27 and the queues close then), (c) costs nothing now; the measurement is none, it is a preference.
* Item 4: one bundle of the 23 with a different SHA-256 on a second host makes recoding useless as a check; the hub
  then rests on the pin alone (still A), and the two-host row names the first bundle that differs. Deciding
  measurement: `scripts/demo-series.sh` on two cloud hosts of different CPU models, SHA-256 of every bundle compared.
* Item 6: a PR among the 57 that is no longer carried by today's `claude/unified` (its patches not on the tip) stays
  open and goes to UNIFIED-PAGE; the re-verification is PR-TRIAGE's `triage.sh` against the current tip.
* Item 3: if the owner judges a first name in a closed PR's body harmless, (b) or (c).

## 7 · What it would reopen

Nothing among the program's §Decided approaches. Item 6 acts under amendment 26's standing yes ("yes. U may delete
once it's on main. No need my yes", and the closes of the triaged PRs), which the current standing rules ("No close
of a PR … without the owner's yes") narrow to the rows the owner names: the owner's yes to item 6 names PR-TIDY's row.

## 8 · Rows and links

AGENTS-DOCS and AGENTS-DOCS-REVIEW (PR 404, `claude/agents-docs` `9e551129`); BRIEF-WED §3 B9
(`claude/reviews-2026-11-18:docs/reviews-2026-11-18.md`); FOOTERS-CHECK ([`../reviews-2026-11-10.md`](../reviews-2026-11-10.md)
§2 F1, Q5); DATASET-HUB ([`../reviews/dataset-hub.md`](../reviews/dataset-hub.md), `docs/lines/codecs.md` §Open 12);
MERGE-ALL-PLAN §7 M7 and M8; PR-TRIAGE (`claude/work-ledger:docs/queue/PR-TRIAGE-report.md`), PR-TIDY, LATER-PASS,
DOCS-SYNC-1119 (their status files on `claude/work-ledger`); client queue amendments 23 and 26; amendment 28 rule 1
of the program; [`../lines/coordination.md`](../lines/coordination.md) §Open 4, 6 and 8.
