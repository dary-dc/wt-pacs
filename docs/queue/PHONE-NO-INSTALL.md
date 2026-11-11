state: started
started: 2026-11-11 01:42
heartbeat: 2026-11-11 01:43
outputs: claude/phone-no-install (from claude/demo-fixes-0 618e13c8)
## Resume
Demo tip: claude/demo-fixes-0 618e13c8; branch claude/phone-no-install made from it (nothing pushed yet).
Running (long, ~30 min): pip install meson==1.9.1; ingest/tools.sh; scripts/demo-series.sh (log
/tmp/demo-series.log) for (3)'s byte table. If lost, rerun: `pip install meson==1.9.1 && scripts/demo-series.sh`.
Meanwhile: (1) dev-server.py --bind ADDR (CSP connect-src adds ADDR), failing test first; (2) certificate via
podman's local rust image (it has openssl) running server/scripts/gen_dev_cert.sh, hash via python3 stdlib;
(4) README §Demo variant; check with docs/queue/PHONE-PAIR-harness (page at http://ADDR:8765 with Chromium's
--unsafely-treat-insecure-origin-as-secure).
## Result
