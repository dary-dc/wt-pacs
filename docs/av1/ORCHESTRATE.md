# Orchestrating the queue

For a session — cloud or local — that plans, dispatches and checks the work in [`queue.md`](queue.md). The
orchestrator does no lane itself: rows do the work, in their own sessions. Start a cloud orchestrator on
`dary-dc/wt-pacs`, branch `claude/av1-mainbase`, and tell it to read this file.

```
 owner ──► orchestrator ──► queue.md (claude/av1-mainbase) ──► one session per ready row
              ▲                                                     │
              └──────── verify the row, report to the owner ◄───────┘  work lands on claude/av1-unified-mainbase
```

## 1 · Start

```bash
git fetch origin && git checkout claude/av1-mainbase && git pull --rebase origin claude/av1-mainbase
git config user.name "dary-dc" && git config user.email "crespoydelgado@gmail.com"
```

Read `CLAUDE.md`, [`README.md`](README.md), the latest handoff here ([`handoff-2026-10-13.md`](handoff-2026-10-13.md)), then `queue.md`: §Protocol, the table, §Blocked. A row's status is the
last cell of its table line; every row not done:

```bash
grep -E '^\| [0-9]+ ' docs/av1/queue.md | grep -v '| done' | cut -c1-160
```

A row `claimed` more than 6 hours ago with no commit from its lane is stale: set it back to `ready` in its own commit
with a line under §Blocked.

## 2 · Add a row

* **One question per row.** Two questions are two rows.
* **Theory first.** A row that will decide by measurement starts as a theory row that writes the mechanism, the
  predictions, the protocol and a decision rule; the measurement is a second row, `after` it, given only that
  protocol (§Protocol).
* **At each option's tuned best**, never its defaults; defaults only as what would have to change.
* **Every number traceable** at its point of use: file:line at a pinned tag, or spec / paper section, table or figure;
  or its derivation. Measured results apart, named with their row.
* **No claim restricted to an assumed band** (rates, RTTs) unless the band is named as an assumption.
* **The owner's words go in the brief** with the date ("the owner, 2026-10-12: …"); a ruling also goes under
  §Blocked as *Resolved* or *Owner rulings*.
* **Shape:** a table line after the last row (`| N | **NAME** — the question | ready |` or `| after M |`), and a
  `### N NAME` brief above `## Blocked` ending in **Deliverable** (the file) and **Branch**
  (`claude/av1-unified-mainbase`).

Commit the queue change alone, message = the change, no trailers; push to `claude/av1-mainbase`.

## 3 · Dispatch

The routine **"wt-pacs AV1 night worker"** (`trig_01Gr7ihaiQMUhPT9YNv4Ps8r`, disabled, fired by hand) starts a session
that works the queue by §Protocol: it takes the topmost ready row, claims it, does it, flips `after` rows, repeats.

* Fire **one run per ready row**, no more; a row `after` another is taken by the session that finishes the first.
* The routine was made through the API, so an agent cannot fire it (`fire_trigger` refuses it); the owner presses *Run*
  on its page at claude.ai, once per row. A cloud orchestrator instead starts one session per row with
  `create_session` on `claude/av1-mainbase`, its prompt the routine's own word for word (`get_trigger` reads it).
* **Spread the rows over usage windows:** a session takes the next `ready` row when it finishes, so only one window's
  rows are `ready` at a time; the orchestrator queues and starts the next window's when it comes.
* Many parallel sessions share one usage window; if a limit cuts them, stale claims are reset (§1) and fired again.
* The routine's prompt names the only branches a session may push (`claude/av1-mainbase`,
  `claude/av1-unified-mainbase`) and forbids force-push and branch deletion. Change it only with the owner.

**The worker prompt** (the routine's, with the owner's 2026-10-14 branch rule): start workers with exactly this text,
and update the stored routine's prompt to it only with the owner's yes.

```text
You are a cloud agent for this repository (wt-pacs), working the AV1 queue as the NIGHT routine. Run `git fetch origin && git checkout claude/av1-mainbase && git pull --rebase origin claude/av1-mainbase` — that branch carries the AV1 queue; do the queue's bookkeeping on it. The work itself happens on a branch of its own per row, `claude/wip-<row>-<NAME>`, made from `claude/av1-unified-mainbase`, and reaches `claude/av1-unified-mainbase` only finished — every check passed and the gate green — rebased and pushed as a fast-forward (§Protocol, step 4); that branch is for finished work only. A row that removes or alters what exists — a simplification, removal, rename or move, refactor, changed default or behaviour, format, wire or store change, or a deleted or weakened test — never lands itself: it finishes on its wip branch with the gate green and sets its cell to `review — <branch> <hash>: <what changed, what it removes, the capability kept>` for the owner (§The work branch holds finished work only). Wherever a row's brief names `claude/av1` read `claude/av1-mainbase`, and wherever it names `claude/av1-unified` read `claude/av1-unified-mainbase`; the old branches are unused — never commit to, push to or base work on them. **Commit identity: the developer is the author.** In every clone or worktree you commit from, first run `git config user.name "dary-dc" && git config user.email "crespoydelgado@gmail.com"`, and after your first commit check that `git log -1 --format='%an <%ae>'` prints exactly `dary-dc <crespoydelgado@gmail.com>` for author and committer (if an environment variable overrides it, unset GIT_AUTHOR_*/GIT_COMMITTER_* or pass `--author`); never commit under any other identity. Push ONLY to `claude/av1-mainbase`, `claude/av1-unified-mainbase` and your row's own `claude/wip-<row>-<NAME>`. Never push to main or any other branch, never force-push, never delete a branch, and never edit docs/cloud-queue.md — other agents own it. Read CLAUDE.md, then docs/av1/README.md, then docs/av1/queue.md: §Protocol first, then the table and the brief of the row you take. You are the night routine: treat rows marked `night` exactly as `ready`. Follow the protocol exactly: take the TOPMOST row marked `ready` or `night`, claim it in its own commit and push (if the push is rejected, rebase and take the next one — other sessions work this queue at the same time), do the lane on its wip branch, push there early and often (at least after each verified step) so that a usage limit never loses it, land it finished on `claude/av1-unified-mainbase`, mark it done with the hash after the rebase that pushed it, a one-line verdict with numbers, and flip any `after …` row whose prerequisites are all done; push; repeat until no row is `ready` or `night`. A row cut short keeps its wip branch and a provisional line in its cell naming it. Rows marked `claimed` belong to other agents — never take them; a row claimed more than 6 hours ago with no commit from its lane since is stale: set it back to `night` in its own commit with a one-line note under `## Blocked`, then take it and continue from its wip branch. Bit-exact against the encoder's input, always; mutate every new test or check and watch it fail; interleave timed arms with lab/order.mjs or lab/scripts/order.py; pin every tool and checksum anything fetched; commit no fetched data or built binaries. Keep scripts/gate.sh green; HTJ2K keeps working unchanged. Commit messages carry the change only — no attribution, co-author or session trailers, no generated-with footers. This repository is public: follow §Protocol's naming rule — never name the private comparison stack it describes; open-source projects, vendors and standards are named and cited as sources like any other. If a row is blocked on a decision only the owner can make, add it under `## Blocked` in docs/av1/queue.md, push, and move on. When none is left, stop at once and end with a short list: each row you did, its commit, its verdict with numbers (or 'nothing left').
```

For each `review` row, open a draft pull request from its wip branch into `claude/av1-unified-mainbase` with the
cell's summary, and land it only on the owner's word.

## 4 · Verify a finished row

* Its cell says `done` with a hash, a one-line verdict with numbers, and where the finding lives.
* Every commit is `dary-dc <crespoydelgado@gmail.com>`, author and committer:
  `git log --format='%an <%ae>|%cn <%ce>' origin/main..origin/claude/av1-unified-mainbase | sort | uniq -c`.
* `claude/av1-unified-mainbase` is still a fast-forward of `main`:
  `git merge-base --is-ancestor origin/main origin/claude/av1-unified-mainbase`.
* Read the deliverable's summary against the brief: the question answered, the rules kept (tuned best, sources,
  theory apart from measurement). A check the row skipped is named as skipped, never as passed.

## 5 · Report to the owner

In prose, simple words, keeping the mechanism, when it applies, the numbers and the cost — the owner learning is a goal.
One message per decision, explained before it is asked, never as a form. Results that regress nothing are adopted;
trade-offs go to the owner.

## 6 · What a cloud orchestrator cannot do

It sees only this repository. The owner's local notes and any private project stay with a local session; this
repository is public, so nothing here names them (the term scanner in `.local/hooks`, where installed, refuses it).
