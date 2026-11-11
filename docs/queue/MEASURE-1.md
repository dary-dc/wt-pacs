state: started
started: 2026-11-11 04:22
heartbeat: 2026-11-11 06:19
outputs: claude/proposals e936037f (P1 measured: adopt; P4 amendment 1; drivers, rows)
## Resume
Order (most promising first): P1 BBR, P4 initial window (same rig), then P2 tiles, P5, P3 plumbing, then audit
protocols B (B0 first, zero encodes), A (shares B's cells), C (claude/av1-corrections:docs/av1/audit-protocols.md).
Done: P1, 90 runs 04:37-05:14, measured section in docs/lines/proposals.md §P1 (3a61ac00, e936037f): adopt.
Host: no sch_netem here; the link is lab/scripts/link_impair.py per each protocol's amendment 1.
Setup (fresh session): worktrees claude/proposals at ../proposals, demo tip claude/demo-fixes-1 9e2ef4ef at ../tip;
in ../tip: cargo install wasm-pack --version 0.15.0 --locked; rustup target add wasm32-unknown-unknown;
pip install meson==1.9.1; bash client/transport/wasm/build.sh && bash client/transport/ts/build.sh &&
./server/scripts/gen_dev_cert.sh && cargo build --release -p series-server && PYTHON=python3.11 scripts/demo-series.sh demo-series (637 s).
Running since 05:16: P4, TIP=../tip DIR=../tip/demo-series lab/proposals/p4.sh lab/proposals/rows/p4.jsonl (504 runs,
72 a round). If stalled: delete the partial round's rows, rerun p4.sh OUT ROUND. Push rows with git pull --rebase --autostash.
Then P2 (needs an ingest arm: lossy_args with --tile-columns/--tile-rows, amendment first), P5, P3, B0, B, A, C.
## Result

(pending)
