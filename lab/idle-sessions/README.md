# idle-sessions

What an idle session survives in a real Chromium: `idle-hold.html` dials, takes frame 0, sends nothing for
`hold` ms, then asks for frame 1 — **alive means the frame arrived**, not that the handle still exists. The
reading, with the keep-alive pair it chose, is [`docs/adr/transport-idle-sessions.md`](../../docs/adr/transport-idle-sessions.md)
§What a real Chromium does. The native side — many held sessions and what they cost the server — is
`window-harness`'s `idle_sessions` under `lab/scripts/idle_session_cost.sh`, §What an idle held session costs.

```bash
# README.md §Quick start, steps 1–4, with the server's pair set per cell:
cargo run --release -p series-server -- --port 4433 --series fixtures/us_cine_smoke/us_cine_smoke.sbnd \
  --max-idle-timeout-ms 60000 [--keep-alive-interval-ms 20000]
python3 server/dev-server.py --port 8765
# then, in Chromium: http://127.0.0.1:8765/lab/idle-sessions/idle-hold.html?hold=45000
```

The page logs to itself and leaves `globalThis.__wtpacsResult` (`alive`, `why`, `closed`) for a driver. The
browser's own pings are read from its `--log-net-log`.
