# Review of `claude/demo-e2e-2` (#354)

REVIEW-E2E2, 2026-11-11, by a session that wrote none of it. Reviewed: its three commits (README §Demo, the
certificate renewal in `client/viewer/demo-check.mjs`, the record in `client/README.md` and
`docs/lines/optimal-quality.md`), as merged in `claude/demo-fixes-0` at `36d286cd`.

## How it was checked

README §Demo followed word for word from a fresh clone of `claude/demo-fixes-0` on one 4-core x86-64 cloud host,
no GPU, Chromium headless on SwiftShader, loopback. Deviations, each by the host's rules, not the README's: meson
1.9.1 from pip (§Prerequisites' cloud note); the host's preinstalled Playwright 1.63.0 and its Chromium in place of
`npm i -g playwright@1.56.1 && npx playwright install chromium`, so `NODE_PATH` named that install; the optional
decoder rebuild not run. Fixtures: the three DBT volumes `dbts_a1`, `dbts_b1`, `dbts_c1`, all from one dataset; no
breast ultrasound cine.

* **Once block**: every command ran as written; `demo-series.sh` wrote the 23 series in 658 s; every byte count
  equal to the record's fractions (Q 8: 0.0685–0.0687 `dbts_a1` cut, 0.2159–0.2186 `dbts_b1`, 0.0882–0.0898
  `dbts_c1` cut; stored forms 0.0742 and 0.0947).
