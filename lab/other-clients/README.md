# Other clients

Lever 2 (the server's SETTINGS in its first flight) against every HTTP/3 or WebTransport client
this box could run, with lever 2 on and off. Each run goes direct, and again through
`lab/scripts/half_rtt_deaf.py`, which turns any client into one that ignores 0.5-RTT data. Results:
[`docs/proposal-session-open.md`](../../docs/proposal-session-open.md) §Other clients.

| client | what it does |
| --- | --- |
| `native` | `cold_open`, the crate's own client (wtransport over quinn) |
| `aioquic_wt.py` | aioquic 1.3.0: waits for SETTINGS, CONNECT, asks frame 0 |
| `go/ wt` | webtransport-go v0.9.0 on quic-go v0.53.0: dial, ask frame 0 |
| `go/ get` | quic-go v0.53.0's HTTP/3 client: waits for SETTINGS, sends a GET |
| `h3/` | hyperium h3 0.0.8 on h3-quinn and crates.io quinn: a GET |

```bash
python3 -m venv /tmp/aq && /tmp/aq/bin/pip install aioquic
(cd lab/other-clients/go && go build -o /tmp/goclient .)
(cd lab/other-clients/h3 && CARGO_TARGET_DIR=/tmp/h3t cargo build --release)
VENV=/tmp/aq GO_CLIENT=/tmp/goclient H3_GET=/tmp/h3t/release/h3-get \
  lab/other-clients/cells.sh LEVER_ON_BIN LEVER_OFF_BIN 5
```

The lever-off binary is this tree with `[patch.crates-io]` removed from the root `Cargo.toml`.
webtransport-go is pinned to v0.9.0: from v0.13.0 (draft 15) on, it refuses a server without
QUIC's reset-stream-at extension, with lever 2 on or off.
