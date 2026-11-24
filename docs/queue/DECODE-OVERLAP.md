state: started
started: 2026-11-24T12:47Z
heartbeat: 2026-11-24T12:56Z
by: anen2iBQ
outputs: claude/decode-overlap (from origin/claude/unified), PR pending
## Resume
Step 1 done, measured: the share after frame-out on dbts_b1-q8-g8 is 39.1-45.6 % at 1x and 75.3-76.3 % at 4x
(4 rounds, interleaved; rows `claude/decode-overlap` lab/decode-bench/read-share/rows.jsonl). Over 10 %: build.
Next: the build in client/decode/av1-webcodecs.js, av1.js, decoder.js (next unit sent once the last frame is out,
inside a group; one in flight), tests first and mutated, docs/decode/README.md section, gate, draft PR.
## Result
