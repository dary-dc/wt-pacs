state: started
started: 2026-11-11 04:22
heartbeat: 2026-11-11 04:30
outputs: claude/proposals (pending)
## Resume
Order (most promising first): P1 BBR, P4 initial window (same rig as P1), then P2 tiles, P5, P3 plumbing, then
audit protocols B (B0 first, zero encodes), A (shares B's cells), C. One session cannot run all; each later session
resumes at the first protocol without a "measured" section on claude/proposals.
Host finding (04:25): this container has no sch_netem (`tc qdisc add dev lo root netem` -> "qdisc kind is unknown",
iproute2 installed by apt). P1/P4 name netem; the substitute is lab/scripts/link_impair.py (docs/rig-limits.md
§3), written as an amendment in docs/lines/proposals.md before any run.
Next: worktree claude/proposals at ../proposals; demo tip claude/demo-fixes-1 9e2ef4ef at ../tip; follow
claude/gate-cloud setup; build decoders, ingest/tools.sh, series-server; scripts/demo-series.sh; P1 amendment; run.
## Result
(pending)
