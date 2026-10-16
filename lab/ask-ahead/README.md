# An ask during a fill (ASKAHEAD)

Does a send window that follows the congestion window shorten an ask during a fill, at no cost to the fill?
The protocol, its predictions and its rule are [`../../docs/transport/link-conditions.md`](../../docs/transport/link-conditions.md)
§Re-measured, proposed; the results are its §Measured.

* `make_series.py SETDIR OUT` — a fetched set (`lab/av1/fetch_data.sh dbt10_ea1141`) as the served HTJ2K, every frame
  decoded natively and matched with the checksum written at fetch, packed into `OUT/series.sbnd`; `OUT/digests.json`
  holds each codestream's SHA-256. Needs OpenJPH (`lab/scripts/gen_htj2k_fixtures.sh` builds it), numpy and
  `target/debug/pack-series`.
* `cells.py OUT ROUNDS CELL ...` — `CELL` is `RATE_MBIT/RTT_MS/QUEUE`, `QUEUE` `fifoMS` (a tail-drop FIFO of that many
  ms at the rate) or `codel` (`--codel 5:100` over an 800 ms FIFO). Per round and cell, each of `ARMS` in a Williams
  order (`--send-window-follows-cwnd`, ASKAHEAD's other arm, is now the server's behaviour); each run starts its own release server and relay
  (`lab/scripts/link_impair.py --self-timing`, under `chrt -f $RELAY_CHRT` when set); one headless Chromium
  (`visit.mjs`) loads `index.html` for every run. One JSON row per run: the ask's time to its frame, the fill's issue
  to its last frame, the fill frames that landed between the ask and its frame (`ahead`), whether every frame's
  SHA-256 matched, the longest wait between two fill frames becoming usable in order (`gap_ms`), the server's cwnd
  when it wrote the ask (`cwnd_at_ask`), its peak RSS over its idle RSS, its `session path` line, the relay's p99
  and `VOID`. A `CELL` of `RATE/RTT/QUEUE/lossP` adds `P` % iid loss. `ARMS` names any set of arms, a bare name
  being today's server: STREAMSMEASURE (row 180) ran `ARMS="shared,window=--send-window-follows-cwnd,perframe=--stream-mode
  per-frame,asksfirst=--stream-mode per-frame-asks-first"`, read by `streams.py`; `FIRST_ROUND=k` resumes a campaign at
  round k. `ASK_AT=0.25` asks once a quarter has landed (default half); each row then also holds the fill's bytes
  left at the ask (`fill_left_at_ask`) and the server's smoothed RTT when it wrote the ask (`rtt_at_ask_ms`).
* `askcap.py ROWS.jsonl ...` — ASKFIRSTCAPMEASURE (row 211), asks first under a cap on bytes in flight, read by
  [`../../docs/native/quic-compared.md`](../../docs/native/quic-compared.md) §9.7's rule; its arms are
  `rows-askcap.jsonl`'s header; `rows-askcap-side.jsonl` is its check outside the protocol (`shared` under the same 6 MiB).
* `refill.py ROWS.jsonl` — REFILLMEASURE (row 229), the head re-issue (`TB=?refill=head`) against the former
  trigger (`T`, now `?refill=landed`) and the same again (`Tp`), read by `lab/scripts/aa_rule.py`; a `CELL` of
  `…@AT:ARM,…` asks once `AT` % has landed (`none`: no ask) and runs only the arms named, and an arm's `?key=value`
  token goes to the page's query. Its rows are `rows-refill.jsonl`; `rows-refill-ceiling.jsonl` is the relay's
  ceiling, fills with no ask at 2 ms.
  Needs the client bundles (`client/transport/ts/build.sh`, `client/transport/wasm/build.sh`) and playwright.
* The page (`page.js`) fills the whole series through the product's downloader with decoding off and, once `at` (half
  unless set) has landed, asks for the last frame.
