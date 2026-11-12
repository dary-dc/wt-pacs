state: done
started: 2026-11-12T09:21Z
heartbeat: 2026-11-12T09:28Z
outputs: claude/link-calibration 1f7a2f2c (from claude/phone-rows 5c54f446; no PR: the row names no base)
## Resume
Done. f3ce8e73 lab/phone/link.py + link_test.py (gate line; 9 mutants killed: row threshold, bits/bytes, which row's
RTT, queue sign, rows' min as the true min, zero for none, mean for median, min for peak, first row's min);
44cf80c6 docs/transport/transport-conclusions.md §1 "A home Wi-Fi link, measured", docs/phone-rows/README.md min RTT
corrected in place; 1f7a2f2c docs/lines/optimal-quality.md. Gate: not run in full (docs + one Python test); ran
link_test.py, comment_budget.sh, bash -n scripts/gate.sh.
## Result
Fixtures: the phone run's server rows only (one phone, one home AP, one evening, dbts_b1-q8-g8, 11-12 fills per cell).
Profile "home Wi-Fi, server wired": base RTT ~2 ms (loss trace's min 1.5-2.5), bottleneck >= ~600 Mbit/s (bbr's
fastest 250 ms, phone receive path included), tail-drop queue losing at 22/40/96 ms (p10/50/90), no random loss
(89 of 89 congestive). Relay form: --delay-ms 1 --rate-kbit 600000 --queue-ms 40, no --loss.
Tether control: ~0.7 ms, ~265 Mbit/s both controllers, losses at 14-26 ms of queue, Cubic only.
Against the lab's Wi-Fi home (30 ms, 15-40 Mbit, 0.5 % GE, 300 ms): differs on every axis; its BBR 2.12x rests on
random loss this link does not have; the run's cubic-restart-faster agrees with §1's congestive-loss answer.
The 6.1 vs 2.2 ms "min RTT": the path rows' min of 250 ms smoothed-RTT samples, frozen after the fill, so it read
each controller's queue (Cubic ~6 ms, BBR ~1.5 ms); the cable's true min is 0.61-0.78 ms. Corrected in place.
Limits: the relay was checked to 100 Mbit only and its floor is 0.4 ms, so it cannot run this link; netem can on a
host with the cores (unmeasured); a scaled 60 Mbit form decides queues, never fill times. Jitter, uplink, cellular not in it.
Owner decision: none needed; whether the next round adds a netem host for this profile is the protocol amendment's.
