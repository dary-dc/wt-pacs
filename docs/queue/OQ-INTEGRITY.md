state: started
started: 2026-11-11 14:43 UTC
heartbeat: 2026-11-11 15:05 UTC
outputs: `claude/oq-integrity` (from `claude/proposals`), no commit yet
## Resume
Sources read and pinned in scratch (AV1 spec §7.1 "identical in all respects" when film_grain_params_present = 0;
WebCodecs WD 2026-11-09 §7.9 hints, §9.4 copyTo; Chromium dav1d_video_decoder.cc). Repo facts read: demo tip
`claude/demo-fixes-1` decoder.js `checked()`, av1-webcodecs.js `read()`, ingest.py `lossy()` (dav1d already decodes
every frame at ingest), exactness-in-production §3-4 (XXH3 0-15 % of a fill), vl-metrics §4, window-q verdict.
Next: write `docs/lines/proposals.md` §Integrity (I1 reconstruction digest, I2 coding error in metadata, I3 label
and overlay) on `claude/oq-integrity` (local branch from origin/claude/proposals), push, then finish this file.
## Result
