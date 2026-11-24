state: started
started: 2026-11-24T12:47Z
heartbeat: 2026-11-24T12:48Z
by: anen2iBQ
outputs: claude/decode-overlap (from origin/claude/unified), PR pending
## Resume
Step 1 (the share) in progress. Fixture: `dbts_b1` exact and `dbts_b1-q8-g8` coded into demo-series/ by
ingest/tools.sh, lab/av1/fetch_data.sh dbts_b1, ingest_coded.py --lossy 8 8 --exact-series dbts_b1, pack-series
(README §Demo; the script is demo-series.sh's ingest() for one set). Next: a lab stamp at the WebCodecs frame-out
in client/decode/av1-webcodecs.js (lab-gated), read in headless Chromium at 1x and 4x CPU throttle; share < 10 %
ends the row done, building nothing.
## Result
