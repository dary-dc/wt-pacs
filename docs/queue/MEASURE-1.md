state: started
started: 2026-11-11 04:22
heartbeat: 2026-11-11 11:25
outputs: claude/proposals 46db2cb3 (P1 measured: adopt; P4 measured, 7 rounds: reject); no PR yet (#358 is OPT-THEORY's draft into main from this branch)
## Resume
Resumed 2026-11-11 08:23 by a new session (stalled at 07:17). 08:25: setup started at 9e2ef4ef (demo-fixes-1 is
bdbbac84, docs only on top, so the code under rounds 4-7 matches rounds 1-3); then P4 rounds 4-5, 6-7, each pair one
background command, rows pushed every ~10 min by a loop that only commits lab/proposals/rows/p4.jsonl.
08:40: setup done (813 s demo-series). 08:41: rounds 4-5 started; 09:50 done, 360 rows pushed (b69edb9f). 09:51: rounds 6-7 started; 11:00 done, 504 rows (cdfb800e). §P4 measured, verdict reject (46db2cb3).
P2: amendment 1 written 11:04 (4619adb6). 11:10 encodes running: lab/proposals/p2_encodes.sh to /home/user/p2
(TIP=/home/user/tip P2_OUT=<dir>; reruns skip finished bundles), then p2_decode.mjs (decode cell) and demo-check
(page cell) per the amendment. A fresh session reruns the encodes (~15 min; the one-tile arm checks itself
byte-equal to demo-series). Encodes done 11:12, bytes rows pushed; tiles checked on keyframes with ffmpeg
(1x1, 2x2, 2 columns). Each arm dir needs the exact series linked in: ln -sf $TIP/demo-series/dbts_?1.{sbnd,metadata.json}
$P2_OUT/<arm>/. 11:25: rounds 1-5 started: TIP=$TIP P2_OUT=$P2_OUT lab/proposals/p2.sh lab/proposals/rows/p2.jsonl 1 5
(a stopped round: move its rows to p2-round<N>-stopped.jsonl, rerun from N). If stalled: count rows in
p4.jsonl; drop a partial round's rows to a *-stopped file and rerun that round whole.
Order (most promising first): P1 BBR, P4 initial window, then P2 tiles, P5, P3 plumbing, then audit protocols B
(B0 first, zero encodes), A (shares B's cells), C (claude/av1-corrections:docs/av1/audit-protocols.md).
Done: P1, 90 runs 04:37-05:14, docs/lines/proposals.md §P1 Measured (3a61ac00, e936037f): adopt.
P4: rounds 1-3 done (216 rows, lab/proposals/rows/p4.jsonl, interim section 29455d32, bf35fcca). The run was
stopped at the background-command limit (2 h) 28 rows into round 4; those rows are in p4-round4-stopped.jsonl and
are NOT to be merged; round 4 is rerun whole.
Host: no sch_netem here; the link is lab/scripts/link_impair.py per each protocol's amendment 1.
Setup (fresh session, ~25 min): git worktree add ../proposals claude/proposals; git worktree add --detach ../tip
origin/claude/demo-fixes-1 (9e2ef4ef, unless a newer demo tip exists: then say so in P4's section); in ../tip:
rustup target add wasm32-unknown-unknown; cargo install wasm-pack --version 0.15.0 --locked; pip install meson==1.9.1;
bash client/transport/wasm/build.sh && bash client/transport/ts/build.sh && ./server/scripts/gen_dev_cert.sh &&
cargo build --release -p series-server && PYTHON=python3.11 scripts/demo-series.sh demo-series (637 s on 4 cores).
Next: in ../proposals, TIP=$PWD/../tip DIR=$PWD/../tip/demo-series lab/proposals/p4.sh lab/proposals/rows/p4.jsonl 4
(run_in_background, ~38 min a round; 4 rounds overrun one 2 h background command, so run rounds 4-5 then 6-7:
edit nothing, start p4.sh at 6 after round 5's 72 rows land). Push rows with git pull --rebase --autostash.
Then replace §P4's "Measured in part" with the 7-round table and verdict (python3 lab/proposals/p4_summary.py).
Then P2 (an ingest arm: amendment first), P5, P3, B0, B, A, C, each with its amendment before any run.
## Result
* P1 BBR on the demo pair: adopt by its rule. 1 % iid: fill 0.11-0.12x, `l` 0.16-0.29x of Cubic's; clean fill
  0.84-0.99x; bursts 0.64-0.89x. BBR's standing queue 85-260 ms during the fill. 90 of 90 runs passed.
* P4 38 400 B initial window on the exact server: reject by its rule after 7 rounds, 504 of 504 runs at Lossless.
  dbts_a1 at 1 % loss 1.06x (noise around a tie: quartiles overlap, frames 1.04/0.96/0.88); dbts_b1 clean 0.92x
  (bar 0.9x). Clean -8 to -14 %, inside the predicted band; under loss 0.62-0.80x on b1 and c1.
* Not started yet: P2, P5, P3, audit protocols A, B, C.
* Fixtures: dbts_a1-q8-g8-cut, dbts_b1-q8-g8, dbts_c1-q8-g16-cut and their exact series (demo tip 9e2ef4ef), three
  DBT volumes of one dataset; userspace relay (no netem on this host), loss each direction; one 4-core cloud host,
  no GPU, SwiftShader; headless Chromium, page view.
* Owner decision: BBR for the demo pair's two servers (transport-conclusions §9 item 2 is yours).
