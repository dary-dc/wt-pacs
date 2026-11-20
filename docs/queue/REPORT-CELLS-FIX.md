state: done
started: 2026-11-20T16:16Z
heartbeat: 2026-11-20T16:46Z
outputs: `claude/report-arms` `e3914772` (B2), `8ac91c4e` (B1), `dd58e156` (minors), `cc585f7b` (`docs/lines/client.md`); PR 395 body §The cells' fixes; smoke rows `docs/queue/REPORT-CELLS-FIX-smoke.jsonl`, `-smoke-L.jsonl`
## Resume
Done. Next: REPORT-CELLS-FIX-REVIEW (a session that wrote none of the cells, the review or this fix), `docs/reviews/report-arms.md` §Cells re-review; REPORT-RUN-2 waits on it.
## Result
* B1: cell R sends from ⌈rate/5⌉ addresses in 127/8, each under NGINX's 10 r/s per address; `lines` counts appended (2xx) lines only. Smoke (*measured*, 2 s bursts, nginx 1.31.5): NGINX wrote 2 000 of 2 000 at 1 000/s, no 429. Tests first, 6/6 mutants killed.
* B2: the BEACON and KEEPALIVE floors post to their body's kind (`/safety` for L), the path read before the timed call. Tests first, 4/4 mutants killed.
* Minors: m1 (earliest-copy test, 1/1 killed), m4 (a refault no longer rewrites the fill) fixed; m3, m6, m7 named in the README; m2, m4's duplicate frames, m5 and the FIREFOX_PATH nit listed in PR 395's body (m5 for REPORT-RUN-2's amendment).
* Fixtures: a 4-vCPU cloud container without a GPU; headless Chromium 153; the grey-16 frame ×32, not `dbts_c1`; loopback; one smoke round, not counted.
* Gate: full `scripts/gate.sh` OK in 658 s with `check_links.py` set aside locally (2 pre-existing unresolved paths in `docs/lines/devices.md`, not changed); skips named in PR 395's body.
* Owner: nothing.
