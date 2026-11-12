state: started
started: 2026-11-12T09:21Z
heartbeat: 2026-11-12T09:25Z
outputs: claude/link-calibration (from claude/phone-rows 5c54f446; f3ce8e73 lab/phone/link.py + test)
## Resume
Branch claude/link-calibration from claude/phone-rows 5c54f446, worktree ../wt-lc. Line doc: docs/lines/optimal-quality.md.
DONE f3ce8e73: lab/phone/link.py + link_test.py (in scripts/gate.sh; 9 mutants killed). Run:
  X=$(cat docs/phone-rows/raw/excluded-ids.txt); python3 lab/phone/link.py docs/phone-rows/raw dbts_b1-q8-g8 --exclude $X --orphan 4443:10
Findings: path rows' min_rtt is the min of 250 ms samples of quinn's SMOOTHED rtt, frozen once the fill stops (no acks
after it); true min (loss trace, quinn's min_rtt): tether cubic 0.61-0.78 ms, Wi-Fi 1.5-2.5 ms. So 6.1 vs 2.2 is the
fill's standing queue under Cubic vs BBR's pacing, not the path. Peak 250 ms send: tether ~265 Mbit/s both controllers
(the USB path's ceiling); Wi-Fi bbr median 599 (cubic 179, loss-bound). Queue at loss: Wi-Fi cubic median 39.5 ms
(max 151), bbr 21 (max 50); tether cubic 18 (max 26).
Next: docs/transport/link-calibration.md (profile, compare with lab profiles, the relay's ceiling vs 600 Mbit, limits);
gate line uses python3 -> "$PYTHON"; docs/lines/optimal-quality.md Open 5; README phone-rows min RTT row corrected in place.
## Result
