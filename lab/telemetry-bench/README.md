# telemetry-bench

The server telemetry pipeline's microbench — no network, no product crate. `emit`: what one row costs on the
emitting thread per seam (`global-lock`, `own-sender`, `own-batch`) as producers grow, and whether the drain
keeps up. `report`: what the drain costs in memory and shutdown time per shape (`current`, `streaming`) as rows
grow. The reading is [`docs/adr/telemetry-server-pipeline.md`](../../docs/adr/telemetry-server-pipeline.md)
§Pipeline baseline, 2026-09-06.

```bash
lab/scripts/telemetry_bench_matrix.sh [out.jsonl]    # the whole matrix, one JSON object a line
cargo run --release -p telemetry-bench -- emit --seam own-batch --producers 16 [--sink count|json-file|binary-file]
cargo run --release -p telemetry-bench -- report --shape streaming --rows 1000000 --out-dir /tmp/t [--offline-exact]
```

The gate compiles it (`scripts/gate.sh`), so its variants stay buildable.
