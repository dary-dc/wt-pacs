state: done
started: 2026-11-17T06:17Z
heartbeat: 2026-11-17T06:21Z
outputs: claude/cache-arms 03777b30 (PR 394): docs/reviews/cache-arms.md §Re-review, third round; docs/lines/client.md
## Resume
Done.
## Result
CACHE-FIX-2 (f8dd736c..05a0e07d) against the re-review's blocker N1: closed, no new blocker. CACHE-RUN may start.
The fix undone with its test kept: the first two checks fail as observed ({"rounds":1,…,"pass":true}) and the third
throws in lBars (an errored none also lost the run's summary row before the fix).
This review's own mutants: 4 killed; 4 survivors, each equivalent (one row per unit per round in run.mjs; an empty
judged set gives NaN shares, which fail).
Six cache-arms test files, comment budget and check_lab_absent pass at 05a0e07d; check_links' two unresolved paths
(docs/lines/devices.md 57, 60) predate the fix. Full gate not run (lab and docs diff; CACHE-FIX-2's --quick stands).
Minor: pass is over judged rounds only; an arm whose none errored in 3 of 4 rounds can pass on one. CACHE-RUN reports
`unjudged` beside each L verdict.
Fixtures: 4-vCPU cloud host, Node 22, synthetic rows; no browser, engine or phone.
Owner decision: whether an L cell with unjudged rounds is VOID (§8.5 is silent; the protocol's author settles).
