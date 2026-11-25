state: started
started: 2026-11-25T06:17Z
heartbeat: 2026-11-25T06:24Z
by: 8rHJATFk
outputs: none yet
## Resume
Standing review run (in this session; recorded in findings.md when pushed): each of PR 447's three new tests fails with
its file reverted to the tip; cccac3363 and cfb7c6a04 are caught by no unit test (the dispatch rig is said to catch
the first: being checked). Fixtures being coded in /home/user/series by make.sh (dbts_b1-q8-g8, dbts_a1-q8-g8-cut,
dbts_c1-q8-g8-cut; lab/av1/tools/ingest_coded.py at origin/claude/unified b059388b6, coders by ingest/tools.sh).
Next: a bench under docs/queue/DECODE-OVERLAP-MEASURE/ (three product decoder workers per arm from coded bytes in
memory, as claude/phone-run-2:lab/devices/bench.js; arms tip, tip-aa, branch; cells fill and a request at offsets
0, 3, 7; 1x and 4x by lab/scripts/cpu_throttle.mjs); rows pushed per round.
## Result
