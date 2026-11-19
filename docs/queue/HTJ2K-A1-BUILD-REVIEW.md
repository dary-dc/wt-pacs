state: started
started: 2026-11-19T14:47Z
heartbeat: 2026-11-19T15:10Z
outputs: findings in PR 408's body (`claude/htj2k-a1`)
## Resume
Done: static read; smoke tree on dbts_b1 (D series sha256 equal to `rows/stage3-d-series.json`; strip series 100/100
exact); three D+T1 visits at `r20000` 1x, rows in `HTJ2K-A1-BUILD-REVIEW-smoke.jsonl` beside this file: plain exact
1/1, `whole-neighbour` exact 0/1, page hunk of `cf975330` reverted: the visit fails (`requestExactFrame` of undefined).
Vendors fetched (`fetch_openjph.sh`, `fetch_xxh3.sh`); transport WASM built (`rustup target add wasm32-unknown-unknown`, `cargo install wasm-pack`). Running: `scripts/gate.sh`
in `/home/user/a1rev` (ingest/.build -> the demo tree's, same `tools.sh`). Next: the gate's result, findings into PR
408's body, state done.
## Result
