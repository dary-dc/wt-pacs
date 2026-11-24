state: started
started: 2026-11-24T13:27Z
heartbeat: 2026-11-24T13:30Z
by: q7oxKe5p
outputs: findings in PR 441's body (claude/session-cost)
## Resume
2026-11-24T13:30Z: read session-cost.md (f1d5a5268) and model.py; arithmetic of §1 and §4 recomputed (holds); §3's counts reproduced
against the product: trace through the real Controller + downloader at b059388b6 with window.test.mjs's stand-in
(5353ae8de) gives dbts_b1 A 796 frames 370.54 MB (model 764), dbts_c1 A 177/15.40 (198), dbts_c1 B 84/87.12 (99);
a1 and b1 B equal. Cause: model.py breaks eviction ties toward the later frame, store.js #farthest toward the earlier.
Next: server RSS (mmap?), CR length vs 60 s, the CPU per-MB intercept, PS3.18 quotes and rendered/viewport, FIT's W;
then findings into PR 441's body and this file's Result.
## Result
