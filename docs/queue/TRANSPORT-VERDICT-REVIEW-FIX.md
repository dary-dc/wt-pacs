state: done
started: 2026-11-19T06:16Z
heartbeat: 2026-11-19T06:53Z
outputs: `claude/transport-arms` (PR 403) d542d9a0 (failing test), c2802b0c (fix), 036e14b2 (`docs/lines/codecs.md` §Open 7); smoke rows `docs/queue/TRANSPORT-VERDICT-REVIEW-FIX-smoke.jsonl` (not counted)
## Resume
Done. Next: TRANSPORT-VERDICT-REVIEW-FIX-REVIEW, by a session that wrote none of the build, the run, the verdict review
or this fix; then TRANSPORT-AD-RERUN. For a cloud run: `run.mjs` builds `series-server --features lab-get` inside
its network namespace, where crates.io is unreachable: build it first (`cargo build --release -p series-server
--features lab-get`) and pass `--server target/release/series-server`; `apt-get install -y iproute2`.
## Result
* Fix: in the fill shape, `startFill` returns once the opening GET is issued, so `connect()` no longer awaits the
  whole fill and an ask during it reaches `ask()`, which aborts the fill and GETs the frame. Only `fetch-session.ts` changed.
* Test first: `lab/transport-arms/fetch-session.test.ts` (a fake `fetch` that holds the fill open after frame 0):
  connect returns while the fill is open, the ask's GET goes out, the asked frame lands before frame 49. Fails at
  d542d9a0 without the fix; the mutant restoring the returned GET promise fails it. Bundled by `build.sh`, run in `scripts/gate.sh`.
* Gate OK at 036e14b2 (642 s); skipped by name: native painter, native window, cross-codec arm and Firefox, nginx
  check. `scripts/check_lab_absent.sh` green; comment budget ok.
* Smoke, not counted (one round of AD, both forms, eight arms): every frame exact in 16 visits; `sessionOpen` now in
  every H3-fill and H2-fill visit (absent from all of them before, §6.5). ad-pub ratios to WT-TS: H3-fill 1.227,
  H2-fill 1.005 (were ×10.98, ×11.02). ad-lte H3-frame `VOID` (spoke not h3), §5.4. n = 1: no claim.
* Fixtures and limits: the build's synthetic series (12 frames 2048², ~6.5 MB each; AD's 50/16 frames served as a 12-frame
  prefix), one 4-core container, Chromium headless, the TUN relay; no radio.
