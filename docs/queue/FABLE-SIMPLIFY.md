state: done
started: 2026-11-11 16:01
heartbeat: 2026-11-11 16:08
outputs: claude/fable-simplify 460488d9 (from origin/main), draft PR #366 into main (docs only)
## Resume
Done. cb66cb3f: docs/proposals/simplify-fable.md §1 and §2, written from claude/demo-fixes-1 daee0d1d before any
earlier finding was read. 460488d9: §3 (eleven proposals), §4 (against claude/demo-simplify, claude/demo-understand,
claude/demo-clean), §5, and a pointer in docs/lines/client.md. Nothing implemented; nothing run but
scripts/check_links.py (0 unresolved). The full gate was not run: no code changed.
## Result
* The demo's shape is sound: five boxes (page, downloader, decoder, view, pairing). What is hard to explain is what
  is threaded through it: two views, three ways to ask, three cache writers, two cines, ~100 lab and check lines in
  viewer.js, over 20 lab settings.
* Safe before 11-13: P1 one command starts a pair (README's three terminals); P2 three doc statements the code
  contradicts (client/README.md says frames are written to OPFS and leave memory past 256 MiB: neither happens by
  default; docs/lines/client.md puts the cine clock in the view worker: the product's is a page timer).
* After the freeze: P3 the page free of lab and check (a handle, not hooks); P4 one way to ask (the want) whichever
  view; P5 one view; P6 one start order; P7 one cache writer; P8 one cine; P9 layering, one clock helper, one
  store.js; P10 the AV1 deep route the <= 10-bit rule made unreachable; P11 two lab flags in the server's default build.
* Disagrees with the earlier findings on: S2's decider (20 series passing is correctness; the ADR's timing rule
  kept the page view); folding five lab settings into one object (hides, does not remove); a second lab entry page.
* Goes further: P4 (the asking fork closes without choosing a view), P7, P8, P2, P9, P10.
* Limits: read only, at daee0d1d; the server less deeply than the client.
* Owner decisions: yes or no on P1 and P2 before the demo; which runs decide P5; whether the cache-writer
  comparison (P7) and the stored form's deep route (P10) are closed; whether "no low-resolution preview" also covers
  the scalable layer's preview (P10's question).
