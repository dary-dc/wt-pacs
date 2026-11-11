state: done
started: 2026-11-11T14:40Z
heartbeat: 2026-11-11T14:47Z
outputs: claude/phone-protocol 9bbf77e6 (docs/devices.md §7 Amendment), 03c9345b (docs/lines/optimal-quality.md); draft PR #359 (existing, into claude/demo-fixes-0)
## Resume
Done. Nothing left to continue.
## Result
* docs/devices.md §7 *Amendment*, written before any run by a session that will not run it.
* (1) Controller arm: cubic-restart and bbr each on their own pair of servers (4433/4434, 4443/4444) and static host
  (8765, 8766), so the port picks the controller and arms alternate load by load; crossed with page/worker in Williams
  quads of four. Every arm runs one build, `--features telemetry` (target/telemetry), with WTPACS_LOSS_TRACE and path
  rows every 250 ms; CC trace off. Loss classed per event by LOSSCLASS's q* = max(4 ms, minRTT/8), the mix read from
  cubic-restart sessions only (bbr misreads 30-41 %). Telemetry cost assumed < 1 %, same in every arm. bbr is BBRv1
  at a 240 kB first window, as shipped. The tether has no radio (a control); Wi-Fi is one AP; nothing about cellular
  or a neighbour; counts, not rates.
* (2) Size: 56 loads, ~1 h 55 min (assumption). Cuts: one timed series (dbts_b1-q8-g8; a1-cut eye check only),
  12 pooled ratios per link per comparison (>= 10 of 12, median <= 0.95); a fallback to 8 of 8 if block 1 > 20 min.
* (3) Stored form out. (4) Commands from any state for the laptop without installs.
* Checked: the telemetry build compiles (cloud container); serve() starts both controllers (banner names each,
  telemetry=compile-time, loss traces open); bash -n on the commands. Not run: a session through it, the namespace
  harness, the gate (docs only), a phone.
* Owner decisions: none new. A bbr verdict changes no default alone; Part B still waits on the status line (DEMO-UX 2).
