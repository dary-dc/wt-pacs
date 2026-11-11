state: started
started: 2026-11-11 01:23
heartbeat: 2026-11-11 01:26
outputs: claude/demo-redteam (from claude/demo-fixes-0 618e13c8)
## Resume
On claude/demo-redteam (from demo-fixes-0 618e13c8): 0ff50f5f client/viewer/pair-source.test.mjs (2 hits: another
source accepted; photometric/rescale not compared), 78454ebc client/view/depth-cut.test.mjs (cut shift applied to a frame
of any decoded depth). Each fails now and passes under a sketched fix (scratch only). Read so far: pair.js,
viewer.js, controller.js, decoder.js, av1.js, av1-webcodecs.js, consumer.js.
Next: route attacks (av1.test.mjs stubs: refusal → dav1d, overlay route), loss/reordering on the exact ask
(downloader.test.mjs), then docs/reviews/demo-redteam.md with every finding and docs/lines/optimal-quality.md.
New test files are not in scripts/gate.sh on purpose (they fail until FIX-1).
## Result
