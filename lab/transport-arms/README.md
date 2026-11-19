# transport-arms: HTJ2K over WebTransport, a WebSocket, HTTP/3 and HTTP/2 fetch

The build of `claude/transport-design` `c74d4bea:docs/transport/evidence/stacks.md` §5.6, for the
protocol of §5 as pre-registered. Nothing here is a result: the counted rows are TRANSPORT-RUN's.

| file | what |
| --- | --- |
| `server/src/transport/lab_get.rs` | §5.6 item 1, series-server `--features lab-get`: `--lab-get-port P` answers `GET /frames/K` and `/frames/K-N` with envelopes as the shared stream carries them, HTTP/3 on UDP P, HTTP/2 (TLS 1.3) on TCP P; `--lab-get-static DIR` serves the page from the frame server (cell FP); `--lab-get-drop F` is a mutant; `--lab-tcp-congestion NAME` sets each accepted TCP socket's controller (`TCP_CONGESTION`), the GET path's HTTP/2 and the WebSocket's |
| `fetch-session.ts` | §5.6 item 2, the fetch carrier behind the downloader's transport seam: `?shape=frame` (one GET a frame, `k` = 6 in flight in the fill's order) or `?shape=fill` (one GET a run; an ask aborts it and GETs the frame, and the downloader GETs the rest on the frame's head); every frame response's `nextHopProtocol` posted on the `transport-arms` channel |
| `page.html`, `page.js` | one visit: the cell's action through the downloader, every frame checked by its decoder against the series' XXH3-64 |
| `run.mjs` | §5.6 item 3, the driver: the relay's TUN plane in a user and network namespace of its own, the server in the relay's server namespace, a fresh browser a visit, the arms in a Williams order (`lab/order.mjs`), the A/A arm, §5.4's `VOID` reasons, the checks that stop the run, the samplers |
| `fixture.sh` | the build's test series: 12 synthetic HTJ2K frames, 2048², ~6.5 MB each, with their digests |

## Run

Needs, past `README.md` §Prerequisites: `iproute2` (`ip`, `ss`; the cloud image lacks it: `apt-get install -y iproute2`),
`/dev/net/tun`, `unshare`, `nsenter`, `taskset`; numpy and xxhash for `fixture.sh`; `wasm-pack` and the
`wasm32-unknown-unknown` target for the WT-WASM arm (`client/transport/wasm/build.sh`). The driver re-runs itself under
`unshare -rn`, builds `series-server --features lab-get` and the carrier's bundle, and pins the relay to core 0, the
server to core 1 and itself, so the browser, to cores 2–3.

```bash
OUT=lab/transport-arms/.series lab/transport-arms/fixture.sh            # the build's test series (or the run's, below)
node lab/transport-arms/run.mjs --cell CLEAN --pilot                     # two rounds, not counted; rows to rows/CLEAN-pilot.jsonl
node lab/transport-arms/run.mjs --cell CLEAN [--rounds 8] [--pilot-medians FILE] [--limit-ms 120000]
    [--lte-frames N] [--loss-frames N] [--arms A,B,…] [--series DIR] [--out FILE]
```

Cells and forms are §5.3's, in `run.mjs`'s `CELLS`; a series shorter than a form's frames serves a prefix and says so.
Each visit appends one JSON row as it lands: the cell, form, round, arm and predecessor; `v`, the cell's metric in ms;
`hol` (LOSS); every frame's ask and last-byte stamps and check, and `dial`; `protocols`; `tcpCongestion`, the
controllers the server's sockets ran (`ss -tin`, read after the metric and before the page closes); the browser's
`switches`; the server's `utime + stime` ticks (CPU), host
softirq ticks, the browser tree's CPU ms (CPU-C), the busiest core; the relay's tally with its bytes server → client by
flow (BYTES); under AA, `ss -tin` in the server's namespace before the ask. The first visit of a cell also carries the
server's banner, the relay's arguments and both namespaces' `tcp_congestion_control`, `tcp_slow_start_after_idle`,
`tcp_rmem`, `tcp_wmem`. The summary prints each arm's median ratio to WT-TS and an `UNBALANCED` flag, and writes
`aa_rule.py`'s input beside the rows (`lab/scripts/aa_rule.py rows/CELL.FORM.aa.json --bar 0.05`).

**`VOID`** (kept in the rows, with its reason): the relay's guard p99 over 1 ms, a core over 95 % busy, a fetch arm on
the wrong protocol, a crash, a visit past 3× the pilot's median (`--pilot-medians`, `{"FORM/ARM": ms}`). **The run stops**
on a frame that failed its check, whatever else voids the visit; on a visit that did not deliver every frame exact, unless it is `VOID`; on a WT or WS frame asked after the dial; the pilot also stops when the relay's loss is not within 3× of the
configured mean, judged per visit, and over a form's visits pooled where one visit is too short to judge (0.1 % loss).

**The run's series** is `dbts_b1` as HTJ2K (§5.2), never committed:

```bash
lab/av1/fetch_data.sh dbts_b1
$P lab/av1/tools/ingest_coded.py ingest/.build lab/av1/data/dbts_b1 OUT --codec htj2k
target/release/pack-series --metadata OUT/metadata.json --frames OUT --output OUT/series.sbnd   # then --series OUT
```

## Where the build departs from §5's text

Both amended into `stacks.md` §5.7 on `claude/transport-design` (`0464fc8c`), dated, before any counted row.

* **The GET path's HTTP/3 is a quinn endpoint of its own**, not "the same quinn endpoint" (§5.6 item 1): a WebTransport
  dial and a `fetch` both offer ALPN `h3`, so one endpoint cannot route them before wtransport reads the CONNECT. It is
  built from the same `TransportTuning::to_transport_config()` in the same process, which holds §5.1's "the same
  controller and initial window as WT"; the port differs, and Chromium's `--origin-to-force-quic-on` names it.
* **An ask's t₀ is the page's call**, one `postMessage` before the worker's (§5.3: "the worker's first call"): a frame
  the fill still owes keeps the fill's ask stamp in the downloader's record, so the worker's own stamp is not the ask's.
  The hop is the same for every arm.

## Checks, and their mutants (§5.6)

Each run 2026-11-18 on the test series at CLEAN (LOSS for the relay's), and each fired:

| check | mutant | what it gave |
| --- | --- | --- |
| a fetch arm on the wrong protocol is `VOID` | `--mutate wrong-protocol`: no force-QUIC switch, so H3-fill speaks h2 | `VOID spoke h2, not h3` |
| a frame not delivered exact stops the run | `--mutate drop-frame`: the GET bodies leave frame 0 out | `STOP: 11 of 12 frames exact`, exit 3 |
| the pilot holds the relay to its configured loss | `--mutate relay-no-loss`: the relay at 0 % where 1 % is asked | `PILOT REFUSES: relay loss 0.000 %, asked 1 %`, exit 3; unmutated, 1.03 % |
| the order is a Williams square | `--mutate fixed-order`: the same order both rounds | `UNBALANCED: WT-TS WS H2-fill`; unmutated, none |
| the server's CPU is read from its pid | `--mutate cpu-wrong-pid`: the relay's namespace holder | `CPU ZERO: the sampler read nothing` (flagged in CLEAN only: a one-frame visit can pass in under a server tick) |
| the H2 and WS arms' server sockets run `cubic` (§5.1), read back by `ss -tin` in the server's namespace each visit | `--mutate default-congestion`: no `--lab-tcp-congestion`, so the kernel's default (`bbr` here) | `STOP: the server's TCP ran bbr, not cubic`, exit 3 (2026-11-18, FF) |
| a WT or WS fill rides the dial's URL (the opening ask, §5.1) | `--mutate no-opening`: the page fills after `connect` | `STOP: frame 0 asked after the dial, not by the opening ask`, exit 3 (2026-11-18, FF) |

`judge.mjs` holds the verdict (§5.2, §5.4); `node lab/transport-arms/judge.test.mjs` (in the gate) states each rule and
fails on the review's B1–B3 reverted.

The GET path's own test (`cargo test -p series-server --features lab-get --lib -- a_get_answers`) killed two mutants:
the drop applied to the wrong frame, and the envelope's head left out.

## Limits

One 4-core container, headless Chromium, the userspace TUN relay at ≤ 90 Mbit (`docs/rig-limits.md` §3), no radio.
The build was checked on the synthetic test series only (12 frames of ~6.5 MB, three times `dbts_b1`'s).
