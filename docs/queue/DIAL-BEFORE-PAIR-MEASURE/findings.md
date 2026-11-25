# DIAL-BEFORE-PAIR-MEASURE: findings on PR 448

2026-11-25, by a session that wrote none of PR 448 or `candidates.md` (`by:` in the status file). PR 448 at
`a3948b1f4` against `origin/claude/unified` `b059388b6`. The rig, the prediction (pushed before any row), the rows and
the summary are beside this file (`README.md`, `open.mjs`, `rows.jsonl`, `summary.py`, `summary.txt`).

## The standing review (each test fails without its change, nothing else touched)

* `client/view/controller.test.mjs`, measured: the PR's file on the tip, 46/48 (both new tests fail); on the PR 48/48;
  mutant G1 (the loop's `await this.#paintAfter` removed) 46/48, the two new tests failing by name.
* `client/viewer/demo-check.mjs` on the PR, `dbts_b1-q8-g8`: passed in the page view and the worker view. Mutant M1
  (`await pairing` before the decoder and the dial, page view): "2 failed", the held pair ("no frame received before
  its metadata came, so the dial waited for it") and the refused pair. M2 and M3 not re-run here (the PR's table).
* Nothing else touched: the diff is the ten files the PR names; `wasm-glue.js`'s manifest kept once a realm and
  `built("dav1d")` fetched on an HTJ2K series too, which fetches only the manifest (no WASM), so no new bytes.

## The timed cells (measured)

`dbts_b1-q8-g8` and its exact series `dbts_b1`, cold, fresh Chromium per visit, both planes through one relay
(`link_impair.py`, 100 Mbit, 1000-packet queue, its own core), 7 rounds in Williams order of four arms (the A/A pair
`tip-a`/`tip-b`, `pr-a`/`pr-b`), 168 visits, 20 VOID (relay p99 lateness over 1 ms), 0 failed, 148 kept;
06:33–06:53 UTC. The first picture, ms from navigation; PR − tip the per-round median difference, its range:

| view | RTT | tip | PR 448 | PR − tip | round trips | A/A |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| page | 10 | 637 | 632 | −12 [−48, 10] | −1.2 | −10 |
| page | 100 | 2730 | 2526 | −230 [−264, −169] | −2.3 | −15 |
| page | 400 | 9722 | 8934 | −794 [−818, −777] | −2.0 | −8 |
| worker | 10 | 702 | 679 | −10 [−48, 6] | −1.0 | +4 |
| worker | 100 | 3144 | 2934 | −206 [−270, −132] | −2.1 | +4 |
| worker | 400 | 11340 | 10550 | −790 [−858, −753] | −2.0 | −6 |

**Against the prediction** (−1 to −2 round trips; nothing at 10 ms): **met**, at its upper end, in all six cells; every
round at 100 and 400 ms earlier on the PR (6 or 7 rounds a cell, each range wholly below zero), the A/A pair within ±15 ms. At 10 ms −10 to −12 ms,
inside the cell's range: "nothing", as predicted. The fill (from navigation) moves by the same −2.1 round trips at
400 ms in both views; at 100 ms −278 ms (page) and −34 ms (worker, range −384 to +74) against A/A spreads of 141 and
128 ms: not resolved there; at 10 ms nothing. **A non-regressor**: no cell later on the PR beyond its A/A spread.

## Findings

* **m1 (minor; no fix row).** The manifest is not fetched "beside the metadata", as the PR body and `client/README.md`
  §The viewer *Opening* say. Resource Timing, medians at 400 ms: `/series/metadata` ends at 1638 ms; on the PR the
  manifest starts at 4869–4871 ms, with the exact series' metadata (4870–4873), since `viewer.js`'s module body runs
  only once its graph has loaded; on the tip the pair runs 4872→5673 and the manifest after it, 5679→6481. So the PR
  takes the manifest's fetch off the pair's back, not off the dial's path: the dial still waits for the manifest, one
  fetch (≈2 round trips on this HTTP/1.1 host) after `viewer.js` starts. What the PR saves is measured right; the
  sentence about where the manifest goes is not. Fix with the PR or after it: the README line corrected in place, and
  (*theory*, not measured) a `preload` of `manifest.sha256` in `index.html` or `head.js` would take the remaining fetch
  off the dial's path, a further ~1–2 round trips: a candidate for the next IMPROVE round, not built here.
* **n1 (nit).** `controller.test.mjs` drops `await` from two `c.show(1)` calls in an existing test; the test passes
  either way on the PR (measured), so the edit is unexplained, not wrong.

## Fixtures and limits

One DBT volume (`dbts_b1`, 50 frames, 2560×3328, 10-bit) as its exact HTJ2K series and `dbts_b1-q8-g8`, coded here by
`scripts/demo-series.sh`'s `ingest()` for that set alone; no ultrasound (no optimal-quality ultrasound pair exists).
One 4-core cloud container (browser and servers on three cores, the relay on the fourth), no GPU, headless Chromium,
SwiftShader WebGL, software WebCodecs; a userspace relay, not a radio, and the round trip the only impairment; the
dev static host (HTTP/1.1, plaintext), so a fetch on a fresh connection costs two round trips here, which a TLS or
HTTP/2 host would change (a host with TLS charges more per connection, HTTP/2 fewer connections): the round-trip count
is this host's. The fill is decode-bound at 10 ms on this host (≈2.5 s of decode for 15 frames, the memory window);
the link binds the first picture at 100 and 400 ms. Firefox not run. 1× only (the brief asks no 4×).
