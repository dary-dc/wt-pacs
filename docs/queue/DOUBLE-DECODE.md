state: started
started: 2026-11-10 08:22
heartbeat: 2026-11-10 08:50
outputs: claude/double-decode-check c83a7465 (test 59d61a4d, fix c83a7465); PR not yet opened
## Resume
Done: traced on claude/core; the demo tip does not exist yet (none of demo-fixes-2/1/0, core-next-fixes, core-next
at 08:21), so claude/core is the only branch checked. Test aFrameAskedDuringAFillIsDecodedOnce in
client/transport/downloader.test.mjs fails on claude/core (frame 5 dispatched twice), passes with the fix.
Next: gate (`client/decode/wasm/build/build.sh`, `ingest/tools.sh`, `scripts/gate.sh`, or claude/gate-cloud's
README setup), docs/lines note, draft PR into claude/core (claude/core-next absent), then Result.
  git checkout claude/double-decode-check && node client/transport/downloader.test.mjs
## Result
