state: started
started: 2026-11-11 01:34
heartbeat: 2026-11-11 01:35
outputs: claude/demo-tests-mobile (from claude/demo-fixes-0 618e13c8)
## Resume
Branch claude/demo-tests-mobile pushed at 618e13c8 (nothing of its own yet). Plan: (a) node tests of the label and `l`
in client/view/controller.test.mjs (passing ones) and client/view/mobile.test.mjs (failing ones, outside the gate, as
REDTEAM-DEMO did); (b) client/viewer/lossy-link.sh: demo-check.mjs run in a network namespace whose loopback carries
netem delay and loss, on dbts_a1 (exact + q8-g8-cut) and dbts_b1 (exact + q8-g8, D 10). Building in the background:
cargo series-server pack-series; ingest/tools.sh; client/transport/wasm/build.sh + ts/build.sh; playwright 1.56.1.
To continue: the same builds (README §Demo), then the lossy-link run.
## Result
