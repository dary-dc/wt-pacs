state: started
started: 2026-11-11T19:00Z
heartbeat: 2026-11-11T20:15Z
outputs: claude/proposals d143c942 (amendments 1 of R1 d5a3e396, R2 362bbc2c, R3 and R4 d143c942; drivers r1*, r2.sh, r3*, r4.sh; link_cells.mjs --jump-after-ms/--windows; link_impair.py `window`), docs/lines/proposals.md §Round 2; no PR yet
## Resume
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
Runs, in order, each one background command, rows pushed by hand or a loop every ~10 min:
  R1 (encodes, condition (2), jump: see above); R2: TIP=/home/user/tip DIR=/home/user/tip/demo-series
  lab/proposals/r2.sh lab/proposals/rows/r2.jsonl [FIRST_ROUND] (~75 min; stop mid-round: move the partial round's
  rows to r2-stopped.jsonl and rerun the round); R3: lab/proposals/r3_arm.sh /home/user/tip /home/user/r3-wake, then
  TIP=.. DIR=.. ARM=/home/user/r3-wake lab/proposals/r3.sh lab/proposals/rows/r3.jsonl (~20 min); R4: r4.sh, same
  form (~2.8 h, 45 runs a round: run rounds in pieces under the 2 h background limit).
## Result
