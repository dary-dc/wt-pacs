state: done
started: 2026-11-12T14:43Z
heartbeat: 2026-11-12T17:30Z
outputs: claude/lossless-under-loss aa81e3fc (PR 378), claude/hidden-page-decode 22c68824 (PR 376, covers 377); Review sections in PR 376, 377, 378 bodies
## Resume
Done. Taken because UNIFY-PACS was already running in another session. Nothing to resume.
## Result
* PR 378 (lossless re-asks): with the fix reverted, 2 of its 4 new tests fail (the other 2 are guards). Mutants killed: no leave check, no re-ask, no wait. Theory matches srv logs (both timed out 30 s after the fill, sent=10).
* PR 376 (late decode deadline): with the fix reverted, its test fails. All 5 mutants of this review's own were killed. Theory matches load 2ed36cb0 (29/50; keyframes 0, 8, 16 at 17.6-18.1 s; frames 1-7, 9-15, 17-23 missing).
* PR 377 (beacon visibility): 8/8. With beacon.js reverted, the test fails at the import. The install() wiring is untested in node.
* Gate on 376 and 378: OK up to the decoders' rebuild, which Docker Hub refused (429). The three absence checks pass alone. Browser steps, numpy, lavapipe, Xvfb, Firefox and nginx were skipped.
* demo-check.mjs passed in the page and worker views on both fix branches. Fixtures: one series, dbts_b1-q8-g8 (no depth cut, no --link, no xxh3 hasher); 4-core cloud host, no GPU.
* Findings: 378 re-asks every rejection, not only transport losses (about 21 s of "asking" before a repeatable refusal fails); 378 carries lab/lossless-under-loss/ into the demo tip's branch (cleaning rule); 376 re-arms on any thread stop over 1 s (bounded).
* Owner decisions: retry only transport losses, or all; where lab/lossless-under-loss/ lives when 378 merges; merging 376/377/378.
