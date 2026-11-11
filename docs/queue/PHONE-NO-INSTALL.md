state: done
started: 2026-11-11 01:42
heartbeat: 2026-11-11 02:22
outputs: claude/phone-no-install 136c19f4, draft PR #360 into claude/demo-fixes-0
## Resume
Done. Commits: c601bbdb (dev-server --bind), 7db57ecb (gen_dev_cert OPENSSL=), ef77dd3a (README), 136c19f4 (line
note). Harness and demo-series table in docs/queue/PHONE-NO-INSTALL-harness/.
## Result
(1) Chrome's "Insecure origins treated as secure" is built for Android (about_flags.cc: kOsAll incl. kOsAndroid,
outside any #if; quoted at 463745830f5e). dev-server.py --bind ADDR, loopback by default, 0.0.0.0 refused; 5 mutants killed.
(2) Certificate: OPENSSL="podman run … rust openssl" in gen_dev_cert.sh (the local image has openssl; the script's
only dependency on the command); hash via jq from the transport file. 4 mutants killed.
(3) Show list bytes: a1-q8-g8-cut 4.64 MB, b1-q8-g8 23.2 MB, a1-q24-g8-cut 0.21 MB, a1-q8-g16-stored 5.03 MB,
exact a1 67.8 MB, b1 107.4 MB: 208 MB (all 23 series 368 MB). series-server builds with cargo + gcc alone.
(4) README §Demo variant. Namespace check on 3 series: all frames, l -> Lossless; without the flag, none.
Playwright's headless shell ignores the flag (full Chromium honors it). Gate OK 649 s (nginx, lavapipe, GL skipped).
Fixtures: dbts_a1/b1/c1, one dataset; no ultrasound cine; 4-core cloud, no GPU. Not checked: phone, tether, firewalld zone, podman.
Owner decisions: the transfer channel for 208 MB (or 368 MB); whether the tether's interface lands in the
FedoraWorkstation zone (check firewall-cmd --get-zone-of-interface on the laptop).
