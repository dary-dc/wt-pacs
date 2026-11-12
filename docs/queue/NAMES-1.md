state: started
started: 2026-11-12T07:23Z
heartbeat: 2026-11-12T09:35Z
outputs: claude/names-1 311af9c7 (no PR yet)
## Resume
Branch claude/names-1 from the demo tip claude/demo-fixes-2 18d2d1ff. Source: claude/demo-understand:docs/reviews/understand/names.md
(its line numbers are 618e13c8's; re-grep). Done and pushed: 605466b2 glossary rows (items 5, 6, 8); 9418af3b item 4
(prose "view" -> optimal-quality picture; the queue's and line docs' dated decision quotes left as written).
Item 2's docs part was already done by DEMO-UX (client/README.md §Optimal quality) and FIX-1 (no mark beside a label).
a5c086a4 item 5 (info.path -> info.route etc.; lab output row keys kept; mutants killed: av1.js route field 16 FAILs,
screen.js overlay). a2f15908 item 3 (showLossy -> showOptimal etc.; metadata key `lossy` stays).
Gate on a2f15908 FAILED at run_browser.sh: dispatch-rig read info.path (item 5 missed it); fixed in 3333667f.
ab5203d6 item 7 (depthCut/cut -> cutShift; mutants killed: voi.js reads frame.cut, asPainted drops cutShift).
dc824f7b item 1 (requestExactFrame -> requestFrame in 43 files incl. lab; wasm js_name + Rust fn; ts dist rebuilt and
manifest.sha256 updated; history records left: docs/av1/queue.md, docs/reviews, docs/queue*).
311af9c7 docs/lines/client.md. Gate on 3333667f (worktree): every step passed up to the decoder rebuild, which failed
on the worktree's symlinked vendor/ (Docker cannot follow it), not on the code. Full gate on 311af9c7 running in the main
tree (scratchpad gate-311af9c7.log). Next: read it; the consumer.js requestFrame mutant through
client/contract/run_browser.sh; draft PR into claude/demo-fixes-2 (for after the merge); Result.
## Result
