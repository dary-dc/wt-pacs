state: done
started: 2026-11-17T22:16Z
heartbeat: 2026-11-17T22:21Z
outputs: claude/transport-design 772d366e, then the section pointer (docs/transport/evidence/stacks.md §5; §1, §3 corrected in place; docs/lines/codecs.md); on draft PR #391
## Resume
Done. Nothing owed by this row. Next (not queued): a build row for §5.6 (lab GET path, fetch carrier, driver) and its review, then a run by a session that wrote neither this protocol nor §1-§4.
## Result
stacks.md §5, pre-registered before any arm is built: 8 arms (WT-TS, an A/A copy, WT-WASM, WS, H3 and H2 fetch each as a GET a frame with K = 6 in flight and a GET a fill),
14 cells through link_impair.py --tun at <= 90 Mbit (its 100 Mbit ceiling): fills on CLEAN, PUB, ENT, LTE, CR (the credit at ~0.8 s RTT), LOSS; HOL; first frame cold (4 RTTs) and pooled;
an ask during a fill (AD) and after one at 0.1/1/5 s idle (AA); server and client CPU a GB; bytes. A metric a comparison, ending at the frame's last byte; Williams order, one
period (8) a cell, two for CR, AD, AA; VOID reasons, the 25 % strict/round-paired rule; a pilot that may set only timeouts and prefixes; a 12 h stop; aa_rule.py --bar 0.05.
Correction made in place: §1 and §3 said our server restarts slow start after idle; the measured record (transport-conclusions §3, restart.rs) says quinn keeps its window
and cubic-restart restarts only after an outage ending in loss, so AA registers both lines: past one RTO the TCP arms are predicted x1.2-1.9 slower on the ask.
Fixtures and limits: one series (dbts_b1 HTJ2K); Chromium headless only; one 4-core container; every profile assumed, those above 90 Mbit scaled; nothing run.
check_links and check_personal_paths green; docs only, no gate run (no code).
Owner: none now; the GET path is structural and the owner's if the run favours a fetch arm.
