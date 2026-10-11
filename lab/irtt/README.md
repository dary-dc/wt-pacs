# The server's initial RTT: 333 ms against 100

Queue row IRTTMEASURE: `series-server` with `--initial-rtt-ms` unset (quinn's 333 ms) against `--initial-rtt-ms 100`,
the same binary, on the development certificate and on an ECDSA chain. Protocol, rule and results:
[`docs/transport/transport-conclusions.md`](../../docs/transport/transport-conclusions.md) §3 *Proposed row: IRTTMEASURE*.

```bash
cargo build --release -p series-server -p window-harness -p pack-series
export FIREFOX_PATH=.../FirefoxApp/firefox TRACES=dir/with/Verizon-LTE-short.down
lab/irtt/run.py --phase a --rounds 20 --out a.jsonl     # cells A (swallow 40, 80, 150) and clean 40, 80, 150
lab/irtt/run.py --phase c --rounds 20 --out c.jsonl     # cells C: 300, 400, 600, 1 000 ms and LTE-loaded
lab/irtt/run.py --phase b --rounds 1000 --quiet --out b.jsonl   # cell B: 1 % each way at 80 ms
lab/irtt/run.py --summary --out a.jsonl --out b.jsonl --out c.jsonl
```

**A visit** is one dial through its own relay (`link_impair.py --self-timing`, `chrt -f 50` on core 3) and its own
tap, in front of a long-lived server per (arm, certificate); clients run on cores 0–2. The tap sits between relay and
server, so it sees each server datagram as sent: *before the first ACK* is before the first client datagram that
reaches it at least half the path's round trip after the server's first, and a gap over 20 ms starts a new round.
Clients: `cold_open`, headless Chromium (one browser, a fresh context a dial) and headless Firefox (a fresh profile a
dial), both on `index.html`, which times `new WebTransport` to `ready` and then opens an empty control stream so the
server ends the session and logs `session path`. The (client, arm) units of a (cell, certificate) block run in a
Williams order every round (`lab/scripts/order.py`); the relay's seed is the round, so both arms of a pair meet the same
loss draws. The first line of every output file prints each arm's settings and every pin.

**Checked.** Both arms set to 333 ms (a mutated copy): the swallow lead goes from +700 ms to +3 ms and the probe round
before the first ACK disappears. The tap's server datagrams equal the server's own `datagrams_tx` on every visit tried.

**Pins.** Chromium 141.0.7390.37 headless shell (Playwright 1.56.1); Firefox 157.0.1 (conda-forge
`firefox-157.0.1-hee9eb32_0.conda`, SHA-256 `f1b53de2…4d7127f35`, by micromamba 2.9.0, `8761c382…f13040dd`, as
`lab/firefox-dial` installs it); mahimahi `Verizon-LTE-short.down` at `f1346c38`, SHA-256 `c918436fbd6246af…`;
quinn 0.11.11, quinn-proto 0.11.18, wtransport 0.7.2 as `Cargo.lock` pins them. Nothing fetched or built is committed.
