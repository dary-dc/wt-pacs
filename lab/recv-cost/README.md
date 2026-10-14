# recv-cost

Receive CPU per MB of a whole-series fill, per client stack: queue row 135 (RECVCOST) of
[`docs/av1/queue.md`](../../docs/av1/queue.md), the protocol N1 in [`docs/native/quic.md`](../../docs/native/quic.md) §6.
The reading is beside the protocol there.

```bash
cargo build --release -p series-server -p pack-series
(cd lab/recv-cost && cargo build --release)          # outside the workspace: Cargo.toml says why
python3 lab/recv-cost/run.py make DIR                # 800 x 250 KB and 800 x 32 KB of random bytes, their SHA-256s, packed
python3 lab/recv-cost/run.py run DIR --rounds 7 --out rows.jsonl
python3 lab/recv-cost/run.py summary rows.jsonl
```

Standard-library Python; `CHROME_PATH` names the browser (default the lab's
Playwright Chromium 141).
