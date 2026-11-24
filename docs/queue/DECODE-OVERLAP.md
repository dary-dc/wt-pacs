state: started
started: 2026-11-24T12:47Z
heartbeat: 2026-11-24T13:01Z
by: anen2iBQ
outputs: claude/decode-overlap (from origin/claude/unified), PR pending
## Resume
Step 1 done (share 39.1-45.6 % at 1x, 75.3-76.3 % at 4x; rows on the branch). Build pushed: `claude/decode-overlap`,
client/decode/av1-webcodecs.js, av1.js, decoder.js and tests in av1.test.mjs, decoder.test.mjs; mutants M1-M6, D1 and
av1.js's out() each killed (M4 by an unhandled rejection). Next: a real-Chromium function check (read-share's page
with the overlap: each frame's samples as without it), docs/decode/README.md §The read-back's share, the line doc
(docs/lines/client.md), comment budget, scripts/gate.sh, draft PR into claude/unified.
## Result
