# An ask during a fill (ASKAHEAD)

Does a send window that follows the congestion window shorten an ask during a fill, at no cost to the fill?
The protocol, its predictions and its rule are [`../../docs/transport/link-conditions.md`](../../docs/transport/link-conditions.md)
§Re-measured, proposed; the results are its §Measured.

* `make_series.py SETDIR OUT` — a fetched set (`lab/av1/fetch_data.sh dbt10_ea1141`) as the served HTJ2K, every frame
  decoded natively and matched with the checksum written at fetch, packed into `OUT/series.sbnd`; `OUT/digests.json`
  holds each codestream's SHA-256. Needs OpenJPH (`lab/scripts/gen_htj2k_fixtures.sh` builds it), numpy and
  `target/debug/pack-series`.
* `cells.py OUT ROUNDS CELL ...` — `CELL` is `RATE_MBIT/RTT_MS/QUEUE`, `QUEUE` `fifoMS` (a tail-drop FIFO of that many
  ms at the rate) or `codel` (`--codel 5:100` over an 800 ms FIFO). Per round and cell, today's server and
  `--send-window-follows-cwnd` in a Williams order; each run starts its own release server and relay
  (`lab/scripts/link_impair.py --self-timing`, under `chrt -f $RELAY_CHRT` when set); one headless Chromium
  (`visit.mjs`) loads `index.html` for every run. One JSON row per run: the ask's time to its frame, the fill's issue
  to its last frame, the fill frames that landed between the ask and its frame (`ahead`), whether every frame's
  SHA-256 matched, the longest wait between two fill frames becoming usable in order (`gap_ms`), the server's cwnd
  when it wrote the ask (`cwnd_at_ask`), its peak RSS over its idle RSS, its `session path` line, the relay's p99
  and `VOID`. A `CELL` of `RATE/RTT/QUEUE/lossP` adds `P` % iid loss. `ARMS` names any set of arms, a bare name
  being today's server: STREAMSMEASURE (row 180) ran `ARMS="shared,window=--send-window-follows-cwnd,perframe=--stream-mode
  per-frame,asksfirst=--stream-mode per-frame-asks-first"`, read by `streams.py`.
  Needs the client bundles (`client/transport/ts/build.sh`, `client/transport/wasm/build.sh`) and playwright.
* The page (`page.js`) fills the whole series through the product's downloader with decoding off and, once half has
  landed, asks for the last frame.
