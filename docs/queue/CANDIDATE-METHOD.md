state: done
started: 2026-11-14T20:39Z
heartbeat: 2026-11-14T20:40Z
outputs: claude/docs-client 61d4a974 (a docs commit on PR 384)
## Resume
Done. One commit on claude/docs-client: CLAUDE.md §Measurement gains one bullet (five lines), docs/lines/client.md's cache bullet points to #385 and the rule.
## Result
* CLAUDE.md §Measurement: "Choose between candidates so none loses to its build" — survey with sources; eliminate only
  on a sourced hard constraint; a best-effort design per survivor before building; an advocate per survivor by a
  session that wrote none; protocol pre-registered by a session that builds nothing; run, verdict with scope, each loser
  re-checked once for losing to its implementation. Worked example: cache-plan.md (#385, at 7c180630).
* The example is named as a backticked path beside its commit, not linked: cache-plan.md is not on claude/docs-client
  until #385 lands there. Once it does, the pointer can become a link.
* Checks: scripts/check_links.py 0 unresolved; comment budget green. Docs only: the rest of scripts/gate.sh not run
  (no code touched).
