state: started
started: 2026-11-11T19:00Z
heartbeat: 2026-11-12T04:14Z
outputs: claude/proposals 603875d5, docs/lines/proposals.md §Round 2 (amendments 1 of R1-R4; Measured R1 90c3e3e3, R2 1eee0579, R3 76ab875d, R4 1609aad4), rows lab/proposals/rows/r1-*, r2, r3, r4.jsonl; docs and lab drivers only; no PR (PR #358, OPT-THEORY's draft into main, carries claude/proposals)
## Resume
2026-11-12T00:24Z: resumed (stalled) by a new session for R5; setup next.
00:58: setup running (/home/user/bin/setup.sh: worktrees ../tip detached at claude/demo-fixes-2 18d2d1ff, the demo
commit 157b7109 plus docs, and ../proposals; meson, wasm32, wasm-pack, transport builds, dev cert, series-server,
demo-series; apt-get install nginx). R5 drivers pushed (2bea9dab: lab/proposals/r5_arm.sh, r5_cells.mjs, r5.sh;
not yet smoked). Next: smoke one run per arm (not kept), amendment 1 of R5 in §R5, then r5.sh taken, refused, failed.
2026-11-12T00:47Z: setup done (demo-series needed lab/av1/.venv filled first: pip install --require-hashes -r
lab/av1/requirements.txt; 584 s). Smoke (7 runs, not kept); R5 amendment 1 pushed (d083e46c, §R5). Counted runs
started: /home/user/bin/runall.sh runs, in ../proposals with TIP=/home/user/tip DIR=/home/user/tip/demo-series
ROOTS=/home/user/r5roots, lab/proposals/r5.sh taken /home/user/r5-taken.jsonl, then refused, then failed (432, 432,
27 rows; ~1.5 h, ~1.5 h, ~25 min). Roots: lab/proposals/r5_arm.sh TIP ROOTS/lazy lazy; ROOTS/probe probe; and for
failed ROOTS/{today,lazy,probe}-<id> with FAIL 27 (a1, b1) or 35 (c1). A pusher (/home/user/bin/pusher.sh) copies
rows to lab/proposals/rows/r5-<route>.jsonl and bumps this heartbeat every 10 min. nginx from apt (apt-get update;
apt-get install -y nginx). If stopped: a taken/refused round is 48 rows, a failed round 9; move a partial round
aside (r5-<route>-stopped.jsonl) and rerun r5.sh ROUTE OUT FIRST_ROUND. Then a summary (r5_summary.py, to write)
→ §R5 Measured, the Result, the codecs/optimal-quality line note.
2026-11-12T01:28Z: amendment 2 (0735659c): 5 rounds a route, the host runs 1.07 rows/min. /home/user/bin/cutover.sh stops
the 9-round run at 240 taken rows and starts /home/user/bin/runall2.sh (LAST=5: refused 240, failed 27). Summary
script pushed (21755f3e): python3 lab/proposals/r5_summary.py rows/r5-taken.jsonl rows/r5-refused.jsonl
rows/r5-failed.jsonl. Expected end ~09:30. If stopped: rerun with LAST=5 from the first incomplete round.
(Times before 00:58 in this entry were written ahead of the clock; the commits carry the true ones.)
2026-11-12T01:43Z: the container restarted at ~01:40 and killed the runs (files kept). Round 1 of taken whole (48 rows);
round 2's 18 rows moved to rows/r5-taken-stopped.jsonl, not read. Restarted: FIRST=2 /home/user/bin/runall2.sh
(LAST=5) and the pusher. After a restart: count rows per round, move the partial round aside, rerun the same way
(a route's .done file under /home/user marks it complete; nginx and the builds survive a restart).
22:52: R1-R4 done and pushed, nothing unpushed, nothing running. This session stops before R5 (context); left
`started` so the next worker resumes it once the heartbeat is an hour old.
Next: R5 (§R5: P6's rule with an A/A arm, the tip against itself). Owed before any run: an amendment, and P6's arms
built as P6 (claude/dav1d-lazy 7cf46ef7, docs/lines/proposals.md §P6) says: (b) and (c) as lab copies of the demo
tip built like lab/proposals/p5_arm.sh, ~15 lines in av1.js and head.js; the forced-refusal and mid-group-failure
levers; dev-server.py --log-requests and the nginx (gzip) harness, the static host's TCP through link_impair.py --tcp;
9 rounds, arms rotated, (a') the A/A arm added; then the heuristic-cache question from the request log.
Fresh-session setup (~25 min): git worktree add ../proposals claude/proposals; ../tip detached at
claude/demo-fixes-2 d46811c6 built with /home/user/setup.sh's steps (listed in the first entry below).
--- this session's log ---
2026-11-11T19:01Z: setup started (log /home/user/logs/setup.log): worktrees ../proposals (claude/proposals 8fb23876), ../tip
detached at the demo tip claude/demo-fixes-2 d46811c6 (frozen), built as MEASURE-1's Resume lists (/home/user/setup.sh:
rustup wasm32 target; wasm-pack 0.15.0; meson 1.9.1; transport wasm+ts; dev cert; series-server release;
PYTHON=python3.11 scripts/demo-series.sh demo-series, ~11-14 min). Order: R1 (amendment 1 first, before any run),
R2, R3 plumbing, R4, R5 (§Round 2 of docs/lines/proposals.md), each amendment pushed before its run, rows pushed as
they land under lab/proposals/rows/r*.jsonl.
Done: R1 amendment 1 (d5a3e396), drivers lab/proposals/r1_encode.py, r1_encodes.sh, r1.sh (e6209866).
R1 next, after setup: (a) ../integ = worktree of claude/oq-integrity-build 08bf659e; in it symlink ingest/.build,
lab/av1/data, lab/av1/.venv to ../tip's; transport wasm+ts builds, gen_dev_cert.sh, cargo build --release -p
series-server -p pack-series; pip install scipy into the venv; /home/user/metrics/quality.py = claude/av1-vl-metrics
b86628d6:lab/av1/metrics/quality.py. (b) in ../proposals: INTEG=/home/user/integ TIP=/home/user/tip
QUALITY=/home/user/metrics R1_OUT=/home/user/r1 lab/proposals/r1_encodes.sh > lab/proposals/rows/r1-bytes.jsonl
(reruns skip finished bundles); copy /home/user/r1/*/*.quality.jsonl to lab/proposals/rows/r1-quality/. (c) condition
(2): in ../integ, node lab/oq-integrity/run.mjs /home/user/r1/ARM OUT --rounds 1 --throttles 1 --arms on --ids <7>.
(d) TIP=/home/user/tip R1_OUT=/home/user/r1 lab/proposals/r1.sh lab/proposals/rows/r1-jump.jsonl 0 6 (~35 min).
Amendments written before any run: R1, R2, R3 (arm r3_arm.sh + r3_arm.test.mjs, 3 of 3 mutants killed), R4
(initial window reaches BBR, tuning.rs:31; path RTT replaced by the relay's window tallies). R5 not started (needs
P6's arms (b), (c) built from claude/dav1d-lazy and a shaped static host: last, likely a later session).
19:18 setup done (demo-series 728 s); ../integ built and linked. 19:21 R1 encodes running (r1_encodes.sh as above;
the one-tile check is on bundles packed with the demo tip's metadata, afd7c08f).
19:31 R1 encodes done, all 7 one-tile bundles equal to the demo tip's; rows r1-bytes.jsonl, r1-quality/ (6671249b);
19:32 condition (2) holds, 14 of 14 fills as coded on av1-webcodecs (r1-correct.jsonl, e5f3d41e). 19:32 jump cell
running: /home/user/r1/jump.jsonl (copy to lab/proposals/rows/r1-jump.jsonl as it lands). If stopped: a fresh session
reruns r1_encodes.sh (~12 min, skips nothing it has not got) and r1.sh from the first incomplete round (a round is 6
rows). Then: python3 lab/proposals/r1_summary.py /home/user/r1 rows/r1-bytes.jsonl rows/r1-correct.jsonl
rows/r1-jump.jsonl → §R1 Measured; then R2.
20:01 R1 done: §R1 measured (90c3e3e3), not ready by its rule. 20:02 R2 started: TIP=/home/user/tip
DIR=/home/user/tip/demo-series lab/proposals/r2.sh /home/user/r2.jsonl (copied to lab/proposals/rows/r2.jsonl as it
lands). If stopped: a round is 3 loopback rows (rounds 1, 4, 7) + 21 runs; move a partial round to r2-stopped.jsonl,
rerun from it (second argument). Then python3 lab/proposals/r2_summary.py lab/proposals/rows/r2.jsonl → §R2 Measured.
20:55 R2 done, 156 rows: §R2 measured (1eee0579, 3a926971), P1's claim stands. 20:56 R3 plumbing started:
TIP=/home/user/tip DIR=/home/user/tip/demo-series ARM=/home/user/r3-wake lab/proposals/r3.sh /home/user/r3.jsonl
(arm rebuilt by r3_arm.sh, its test ok); a pusher copies rows to lab/proposals/rows/r3.jsonl every 10 min. If
stopped: a round is 6 rows; rerun from the first incomplete round. Next R4 (r4.sh, 315 runs, ~2.8 h: run rounds
1-3 then 4-7 under the 2 h background limit), then R5 (not prepared, see below).
21:17 R3 plumbing done, 42 rows: §R3 measured (76ab875d), the rule holds. 21:22 R4 rounds 1-3 started (pid in
/home/user/r4.pid; TIP=/home/user/tip DIR=/home/user/tip/demo-series lab/proposals/r4.sh /home/user/r4.jsonl 1 3),
a pusher (pid-keyed) copies rows to lab/proposals/rows/r4.jsonl every 10 min. A round is 45 rows. Then rounds 4-7
(r4.sh OUT 4 7). If stopped: move a partial round to r4-stopped.jsonl, rerun from it.
22:04 R4: r4.sh takes only FIRST_ROUND (it runs to 7), so the one command runs all 7 rounds (nohup, pid as above;
rounds 1-3 done at 22:00, 135 rows). Next: python3 lab/proposals/r4_summary.py lab/proposals/rows/r4.jsonl → §R4.
Runs, in order, each one background command, rows pushed by hand or a loop every ~10 min:
  R1 (encodes, condition (2), jump: see above); R2: TIP=/home/user/tip DIR=/home/user/tip/demo-series
  lab/proposals/r2.sh lab/proposals/rows/r2.jsonl [FIRST_ROUND] (~75 min; stop mid-round: move the partial round's
  rows to r2-stopped.jsonl and rerun the round); R3: lab/proposals/r3_arm.sh /home/user/tip /home/user/r3-wake, then
  TIP=.. DIR=.. ARM=/home/user/r3-wake lab/proposals/r3.sh lab/proposals/rows/r3.jsonl (~20 min); R4: r4.sh, same
  form (~2.8 h, 45 runs a round: run rounds in pieces under the 2 h background limit).
## Result
* R1 tiles (2x2) at equal quality: not ready by its rule. e and e_N/sigma 0.997-1.002x of one tile's (holds); max |D| at
  the median frame +5 source units on dbts_a1-q8-g8-cut against a 1-unit bar (fails; -5 to +1 elsewhere, under one
  code step of 4). I1's digest: every frame as coded on WebCodecs, both arms. G 16 jump 0.37x on 4 cores (band
  0.70-0.85x missed, in its favour); 0.99x under taskset -c 0,1, where the one-tile jump is itself half (199 vs 406 ms).
* R2 jump 500 ms into the fill: P1's claim stands. BBR 0.08-0.09x of Cubic's at 1 % loss (band 0.2-0.6x missed, in
  BBR's favour), 0.86-0.96x clean and in bursts; under Cubic at 1 % on a1 and c1 the jump paints when the fill's last frame lands.
* R3 wake on end_stream alone, plumbing: holds, -103 and -105 ms (rule -100 +-15; A/A 8 and 2 ms). Phone row owed.
* R4 38 400 B window under BBR: withdrawn, `l` 1.09-1.26x slower in every cell (predicted 0.85-0.95x clean).
* R5: not started (see Resume). Every rule carried R0's A/A arm.
* Fixtures: dbts_a1/b1/c1 Q 8 (R1: G 1, 8, 16 with the cut on a1 and c1), three DBT volumes of one dataset; demo tip
  d46811c6, I1/I2 on claude/oq-integrity-build 08bf659e; userspace relay, not a radio; one 4-core cloud host, no GPU,
  SwiftShader, headless Chromium; 2-core cells are taskset, not a phone. Gate not run: docs and lab drivers only
  (check_links 0 unresolved, comment budget ok). Wake arm's test: 3 of 3 mutants killed.
* Owner: none new. R1 and R4 inform only decisions after the demo; R2 adds to the BBR call the phone runs decide.
