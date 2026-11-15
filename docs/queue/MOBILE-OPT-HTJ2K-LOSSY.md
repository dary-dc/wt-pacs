state: started
started: 2026-11-15 14:28 UTC
heartbeat: 2026-11-15 15:19 UTC
outputs: claude/mobile-decode (docs/decode/mobile/htj2k-lossy.md), PR 397 (draft, existing)
## Resume
Done: pre-registration (f6f0416d); lab/av1/htj2k-lossy/ scripts and Cell B rows so far (aced74df). Cell B running
(measure.py, output /home/user/work/cell-b.jsonl copied into rows/ at each push; the script resumes from its rows file).
Seen so far: native ojph_expand and the WASM build differ by ±1 on lossy frames (x86 rounds ties to even, WASM away
from zero); node and Chromium 153 agree. Brief and amendments re-read at this push: unchanged.
Next: Cell B to its end; streams.py for dbts_b1, dbts_c1 at their 1.00-bar Δ (dbts_a1: Δ 32, done); then Cell D
(bench.mjs, idle host) and Cell E (engines.mjs); report.py; write §1–§10 of htj2k-lossy.md; docs/lines/client.md.
## Result
