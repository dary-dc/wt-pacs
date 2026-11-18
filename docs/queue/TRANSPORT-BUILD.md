state: done
started: 2026-11-18T07:16Z
heartbeat: 2026-11-18T08:18Z
outputs: claude/transport-arms 88c91643, draft PR 403 into claude/docs-client
## Resume
**Can this container run `link_impair.py --tun`? Yes, once `iproute2` is installed** (the image lacks `ip`; the relay
died with `FileNotFoundError: [Errno 2] No such file or directory: 'ip'`). Fixed by `apt-get install -y iproute2
iputils-ping`; then `unshare -rn sh -c 'python3 lab/scripts/link_impair.py --tun --delay-ms 1 --rate-kbit 90000
--queue-pkts 300 & sleep 3; ping -c 3 10.77.0.2'` printed READY and a 2.3-2.4 ms RTT (1 ms each way + the relay).
/dev/net/tun present, 4 cores. So §5.2's rig holds in the cloud; no cell weakened.
Done (claude/transport-arms, from origin/claude/docs-client): §5.6 item 1, `server` feature `lab-get`
(`server/src/transport/lab_get.rs`): `--lab-get-port P` serves GET /frames/K and /frames/K-N by HTTP/3 (UDP P, a quinn
endpoint of its own built with the session's `to_transport_config()`) and HTTP/2 (TCP P, TLS 1.3, ALPN h2);
`--lab-get-static DIR` (FP's page from the frame server); `--lab-get-drop F` (the mutant). Commits 25170159, 7f04fe66.
**Departure to name in the PR:** not "the same quinn endpoint" (§5.6): a WebTransport dial and a fetch both offer ALPN
`h3`, so one endpoint cannot tell them apart before wtransport takes the CONNECT; a second endpoint with the same
transport config holds §5.1's "same controller and initial window". For the review / an amendment.
Done: item 2 and 3 first cut (06e0a0db): `lab/transport-arms/` fetch-session.ts, page.{html,js}, run.mjs,
build.sh, fixture.sh (12 synthetic HTJ2K 2048² frames, ~6.5 MB each, XXH3 digests). Checked: CLEAN, 1 round, WT-TS,
WS, H3-frame, H3-fill, H2-frame, H2-fill: 12/12 frames exact by the decoder's XXH3 each, nextHopProtocol h3/h2 as asked.
Needs in a fresh container: `apt-get install -y iproute2`, `pip install numpy xxhash`.
Then (6127d940): WT-WASM built (`rustup target add wasm32-unknown-unknown; cargo install wasm-pack --locked;
client/transport/wasm/build.sh`) and exact; FP (pooled, h2/h3 from the GET origin) and AD-PUB exact on every arm; an
ask's t0 moved to the page's call (the downloader keeps a fill's ask stamp on a frame the fill owes); README.
Coverage, 1 round each on the test series, every arm: CLEAN, FP, AD (PUB, LTE), AA (6 forms), FF (4 forms) exact on
every visit, no VOID; LOSS as a pilot (4 arms, 2 frames): exact, HOL recorded, the relay's tally 1.03 % against 1 %.
§5.6's mutants (0a4b5d4b, README §Checks): wrong-protocol VOID, drop-frame STOP, relay-no-loss PILOT REFUSES,
fixed-order UNBALANCED, cpu-wrong-pid CPU ZERO; the unmutated control balanced.
Gate at 88c91643: green to the decoder rebuild, which needs a Docker daemon this container lacks; the three absence checks after it green by hand. PR 403 opened. Nothing left.
Build: `cargo build --release -p series-server --features lab-get`; test: `cargo test -p series-server --features
lab-get --lib -- lab_get a_get_answers`.
## Result
TRANSPORT-BUILD done: stacks.md §5.6's three items on `claude/transport-arms` (draft PR 403 → claude/docs-client).
* The cloud runs `link_impair.py --tun` once `iproute2` is installed (the image lacks `ip`); no cell weakened.
* GET path: series-server `--features lab-get` (HTTP/3 + HTTP/2 on `--lab-get-port`); fetch carrier
  `lab/transport-arms/fetch-session.ts` (frame/fill shapes, K = 6); driver `lab/transport-arms/run.mjs`.
* Every arm (WT-WASM included) exact by XXH3 at CLEAN, FP, AD, AA, FF and a LOSS pilot, one round, on a synthetic
  12-frame series (~6.5 MB frames); fetch arms spoke h3/h2 as asked.
* §5.6's five mutants each fire; the GET path's Rust test kills two mutants.
* Gate green up to the decoder rebuild (no Docker daemon here); absence checks green.
* Two departures for TRANSPORT-BUILD-REVIEW: HTTP/3 on a second quinn endpoint with the same transport config (one
  endpoint cannot tell a WT dial from a fetch, both ALPN h3); an ask's t0 is the page's call (the downloader keeps the
  fill's ask stamp on a frame the fill owes).
Owner decisions: none.
