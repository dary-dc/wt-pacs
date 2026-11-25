# DECODE-OVERLAP-MEASURE: PR 447 against the tip, interleaved

Row DECODE-OVERLAP-MEASURE of `docs/queue-2026-11-24.md`. Arms: `tip` (`origin/claude/unified` `b059388b6`), `tip-aa`
(the same files under another path: the A/A pair), `branch` (`origin/claude/decode-overlap` `59605e6e0`, PR 447).

**Predictions, written before the counted rows** (`docs/queue/IMPROVE-1/candidates.md` §4 item 2, *theory*): a fill the
decode binds −14 to −27 %; a group prefix (a request deep in a group) −18 to −32 %; no change where the wire binds. The
build's own function check on this host type (`docs/decode/README.md` §The read-back's share on the branch) measured the
bench +3.5 % at 1× and −21.5 % at 4× under a page-thread throttle, so this host may show no gain at 1×.

**Rig** (`bench.html`, `bench.js`, `run.mjs`): three product decoder workers (`client/decode/decoder.js` of the arm's
tree, WebCodecs, as the viewer configures them) fed coded units held in memory, so the decode binds and no wire is in
the cell. *fill*: whole groups, two outstanding a decoder (the downloader's `perDecoder`), span from the first
hand-over to the last frame. *askK*: one group warms decoder 0, then group 2 from its keyframe to offset K
(0, 3, 7) goes to it; the wait to frame K. One browser per visit; 4× is `lab/scripts/cpu_throttle.mjs` over the
browser's whole process tree (decoder workers and the browser's decode threads alike), not Chromium's page throttle.
Arms in a Williams order inside each block, blocks in a Williams order each round. Every frame's samples hashed
(XXH3) and compared across arms; every route must be `av1-webcodecs`.

    NODE_PATH=$(npm root -g) node run.mjs --tip TIP --branch BRANCH --series DIR --rounds 1 --first-round R --out rows.jsonl

Series coded here by `scripts/demo-series.sh`'s steps (`lab/av1/tools/ingest_coded.py --lossy 8 8`, `--depth-cut` for
the 12-bit sets; `ingest/tools.sh`'s coders): `dbts_a1-q8-g8-cut` 4,642,293 B, `dbts_b1-q8-g8` 23,208,296 B,
`dbts_c1-q8-g8-cut` 6,239,698 B.

**Fixtures and limits:** three DBT volumes of one dataset (56, 50, 69 frames; G 8); a 4-core cloud host, no GPU,
headless Chromium (Playwright's), software WebCodecs; the decode bench, not the product's view (no transport, no
paint, no page-thread work); no Firefox, no ultrasound, no phone.
