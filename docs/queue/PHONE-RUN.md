state: running
started: 2026-11-11T15:20Z
heartbeat: 2026-11-11T20:53Z
outputs: claude/phone-rows (from run commit 962226e8; raw rows to come); claude/phone-devtools eb028344 (request 4b)
## Resume
Timed run started 20:53Z on 962226e8 (image label 962226e8), protocol ecd31836, memlock 8388608 per its Note; series
dbts_b1-q8-g8 (23,208,296 B) and dbts_b1, the c6da7275 set. Eye check at the run commit (runner, tether, cubic,
not counted): page and worker each 56/56 av1-webcodecs, fill 1.06 / 1.05 s, Lossless 0.10 / 0.08 s, verdict ok, 0
errors, 0 lost. read-path.sh: all four preadv2, ring refused, SELinux Enforcing. Device counters logged every 0.5 s
(target/phone-run/counters.log) for the link check. adb server stopped for the run. Earlier heartbeat 20:45Z was
wrong (written ~20:20Z).
Proposed to the owner (pending the owner's word): this session owns the phone tooling branches (phone-devtools, phone-rows,
lab/phone fixes) and runs local helpers; protocol amendments and the blind read stay outside it.
## Result
(pending)
