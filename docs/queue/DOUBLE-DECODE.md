state: started
started: 2026-11-10 08:22
heartbeat: 2026-11-10 08:35
outputs: claude/double-decode-check c83a7465 (test 59d61a4d, fix c83a7465), draft PR #349 into claude/core
## Resume
Done: traced on claude/core; the demo tip does not exist yet (none of demo-fixes-2/1/0, core-next-fixes, core-next
at 08:21), so claude/core is the only branch checked. Test aFrameAskedDuringAFillIsDecodedOnce in
client/transport/downloader.test.mjs fails on claude/core (frame 5 dispatched twice), passes with the fix.
Next: gate running (wasm-pack installed from crates.io; decoder docker build refused by Docker Hub 429; openjph vendor fetched). Line note done
(30a4e137 on work-ledger docs/lines/client.md). PR #349 open. Then Result with the gate outcome.
  git checkout claude/double-decode-check && node client/transport/downloader.test.mjs
## Result
