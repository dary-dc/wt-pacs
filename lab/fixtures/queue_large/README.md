# lab_queue_large

Synthetic SBND for window/HoL harness — **not** valid HTJ2K, but **realistic byte sizes** (~41–61 KB per frame, mean ~51 KB).

```bash
cargo run -p pack-study -- \
  --metadata lab/fixtures/queue_large/metadata.json \
  --frames lab/fixtures/queue_large/frames \
  --output lab/fixtures/queue_large/queue_large.sbnd
```
