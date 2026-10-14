# Link conditions

The sources and the two summaries behind [`docs/transport/link-conditions.md`](../../docs/transport/link-conditions.md)
(queue row LINKREAL). Nothing fetched is committed.

```bash
lab/link-conditions/fetch.sh /tmp/links            # every source, checked against SHA256SUMS
python3 -m venv /tmp/lv && /tmp/lv/bin/pip install pyarrow==17.0.0 numpy==2.1.2
/tmp/lv/bin/python -I lab/link-conditions/ookla_tiles.py /tmp/links/2026-07-01_performance_{mobile,fixed}_tiles.parquet
python3 -I lab/link-conditions/mlab_stats.py /tmp/links/mlab-*-2024.json
```
