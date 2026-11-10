state: started
started: 2026-11-10 06:23
heartbeat: 2026-11-10 06:32
outputs: claude/phone-pair 78cbb579 (no PR yet)
## Resume
Done: 78cbb579 on claude/phone-pair (from claude/phone-setup; no phone-setup-fixes on origin): README §The viewer
on an Android phone, step 3b (a pair, exact server on 4434, its transport file on the laptop's address,
dev-server.py --exact-metadata/--exact-transport), firewalld 4434/udp, tcpdump and lab-build notes.
Next: the namespace check. phone-setup's harness is not committed; rebuilt here: `apt-get install -y iproute2
socat`; scratch worktree = origin/claude/oq-depth-cut + merge origin/claude/phone-pair (not pushed, phone-setup
lacks the exact flags); a pair from the depth-cut browser test's fixture or demo-series.sh; netns `phone` with a
veth to the host, socat tunnel for 8765 on the netns loopback, headless Chromium in the netns, press `l`, read
the label and the digest. Then a README note of the check, draft PR into claude/phone-setup, line note.
Harness pushed in docs/queue/PHONE-PAIR-harness/ (build.sh: dockerd, meson, venv, ingest/tools.sh, wasm build,
cargo release, run from a worktree `mix` beside it; mkpair.py MIX OUT: 10-bit 256×192×24 synthetic pair, exact
HTJ2K + Q 8 G 8; run.sh MIX OUT: netns phone, veth 10.77.0.1/.2, socat over a unix socket for adb reverse,
servers on 4433/4434 with transport files on 10.77.0.1, page.mjs presses `l`). Builds started 06:50.
06:32 first run (before the HTJ2K WASM was built): over the tunnel and the veth, 24 of 24 frames on av1-webcodecs,
label *Optimal quality*; on `l` the 4434 server served 1 frame (tile_hits=1, rtt_us=263) and the label read *Lossless
check failed* because client/decode/wasm/built/openjph is not the pinned build (the docker build got 429 from
Docker Hub). Also needed: `bash client/transport/ts/build.sh` in mix. Next: retry
`client/decode/wasm/build/build.sh` in mix, then run.sh again; then the README's checked note, PR, line note.
## Result
