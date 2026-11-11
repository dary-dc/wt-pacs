state: started
started: 2026-11-11 01:34
heartbeat: 2026-11-11 01:45
outputs: claude/demo-view-worker (from claude/demo-fixes-0 618e13c8)
## Resume
* 66521fc5 on claude/demo-view-worker: the failing check (status line must name `view <--view>`); the fix (put
  `&view=${VIEW}` in pass()'s URL) not yet committed. view/clock.js is already in deploy/web-files.sh: nothing to add.
* Next: setup (dockerd; pip install meson==1.9.1; ingest/tools.sh; client/transport/wasm/build.sh and ts/build.sh;
  client/decode/wasm/fetch_openjph.sh; gen_dev_cert.sh; cargo build --release -p series-server; README venv;
  PYTHON=.venv/bin/python scripts/demo-series.sh), then show the check failing under --view worker on one series,
  commit the fix, mutate, run 20 series x {page, worker} interleaved by series (README §Demo's loop, --view added).
## Result
