state: done
started: 2026-11-12T01:22Z
heartbeat: 2026-11-12T01:30Z
outputs: claude/phone-rows 5c54f446 (docs/reviews/phone-blind-read.md: ae45eca6 the blind reading, 71f1c3b1 the comparison; docs/lines/optimal-quality.md); no PR (the row names none and the branch is the phone session's)
## Resume
Done. Nothing left to continue.
## Result
Read docs/phone-rows/raw/ against docs/devices.md section 7, its two amendments and the Note before opening the
README; then compared. Fixtures: one phone, one home link, one evening, dbts_b1-q8-g8 only (one DBT volume of one dataset).
Agrees with the run session on: correctness (tether 23 passed, 1 missing; Wi-Fi 22 passed, 2 failed, both bbr), the
six-octet fill verdicts (tether worker/page depends on the controller, bbr/cubic none shown at n = 11; Wi-Fi worker/page
none shown at n = 10, cubic-restart faster 9 of 10, median 1.084), the loss table (all Cubic losses congestive), min RTTs, wire times.
Differences, 13 in its section 7; the three that matter:
1. Octet 1 took 99 minutes: the Second amendment's 10-minute rule stops the run after octet 4, which leaves every fill
   comparison not decided. The README's verdicts are the six-octet reading.
2. Run commit 962226e8 differs from the demo commit 157b7109 in 20 files the fill passes through: by the run-commit
   rule no verdict carries to the demo commit; the README lists none of them.
3. Loads 6 and 10 were slow in the phone's decode (median 524 and 872 ms a frame, against about 135), not on the wire
   (about 1 s); load 10 (16.5 s, ratio 5.642) is not mentioned in the README. The 630 s bbr session the README calls an
   orphan starts inside load 13.
Owner decisions: the 10-minute rule as written or the six-octet reading as a departure; whether the two bbr failures
withdraw bbr (the Amendment's rule); that no verdict carries to 157b7109 as it stands.
