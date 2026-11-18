state: started
started: 2026-11-18T07:16Z
heartbeat: 2026-11-18T07:41Z
outputs: claude/transport-arms (from origin/claude/docs-client), draft PR into claude/docs-client (to open)
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
Next: WT-WASM (wasm-pack build of client/transport/wasm), the other actions (first, ad, aa, FP pooled) once each,
§5.6's five mutants, README, gate, draft PR into claude/docs-client.
Build: `cargo build --release -p series-server --features lab-get`; test: `cargo test -p series-server --features
lab-get --lib -- lab_get a_get_answers`.
## Result
