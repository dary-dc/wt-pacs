state: done
started: 2026-11-11T19:49Z
heartbeat: 2026-11-11T20:50Z
outputs: claude/demo-network 4254c993, draft PR #372 into claude/demo-fixes-2
## Resume
Done. Commits: 8e84bcda (test first, failing), cc90ffea (scripts/demo-network.py + gate line), 445b29fd
(docs/devices.md §8), 0eb91921 (README §Demo "On arrival"), 4254c993 (lines/optimal-quality.md). Nothing left.
## Result
* README §Demo "On arrival": links in order — room Wi-Fi, phone hotspot (laptop on it), tether, rehearsal screen
  recording — each via the existing "Each time, from any state" block, then the check; a table of what the phone's
  page shows per failure (no page: TCP/isolation; `error: connect:`: UDP 4433; slow fill: throttled; no lossless
  button + `error: lossless:`: UDP 4434).
* scripts/demo-network.py: the laptop's half (ports listening on the dialed address via /proc/net, transport files'
  hash, certificate ≤ two weeks and past --until). 8 tests in the gate, 8 mutants killed. Checked with two real
  series-servers + dev-server --bind; one stopped → FAIL by port.
* docs/devices.md §8: RFC 9308 §2, RFC 9312 §4.6, W3C WebTransport CRS 2026-07-30 (requireUnreliable; custom
  certificate requirements; §14.4). No TCP fallback: series-server is HTTP/3 only, WebSocket off unless --websocket.
* The phone's UDP cannot be seen from the laptop without root; the page is the phone's half. Not run in a room or
  on a phone; client isolation is unsourced (a vendor setting).
* Gate: --quick, green (decoder rebuild, absence checks, ingest/GL steps skipped by name).
* Owner decision: renew the dev certificate at the rehearsal, 1–9 days before the demo, never on arrival (a
  just-made certificate fails on a phone whose clock is behind: derived, not tried). PR #372 waits for the owner's
  word under the freeze.
