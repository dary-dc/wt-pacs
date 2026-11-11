state: done
started: 2026-11-11 02:08
heartbeat: 2026-11-11 02:40
outputs: claude/phone-protocol 8d4d4f73 (from claude/demo-fixes-0 36d286cd), draft PR #359 into claude/demo-fixes-0
## Resume
Done. docs/devices.md §7 and a line note in docs/lines/optimal-quality.md.
## Result
* docs/devices.md §7: page view against view worker alternated load by load, tether against Wi-Fi in blocks
  T W W T, 10 pairs per link per series (dbts_a1-q8-g8-cut, then dbts_b1-q8-g8); readings, eye checks, decision rules
  (correctness per load; fill as a sign test on 10 paired ratios: >= 9 of 10 and median <= 0.95), where a phone run
  shows nothing, and commands for the laptop without installs (need claude/phone-no-install's --bind and OPENSSL=).
* Finding (page CSS in headless Chromium, desktop fonts, not a phone): the status line is cut with an ellipsis, 49
  chars at 412 px and up to "codec a" at 915 px, so fill time, renderer and the last error are not visible on a phone.
* Finding: touch cannot step slices (wheel and keys only), so End, the mid-group jump and fill=0's jump can't be done
  by touch.
* Checked: bash -n on the commands. Not run: the namespace harness, the gate (docs only), a phone.
* Owner decisions: let the status line wrap (or show fill and error) so that Part B can run, a one-line CSS change
  for FIX-1; a touch way to step slices; merge claude/phone-no-install first, because the commands use it.
