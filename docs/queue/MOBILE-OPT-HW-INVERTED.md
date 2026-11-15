state: started
started: 2026-11-15 14:26 UTC
heartbeat: 2026-11-15 14:31 UTC
outputs: claude/mobile-decode (docs/decode/mobile/hw-inverted.md), PR 397 (draft, existing)

## Resume

Done: §8 of docs/decode/mobile/hw-inverted.md pre-registers C1 (220-level form, 19 volumes) and C2 (second picture,
3 volumes), predictions in lab/decode/mobile/hw-inverted/predictions.json (claude/mobile-decode 2f0a87cf). C1/C2 run
by lab/decode/mobile/hw-inverted/measure.py (being written); rows land in rows/c1.jsonl, c2.jsonl. Next: per-engine
sources for §2–§6 (Chromium 157 and stable on Android, desktop Chromium, WebKit, Gecko), the window arithmetic at
220, §2.1 levels, then §9 results. A resume continues the cells from the rows (measure.py skips rows present).

## Result
