state: done
started: 
heartbeat: 2026-11-18T08:20Z
outputs: claude/agents-docs b8b3fc09 (docs/agents/), 86070c7c (coordination Open 9); draft PR 404 into claude/unified
## Resume
Done. Nothing left for this row; AGENTS-DOCS-REVIEW is next (a session that wrote none of it).
## Result
docs/agents/ in three files: README.md (every agent: lines, git, branches/PRs/merges, public repo, claims and data,
where work runs, before pushing), queue.md (worker procedure, status file, no work lost, a brief that changes, models),
reviews.md (who does what, the fix loop). CLAUDE.md §Agents is one line: "Read docs/agents/ before any work."
Rules already in CLAUDE.md are not repeated. No queue file changed. PR 404's body quotes each rule's source and date,
lists the wording that differs from queue-2026-11-14.md (steps 1, 3, 4, 7, the heartbeat field), what stays in each
queue file, and what each queue file would point to once accepted. check_links and comment_budget green; docs only,
gate not run.
Owner decision: accept docs/agents/ as the one home (merge PR 404 after its review), then the queue files point to it.
