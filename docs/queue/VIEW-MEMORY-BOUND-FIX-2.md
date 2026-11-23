state: done
started: 2026-11-23T07:17Z
heartbeat: 2026-11-23T07:54Z
outputs: claude/view-memory-bound d05e53274 (client/view/controller.js, its test, client/viewer/viewer.js, lab/viewer/hooks.js, docs/client/evidence/what-a-view-asks-for.md, docs/lines/client.md); PR 435 body §VIEW-MEMORY-BOUND-FIX-2
## Resume
Done. Next row: VIEW-MEMORY-BOUND-FIX-2-REVIEW (a session that wrote none of PR 435), findings in PR 435 §Re-review 2.
## Result
B1 fixed: Controller.link links the page view's store to its downloader past the window (fill mode, no cache), so each step asks the window's misses nearest first, as the worker view does; on demand and a fitting series unchanged. Test: page view, 10 frames, budget 4, steps 1-5 hears 4,5,6,7, each two steps ahead, never requestFrame.
m1 fixed: progress `have` and fillMs count the window's frames held (no cache, fill mode); lab/viewer/hooks.js waits on progress total, else a lab load over the window would hang.
n1 fixed. m2 open, named: viewer.js's two lines (fill, link call) have no unit test; the gate's viewer series fits its window.
Mutants: never linked, linked when fitting, linked on demand, owed not recorded, have = arrivals (two forms): all killed. 46/46.
Gate OK in 660 s at d05e53274 (skips named in PR 435); comment budget, links, lab absence green.
Fixtures and limits: unit tests on synthetic 3x2 frames; no series over its window run in a browser or on a device; memory and step latency not measured.
