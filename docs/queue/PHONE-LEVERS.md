state: started
started: 2026-11-18T00:17Z
heartbeat: 2026-11-18T00:21Z
outputs: claude/phone-round (PR 400)
## Resume
Design (nothing pushed yet on claude/phone-round): three levers through the viewer's lab gate, all in lab/ —
`?decoders=N` (1–8, sets opts.decoders; recorded on every round record with hardwareConcurrency);
`?exactFill=1` (arm C2: after the view's fill a second downloader fills the whole exact series, every frame
checked by its XXH3, span recorded); `?bench=<frames>` (cell 1: coded bytes fetched with decode:false, then held,
then decoded by N client/decode/decoder.js workers, decodeEnd − decodeStart per frame, effective = span ÷ n).
New file lab/devices/bench.js; round-page.js wires them; round.py PAGE_KEYS; roundOrder gains cell 1 and C2.
Builds: cargo release series-server pack-series, ingest/tools.sh, ts build (logs in the session scratchpad).
Next: write, test (round.test.mjs, levers.test.mjs, round_headless.sh), mutate, gate, push.
## Result
