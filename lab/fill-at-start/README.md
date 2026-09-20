# fill-at-start

When the first fill leaves, with the fill posted after `started` against the fill handed to
`start`. The numbers live in [`docs/proposal-downloader.md`](../../docs/proposal-downloader.md)
§The first fill handed to `start`; this says how they were made.

```bash
./server/scripts/gen_dev_cert.sh
cargo build --release -p exact-server
./target/release/exact-server --port 4433 --study lab/fixtures/queue_large/queue_large.sbnd
python3 server/dev-server.py --port 8765
NODE_PATH=$(npm root -g) node lab/fill-at-start/run.mjs --rounds 12          # loopback

# and again over a 50 ms round trip, which is what the target link looks like:
python3 lab/scripts/link_impair.py --udp 5555:4433 --delay-ms 25
#   then point client/dev-transport.json's wt_url at https://127.0.0.1:5555/ and re-run
```

Two arms, one fresh page and one fresh session each: **after**, the page awaits `started` and then
calls `fill()`; **start**, the same indices handed to `connect` so they ride in the `start` message.
Decode is off, so "received" is the frame's bytes in the downloader's worker and nothing waits on a
decoder. Every round runs both arms in each cell with the arm order reversed on odd rounds.

Three cells, all measured from the page's call to `connect()`:

* **free** — nothing holds the main thread.
* **blocked 300 ms from inside `connect()`'s own task** — the busy loop starts before the task that
  created the worker has ended.
* **blocked 300 ms from 25 ms in** — the worker is alive and dialling when the loop starts, and
  `started` has not come back yet. This is the viewer's ordering, and 25 ms is tuned to this host:
  on loopback `started` is back ~5 ms after the worker is alive, so the cell is bimodal there and
  only the impaired link resolves it.

**Read before trusting a number.** The study is `lab_queue_large` — realistic byte sizes, not valid
HTJ2K — which is why decode is off. `the downloader has the fill` is when it holds the indices, not
when they hit the wire: on the `start` arm that is before the dial, on the `after` arm
after it, so the two are different events and the row is a measure of the page being out of the
path, not of wire time. The receive rows are the like-for-like comparison.
