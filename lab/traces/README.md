# Lab traces

| Trace | Use | Notes |
| ----- | --- | ----- |
| `fly_and_settle.json` | **obsolete** for depth/E4 | `frame_modulo: 3` — dead cell at 51 KB/5 Mbps; void results |
| `reversal_storm.json` | E2 (legacy) | only frames 0–2; replace with `live_cell_scroll` |
| `dense_scrub.json` | cross-validation | same modulo trap |
| `live_cell_scroll.json` | **E0, E4 gate, E2** | ≥300 unique, ~9 f/s, reversal @ 60%. Needs `frames_250k_live` study |

Generate:

```bash
lab/scripts/gen_live_cell_fixture.sh
python3 lab/scripts/gen_live_cell_trace.py
```

Primary live cell: **250 KB @ 10 Mbps** (demand/supply ratio ~1.8). Report ratio alongside every result.
