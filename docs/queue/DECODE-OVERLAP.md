state: started
started: 2026-11-24T12:47Z
heartbeat: 2026-11-24T12:52Z
by: anen2iBQ
outputs: claude/decode-overlap (from origin/claude/unified), PR pending
## Resume
Step 1 (the share). Pushed: `claude/decode-overlap` 953ae7d11, lab/decode-bench/read-share (page.js stamps the
VideoDecoder output callback; client/decode unchanged). Fixture coding with BUILD absolute (relative BUILD fails
meson's prefix): ingest/tools.sh done, fetch dbts_b1 done, then ingest_coded.py --codec htj2k and --lossy 8 8
--exact-series dbts_b1 into demo-series/, pack-series. Next: `node lab/decode-bench/read-share/run.mjs
demo-series/dbts_b1-q8-g8.sbnd 8 --rounds 4 --out lab/decode-bench/read-share/rows.jsonl`; push rows; under 10 %
ends done, building nothing.
## Result
