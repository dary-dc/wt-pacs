# Working a queue

A queue is a file on `claude/work-ledger` whose table lists rows: each a unit of work with a not-before time (UTC),
its needs, its output and a brief. Its §Procedure says which of the steps below it changes (how many rows may run,
when it closes, its base branch).

## Each firing

1. `git fetch origin --prune`. After the queue's closing date, write nothing and end with "queue closed".
2. Read every status file `docs/queue/<ROW>.md` on `origin/claude/work-ledger` for the queue's rows. A row is
   **running** when `started` with a `heartbeat` under 60 minutes old; **stalled** when `started` and older; **done**
   or **blocked** as written.
3. If the queue's limit of running rows is reached, end with "busy: <rows>". A session started for one named row
   takes that row only.
4. Pick the first stalled row in the table, or else the first with no status file whose not-before has passed,
   whose needs are met and whose inputs have not moved for 20 minutes, rows appended later included. Never a row
   marked for another worker, model or session, and never a review of a row your session wrote. Nothing to pick:
   end with "nothing due" and the next row's not-before.
5. **Claim it**: write `docs/queue/<ROW>.md` (below) with `state: started` on `claude/work-ledger`, commit,
   `git pull --rebase`, push. If the rebase shows the file already changed by someone else, drop the claim and go
   back to step 4 once.
6. Do the row by its brief. A stalled row is a **resume**: read its Resume and its output branch, continue from what
   is pushed, never redo pushed work.
7. Finish: `state: done`, or `blocked` with why; its outputs; a result of at most 15 lines, owner decisions last.
   Update the row's line doc on the output branch. Push. End with a chat message under 200 words.

## The status file

```
state: started | done | blocked
started: <UTC>
heartbeat: <UTC, from `date -u`>
outputs: <branch, commit, PR number>
## Resume
<done so far, next step, the exact commands>
## Result
<at most 15 lines; owner decisions last>
```

## No work lost

* Commit and push to the output branch after every step that produced anything; never hold more than about 20
  minutes of unpushed work. A measurement pushes its raw rows as they land.
* After each push, update the status file's `heartbeat` and Resume and push it. Before anything long (a build, a
  measurement, a big review), write the Resume first.
* When you sense the end (context, usage, a time limit), start nothing new: push, write the Resume, set `heartbeat`.
* Subagents push their own work the same way before they return.

## A brief that changes

At each push and heartbeat, fetch the queue file again and re-read your row's brief and the queue's amendments. If
either changed since you started, follow the new text from that point, keep what is pushed as input, and say so in
the Resume. Before changing the brief of a `started` row, the orchestrator names the running session in the
amendment and gives the owner its link.

## Which model takes a row

A row says its model in its name, "(Fable)"; every other row is Opus. Fable creates options and questions premises
from the fundamentals. Opus works out one known option per instance (its sources, its arithmetic, its best case as
its advocate), writes protocols, builds, runs and reviews. A synthesis row compares the options; another session
reviews it.
