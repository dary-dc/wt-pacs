state: done
started: 2026-11-10 06:23
heartbeat: 2026-11-10 06:37
outputs: claude/phone-pair 52b96463, draft PR #343 into claude/phone-setup
## Resume
Done. Commits on claude/phone-pair: 78cbb579 (README step 3b, a pair: exact server on 4434, transport files on the
laptop's address, firewalld 4434/udp, dev-server.py --exact-metadata/--exact-transport), 52b96463 (the check's note).
Harness in docs/queue/PHONE-PAIR-harness/ (build.sh, mkpair.py, run.sh, page.mjs); needs iproute2 and socat,
`bash client/transport/ts/build.sh` and the pinned WASM build (Docker Hub answered 429 once; a retry worked).
## Result
Checked in a network namespace standing in for the phone (veth as the tether, socat over a unix socket as adb
reverse), on phone-pair merged onto oq-depth-cut (phone-setup's base, core, lacks the exact flags):
24/24 frames av1-webcodecs from 4433, *Optimal quality*; `l` → frame from 4434 via htj2k, *Lossless* (digest matched).
Mutants killed: an altered exact digest → *Lossless check failed*; exact transport on 127.0.0.1 → never *Lossless*.
Fixture: synthetic 10-bit pair 256×192×24, Q 8 G 8; 4-core cloud host, no GPU, headless Chromium 153.
Not checked: a real demo-series.sh pair, a depth cut, the phone, its Chrome, tethering, firewalld.
Owner decision: none. DEMO-INTEGRATE merges claude/phone-pair, which brings the exact flags' README use together
with the code that has them.
