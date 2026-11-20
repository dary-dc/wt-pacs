state: done
started: 2026-11-20T12:16Z
heartbeat: 2026-11-20T13:54Z
outputs: claude/delivery 32364cae (lab/delivery/, lab/devices beacon + pressAfter, scripts/gate.sh, docs/lines/client.md), draft PR 406 into claude/unified
## Resume
Done. Next row on this question: DELIVERY-BUILD-REVIEW (a session that wrote none of this; not before 11-21 08:00).
The run's series: `lab/delivery/series.sh S` (~2 min here, frames kept); needs `apt-get install -y iproute2`.
## Result
claude/delivery = claude/unified + DELIVERY-PROTOCOL + --no-ff merge of claude/phone-run (PR 409's diff rides PR 406).
lab/delivery/: plan, predictor (§4.1; checked against §4.3's table), inputs (K1-K3), driver (TUN relay, per load),
judge (§6-§8, A/A input), series.sh, prefix.py, k3.sh (transport-arms 9fad9d9b's WT-TS in a worktree).
lab/devices: each frame's lastByte in the beacon; pressAfter for C1's 1 s. Tests failed first.
Tests 24+23+4+3 claims; mutants killed 10, 15, 4 of 5 (a sort the filesystem already gives), 4; the driver's §10
mutants flip-exact (STOP), relay-no-loss (PILOT REFUSES), fixed-order (UNBALANCED), decoders-3 (VOID) each fired.
Smoke, one uncounted round a cell on the three volumes: 72 of 75 loads ok; B within 0.5 % of §4.3 on CLEAN/PUB.
For the run's §11 amendment (README): page server in the server netns + --unsafely-treat-insecure-origin-as-secure on
full Chromium 153; hardwareConcurrency 2 under taskset; C1 asks frame 0; C2 dials at its issue.
Open for the run: the relay's guard voided 8/15 CLEAN and 5/15 PUB smoke loads, all decode-bound (p99 2.5-8.9 ms).
Gate green at 32364cae (skips: cross-codec/Firefox, native painter and window, nginx). check_links 0, budget ok.
Fixtures: dbts_a1/b1/c1 Q 8 G 8, synthetic pair 64x48x20; one 4-core container, software decode, TUN relay <= 90 Mbit.
Owner: whether CLEAN/PUB may run with the guard as written (decode-bound loads VOID) is the run's amendment or yours.
