state: started
started: 2026-11-15 14:26 UTC
heartbeat: 2026-11-15 14:42 UTC
outputs: claude/mobile-decode (docs/decode/mobile/hw-inverted.md), PR 397 (draft, existing)

## Resume

2026-11-15 17:18 UTC: a firing found this row stalled by its heartbeat, but `claude/mobile-decode` still taking C2 rows
(b6f85f3c at 17:07, `/proc/stat` samples to 17:06): the run is alive, so the claim was dropped and nothing run. The
next firing resumes only once the rows have stopped for 20 minutes.

Done: hw-inverted.md §1–§7, §10–§13 (claude/mobile-decode 58582086): per-engine sources (Chromium 157 and 158,
WebKit 19c5103d, Firefox release dc1259ae, Vulkan, OES_EGL_image_external, HTML, Android, vendors), the 220-level
window, the check's cost, calibration, levels, columns, phone asks. §8 pre-registration 2f0a87cf, amendment 76ebab6d.
Running: C1 and C2 by lab/decode/mobile/hw-inverted/measure.py (rows in rows/c1.jsonl, c2.jsonl; it skips rows
present, so a resume reruns the same command from its README). Next: §9 results with every prediction, then §1 and
§12 updated by the numbers, docs/lines/client.md §Open one line, done. Brief unchanged since start (amendment 21).

## Result
