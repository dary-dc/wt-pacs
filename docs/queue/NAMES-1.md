state: done
started: 2026-11-12T07:23Z
heartbeat: 2026-11-12T09:55Z
outputs: claude/names-1 311af9c7, draft PR #374 into claude/demo-fixes-2 (for after the merge)
## Resume
Done; nothing left for this row. A review row belongs in the two-week queue (QUEUE-2W).
## Result
* NAMES-FIND's renames, one per commit, from the demo tip 18d2d1ff: glossary rows (items 5, 6, 8) 605466b2; item 4
  prose 9418af3b; item 5 info.path -> info.route, status `routes:` a5c086a4 + 3333667f; item 3 showLossy -> showOptimal
  etc. a2f15908 (metadata key `lossy` stays); item 7 depthCut/cut -> cutShift ab5203d6; item 1 requestExactFrame ->
  requestFrame dc824f7b (43 files, wasm js_name, ts dist + manifest); client.md 311af9c7.
* Item 2's docs were already done (DEMO-UX, FIX-1). Not done, not in the brief's code list: item 2's screen words
  (*unchecked* -> *no digest*), item 6's exactSource -> exactClient.
* Full gate on 311af9c7: GATE OK, 395 s. Skipped: native painter and window, cross-codec + Firefox, nginx web host.
  The gate on a2f15908 failed (dispatch-rig read info.path), fixed in 3333667f.
* Mutants killed: av1.js `path` field, screen.js about.path, voi.js frame.cut, asPainted without cutShift,
  downloader.js and consumer.js requestExactFrame (the latter only by run_browser.sh).
* Not run: demo-check.mjs over the demo series in both views (demo-series.sh not rebuilt here).
* Fixtures: none timed; one 4-core cloud container, no GPU, headless Chromium (SwiftShader).
* Owner: whether to merge #374 after the merge; PRs 369 and 370 will need the same renames.
