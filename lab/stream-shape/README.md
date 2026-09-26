# The stream shape under loss, in a browser

HOL1 (queue row 78): `exact-server --stream-mode shared | per-frame | pool:<k>` behind
`lab/scripts/link_impair.py` at 20 Mbit / 80 ms, the raw TS client in headless Chromium. Each run
is a fresh server and relay; a fill, timed per frame, then a run of asks at a fixed depth, each
timed from its own send. Arms rotate inside every round.

```bash
export NODE_PATH=$(npm root -g)
node lab/stream-shape/run.mjs --sweep 1-6 --rounds 3 --out sweep.jsonl      # each arm's D_min
python3 lab/stream-shape/summarize.py --sweep sweep.jsonl
node lab/stream-shape/run.mjs --cell loss1 --depth shared=3,per-frame=3,pool:2=3,pool:4=3,pool:8=3 --out loss1.jsonl
python3 lab/stream-shape/summarize.py loss0.jsonl loss1.jsonl loss3.jsonl burst.jsonl
```

Cells: `loss0`, `loss1`, `loss3`, `burst` (Gilbert–Elliott). The rule the numbers were read by,
fixed before the first run, and the results: [`docs/adr-stream-shape.md`](../../docs/adr-stream-shape.md) §HOL1.
