state: started
started: 2026-11-11 04:22
heartbeat: 2026-11-11 10:41
outputs: claude/proposals bf35fcca (P1 measured: adopt; P4 3 of 7 rounds; drivers, rows); no PR yet (#358 is OPT-THEORY's draft into main from this branch)
## Resume
Resumed 2026-11-11 08:23 by a new session (stalled at 07:17). 08:25: setup started at 9e2ef4ef (demo-fixes-1 is
bdbbac84, docs only on top, so the code under rounds 4-7 matches rounds 1-3); then P4 rounds 4-5, 6-7, each pair one
background command, rows pushed every ~10 min by a loop that only commits lab/proposals/rows/p4.jsonl.
08:40: setup done (813 s demo-series). 08:41: rounds 4-5 started; 09:50 done, 360 rows pushed (b69edb9f). 09:51: rounds 6-7 started (rows 361-504). If stalled: count rows in
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
* P4 38 400 B initial window on the exact server: interim after 3 of 7 rounds, rule not met (dbts_b1 clean 0.92x,
  bar 0.9x), no cell above 1.05x; clean -8 to -13 %.
* Not started: P2, P5, P3, audit protocols A, B, C.
* Fixtures: dbts_a1-q8-g8-cut, dbts_b1-q8-g8, dbts_c1-q8-g16-cut and their exact series (demo tip 9e2ef4ef), three
  DBT volumes of one dataset; userspace relay (no netem on this host), loss each direction; one 4-core cloud host,
  no GPU, SwiftShader; headless Chromium, page view.
* Owner decision: BBR for the demo pair's two servers (transport-conclusions §9 item 2 is yours).
