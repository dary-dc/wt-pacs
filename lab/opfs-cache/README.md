# opfs-cache

The client cache's owed cells, M1–M4, as [`docs/adr/frame-path.md`](../../docs/adr/frame-path.md) §Proposed
pre-registers them; the numbers and verdicts are there. The browser is the product's viewer on the dev host, plus
`reopen.html`, a page of the same origin that reopens a series through the product's store worker
(`client/viewer/store.js`), every frame read back and then hashed again (SHA-256) against the encoder input.

Needs the release server and `pack-series`, the decoder builds, the clients, the venv (`PYTHON`) and OpenJPH's encoder
under `ingest/.build` (README §Prerequisites); M1 uses `lab/scripts/link_impair.py`. Firefox is driven over WebDriver
BiDi on an Xvfb display (`DISPLAY`, `FIREFOX_PATH`), for M3 only.

```bash
NODE_PATH=$(npm root -g) PYTHON=.venv/bin/python node lab/opfs-cache/run.mjs --cell m1|m2|m2-13g|m2-trace|m3|m4 --out rows.jsonl \
  [--rounds 7] [--engine chromium|firefox] [--mutant NAME]
python3 lab/opfs-cache/summary.py DIR   # each cell's numbers and verdict from DIR/m1.jsonl, m2.jsonl, m2-13g.jsonl, m3*.jsonl, m4.jsonl
```

The arm switched off and the mutants are the rig's stand-ins for a product file, named in `run.mjs`'s `STAND_INS`: in
Chromium routed in its place, in Firefox written over it and put back. Series, profiles and rows go to `work/`, which
is not tracked: M2's 13 GiB cell wants ~16 GB of free disk. `m2-trace` is the diagnostic after M2, not pre-registered.
