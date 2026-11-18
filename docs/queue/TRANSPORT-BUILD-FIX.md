state: done
started: 
heartbeat: 2026-11-18T10:58Z
outputs: claude/transport-arms 1fca3a7a..65c6dd6c (PR 403, body §TRANSPORT-BUILD-FIX); claude/transport-design 0464fc8c (stacks.md §5.7)
## Resume
Done. Next row: TRANSPORT-BUILD-FIX-REVIEW (a session that wrote neither the build, its review nor this fix).
Setup in a fresh container: apt-get update; apt-get install -y iproute2 iputils-ping; python3 -m pip install numpy
xxhash; (cd client/transport/ts && npm ci); cargo install wasm-pack --locked; rustup target add wasm32-unknown-unknown;
client/transport/wasm/build.sh; client/decode/wasm/fetch_openjph.sh; client/decode/wasm/fetch_xxh3.sh; cargo build
--release --bin pack-series; OUT=lab/transport-arms/.series lab/transport-arms/fixture.sh; then, after any gate run,
cargo build --release -p series-server --features lab-get (check_lab_absent.sh rebuilds the default binary over it).
## Result
TRANSPORT-BUILD-FIX done: the five blockers of docs/reviews/transport-arms.md §Verdict, each with a failing check.
* B1 (4495fda1): the opening ask rides the dial; a WT/WS frame asked after the dial stops the run (mutant no-opening).
* B2, B3 (1fca3a7a): a failed check stops the run whatever voids it; a crash is VOID crash (judge.mjs, judge.test.mjs
  in the gate; both old rules fail it).
* B4 (df0bfbae): --lab-tcp-congestion cubic on each accepted socket, read back by ss -tin each visit (mutant
  default-congestion; Rust test fails without the set: bbr).
* B5: stacks.md §5.7 on claude/transport-design 0464fc8c, dated, before any counted row.
* Minors 1, 3, 5 fixed; 2, 4, 6, 7 left for TRANSPORT-RUN in PR 403's body.
* One round after: CLEAN 8 arms 12/12 exact, cubic read on WS/H2; FF 32 visits exact, 2 VOID by the relay guard.
* Gate green to the decoder rebuild (no Docker); absence checks and comment budget green by hand.
Fixtures: synthetic 12-frame HTJ2K series, Chromium 157 headless, one 4-core container, TUN relay ≤ 90 Mbit.
Owner decisions: none.
