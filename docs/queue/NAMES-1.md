state: started
started: 2026-11-12T07:23Z
heartbeat: 2026-11-12T07:50Z
outputs: claude/names-1 9418af3b (no PR yet)
## Resume
Branch claude/names-1 from the demo tip claude/demo-fixes-2 18d2d1ff. Source: claude/demo-understand:docs/reviews/understand/names.md
(its line numbers are 618e13c8's; re-grep). Done and pushed: 605466b2 glossary rows (items 5, 6, 8); 9418af3b item 4
(prose "view" -> optimal-quality picture; the queue's and line docs' dated decision quotes left as written).
Item 2's docs part was already done by DEMO-UX (client/README.md §Optimal quality) and FIX-1 (no mark beside a label).
Next, code, one rename per commit: item 5 (info.path -> info.route, seen.paths -> seen.routes, status `decoders:` ->
`routes:`), item 3 (showLossy/View.lossy/intent lossy/checkPair param/decoder cfg lossy -> optimal; metadata key `lossy`
stays), item 7 (depthCut/cut -> cutShift), then item 1 (requestExactFrame -> requestFrame, incl. wasm js_name, ts dist).
Gate setup: scratchpad setup.sh (dockerd, meson, venv, build.sh, ingest/tools.sh); then
INGEST_BUILD=$PWD/ingest/.build PYTHON=.venv/bin/python scripts/gate.sh. Then client.md line doc, draft PR into
claude/demo-fixes-2 (for after the merge).
## Result
