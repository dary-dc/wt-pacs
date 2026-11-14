state: started
started: 2026-11-14T21:14Z
heartbeat: 2026-11-14T21:18Z
outputs: claude/depth8 (from origin/claude/docs-client)
## Resume
Branch claude/depth8 from origin/claude/docs-client (not yet pushed). Inputs read: the 19 DBT volumes' per-frame σ
and cells from claude/av1-noise-ratio:lab/av1/metrics/rows/shard-{1..4}.jsonl; noise-point.md §2–§3; payload-format.md
§Depth cut, §8-bit grey as 4:2:0. Arithmetic: two stacking models (independent, removal) checked on the top-10 cells
(k = 2 cut) within 0.02 of measured medians. Next: per-volume 8-bit predictions, sources for the hardware and
Firefox/Safari 8-bit paths (claude/hw-decode:docs/decode/hardware.md), write docs/av1/depth8.md + lab script, push, PR.
## Result
