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

Read `CLAUDE.md`, [`README.md`](README.md), then `queue.md`: §Protocol, the table, §Blocked. A row's status is the
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
* From a session with the `RemoteTrigger` tool: `RemoteTrigger run trig_01Gr7ihaiQMUhPT9YNv4Ps8r`, once per row. Without
  it, the owner presses *Run* on the routine's page at claude.ai, once per row.
* Many parallel sessions share one usage window; if a limit cuts them, stale claims are reset (§1) and fired again.
* The routine's prompt names the only branches a session may push (`claude/av1-mainbase`,
  `claude/av1-unified-mainbase`) and forbids force-push and branch deletion. Change it only with the owner.

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
