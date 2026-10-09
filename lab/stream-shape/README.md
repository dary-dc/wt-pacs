# The stream shape under loss, in a browser

HOL1 (queue row 78): `series-server --stream-mode shared | per-frame` behind
`lab/scripts/link_impair.py` at 20 Mbit / 80 ms, the raw TS client in headless Chromium. Each run
is a fresh server and relay; a fill, timed per frame, then a run of asks at a fixed depth, each
timed from its own send. Arms rotate inside every round.

```bash
export NODE_PATH=$(npm root -g)
node lab/stream-shape/run.mjs --sweep 1-6 --rounds 3 --out sweep.jsonl      # each arm's D_min
python3 lab/stream-shape/summarize.py --sweep sweep.jsonl
node lab/stream-shape/run.mjs --cell loss1 --depth shared=3,per-frame=3 --out loss1.jsonl
python3 lab/stream-shape/summarize.py loss0.jsonl loss1.jsonl loss3.jsonl burst.jsonl
```

Cells: `loss0`, `loss1`, `loss3`, `burst` (Gilbert–Elliott). The rule the numbers were read by,
fixed before the first run, and the results: [`docs/adr/stream-shape.md`](../../docs/adr/stream-shape.md) §HOL1.

`--tax` (row 97) is a different cell on the same page: depth-1 asks on a fresh session with arms
`ws` (the WebSocket through the relay's TCP plane, an ideal-TCP floor), `cc:<controller>` and
`iw:<bytes>`, at `--rate`, `--queue` and `--rtt`, in a Williams order with a self-timed relay; it
prints each arm's ask over RTT + size/rate.

```bash
node lab/stream-shape/run.mjs --tax --rate 25000 --queue 50 --rtt 60 --rounds 8 --asks 30 \
  --arms "ws cc:cubic cc:bbr iw:38400"
```

Results: [`docs/transport/transport-conclusions.md`](../../docs/transport/transport-conclusions.md) §5, TAX.

`--tun` (row 108) runs the same page through the packet-layer relay inside `unshare -rn`, so the
WebSocket is kernel TCP under the same loss as QUIC; `ws:<controller>` sets the server's TCP
controller with `tcp_cc.c` (the host's default is not Cubic everywhere — here it is BBR), and cells
`ge0.5 ge1 ge2 ge4` are Gilbert–Elliott at that mean. `lab/scripts/askl_cells.sh` runs the five
cells and `askl.py` reads them; `askl.py --fill` reads a fill's gaps between frames.

```bash
lab/scripts/askl_cells.sh /tmp/askl 9 "cc:cubic ws:cubic cc:bbr ws:bbr"
```

Results: [`docs/transport/transport-conclusions.md`](../../docs/transport/transport-conclusions.md) §5, ASKL.
