state: started
started: 2026-11-20T08:00Z
heartbeat: 2026-11-20T10:47Z
outputs: `claude/htj2k-a1` (rows to land in `lab/htj2k-tiles/improve/rows/a1-*.jsonl`; PR 408)
## Resume
Both shards done (288 rows pushed, `f569d290`, then shard 2's file); readings in `docs/htj2k-tiles.md` §A1, measured and
`docs/lines/codecs.md` Open 7 (`34131271`); PR 408's body has §HTJ2K-A1-RUN. Next: `scripts/gate.sh --quick` on the tip
(running), then state done. If resumed: run the gate (`PYTHON=lab/av1/.venv/bin/python scripts/gate.sh --quick` after
`client/transport/wasm/build.sh`, `fetch_openjph.sh`, `fetch_xxh3.sh` and the WASM decoders built), write the Result.
## Result
