state: started
started: 2026-11-12T09:21Z
heartbeat: 2026-11-12T09:22Z
outputs: claude/link-calibration (from claude/demo-fixes-2; nothing yet)
## Resume
Branch claude/link-calibration from claude/phone-rows 5c54f446 (raw rows in docs/phone-rows/raw/, blind read in
docs/reviews/phone-blind-read.md), worktree ../wt-lc. Line doc: docs/lines/optimal-quality.md (Open 5 names this row).
Servers: OQ 4433 cubic-restart / 4443 bbr; exact 4434 / 4444; sessions map to loads in beacon order (lab/phone/losses.py).
Next: lab/phone/link.py reading per session min RTT, RTT rise (queue ms) while filling, cwnd, delivery rate per 250 ms
row (sent_packets delta x 1452 B), loss-event q; then docs/transport/link-calibration.md (profile for link_impair.py,
compare docs/rig-limits.md 3 and docs/transport/transport-conclusions.md 1 "Link profiles close to a phone"; the
min-RTT-by-controller question); update docs/lines/optimal-quality.md; push; draft PR? none (docs, theory; no PR base named).
## Result
