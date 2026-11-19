state: started
started: 2026-11-19T14:47Z
heartbeat: 2026-11-19T14:53Z
outputs: findings in PR 408's body (`claude/htj2k-a1`)
## Resume
Static read of `fa235641..608ca152` done. Smoke tree (dbts_b1 only), in progress: worktrees `/home/user/a1rev`
(`claude/htj2k-a1`) and `/home/user/demo` (157b7109, `scripts/demo-series.sh` narrowed to dbts_b1 Q 8 G 16 by sed,
revert after); data `/home/user/data`; ingest tools built (`pip install meson` was needed); `cargo build --release -p
pack-series -p series-server` in the demo tree done; D series -> `/home/user/demo-series`; strip series -> `/home/user/bands`
(`stage3_prep.py`). The levels binding is not built: `lab/.openjph-build/wasm/levels.*` in the served tree point at the
delivered build (D+T1 decodes at level 0 only). Next: copy `lab/htj2k-tiles/improve` into the demo tree, three D+T1
visits on `dbts_b1/phone` `r20000` 1x (plain, `--mutate whole-neighbour`, page hunk reverted), the gate on the branch,
findings into PR 408's body.
## Result
