# Firefox's dial on a slow link

Why Firefox 157's WebTransport dial through the relay did not settle on fixed 5–20 Mbit/s links while
Chromium's did, and the dial per link before and after the fix. The reading is in
[`docs/transport/transport-conclusions.md`](../../docs/transport/transport-conclusions.md) §3 Firefox's dial on a slow link.
Chromium's dial against both builds, alternated, is quoted in [`docs/ARCHITECTURE.md`](../../docs/ARCHITECTURE.md) §What early SETTINGS cost.

```bash
export FIREFOX_PATH=.../FirefoxApp/firefox   # Firefox 157.0.1 as lab/av1/bytes/jpeg-xl/README.md installs it
cargo build --release -p series-server && cp target/release/series-server /tmp/after
git show 4f7e3d29~1:patches/wtransport-0.7.2-settings-in-handshake.patch > patches/wtransport-0.7.2-settings-in-handshake.patch
cargo build --release -p series-server && cp target/release/series-server /tmp/before && git checkout patches/
lab/firefox-dial/run.py --builds before=/tmp/before,after=/tmp/after --rounds 30 --out rows.jsonl
lab/firefox-dial/run.py --summary --out rows.jsonl
```

**A visit** is its own `series-server` (the smoke fixture; the dial reads no frame), relay
(`link_impair.py`, 20 ms each way, the rate, a 200-packet queue, on core 3 at `chrt -f 50`) and headless
Firefox with a fresh profile on cores 0–2. `index.html` dials a bare `WebTransport` with the
certificate's hash and reports `ready` or its rejection, or *unsettled* at the downloader's 5 s deadline.
(link × build) visits run in a Williams order each round (`lab/scripts/order.py`).

**Finding the cause.** One visit at 5 Mbit with `RUST_LOG=quinn_proto=trace,wtransport=trace` on the
server, against one at 50 Mbit: the server's log shows the QUIC handshake completing both times; what
differs is the server's control stream, whose SETTINGS are written at 50 Mbit and never at 5.

**Pins.** Firefox 157.0.1 (conda-forge `firefox-157.0.1-hee9eb32_0.conda`, SHA-256
`f1b53de244dc14b0a0d2d848aa41d7cf0edb95992cd477dccac40ff4d7127f35`, by micromamba 2.9.0,
`micromamba-2.9.0-0.tar.bz2` SHA-256 `8761c382127e6363bd9e0a2451aa3ef90d071a79133f736e2f759a3bf13040dd`);
quinn 0.11.11, quinn-proto 0.11.18, wtransport 0.7.2 as `Cargo.lock` pins them. Nothing fetched or
built is committed.
