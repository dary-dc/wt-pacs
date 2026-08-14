# Fixtures

## SBND study bundle

On-disk layout:

```text
magic "SBND" · version u32 · metadata_len u32 · frame_count u32
frame_table[frame_count]: offset u64 · length u32
[UTF-8 metadata JSON]
[concatenated HTJ2K codestreams]
```

Pack with `cargo run -p pack-study -- --metadata … --frames … --output ….sbnd`.

Smoke fixture: `fixtures/us_cine_smoke/` (metadata + optional frame files).
