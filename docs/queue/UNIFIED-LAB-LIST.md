state: done
started: 2026-11-20T16:46Z
heartbeat: 2026-11-20T16:53Z
outputs: `claude/reviews-2026-11-28` at `ff40bdbd` (`docs/decisions/lab-list.md`; `docs/decisions/README.md`'s inputs line; `docs/lines/coordination.md` §Open 8); the scripts in `docs/queue/UNIFIED-LAB-LIST/` here; no PR (the page branch's PR 405)
## Resume
Done. Next: UNIFIED-PAGE (not before 11-25 12:00) carries the list's yes. To redo the counts:
`git worktree add --detach /tmp/u origin/claude/unified && python3 docs/queue/UNIFIED-LAB-LIST/counts.py /tmp/u && python3 docs/queue/UNIFIED-LAB-LIST/gate_trace.py /tmp/u /tmp/trace.json`.
## Result
* Fixture: one tree, `origin/claude/unified` at `4a2b4277f`; branches it does not carry not read.
* Read, not run: a static trace from each `scripts/gate.sh` step (imports, non-comment paths, `cargo -p` crates and
  their path deps, optional ones only under the step's feature). The gate was not run under a trace: its first
  step needs the WASM transport build, absent in this container. Line docs: `claude/unified`, `line-docs-3`, `docs-client`.
* 66 directories, 104 333 non-blank code lines (the audit's 104 334 on its own tree), 476 071 other text lines.
* 19 directories read by a gate step (five of them in part: `av1` 1.6 %, `scripts` 2.9 %, `page-open` 3.1 %,
  `client-telemetry` and `viewer` about half); 47 by none (26 391 code lines, 25 %), nor by the nightly, PGO build,
  demo-series script, CI or `deploy/`.
* Of the 47, a line doc's open item names only `faultbench` (a stale field name); a program row before 11-28 reads
  `htj2k-tiles` (HTJ2K-A1-REVIEW, EXACT-LAYOUT-PAGE) and `faultbench` (INTEGRITY-MODEL).
* Docs only: `scripts/check_links.py` 0 unresolved, comment budget ok; the gate not run.
* Owner: remove the 47 from `claude/unified` after 11-28, each behind an archive tag with its docs repointed, keeping
  `htj2k-tiles` and `faultbench` until their rows are done: yes or no (on the `unified-to-main` page).
