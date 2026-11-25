# DIAL-BEFORE-PAIR-MEASURE: the cold open, the tip against PR 448

`open.mjs` opens `dbts_b1-q8-g8` (its exact series `dbts_b1`) cold in the product page, `?overlay=1&view=page|worker`,
through one `lab/scripts/link_impair.py` that delays both planes: the two sessions' UDP (5433→4433, 5434→4434) and the
static host's TCP (9700→8765 for the tip's tree, →8766 for PR 448's), `--delay-ms` half the round trip,
`--rate-kbit 100000 --queue-pkts 1000` (unshaped, the relay is VOID in most visits: `docs/rig-limits.md` §6), one relay
per visit and a visit it was late for is VOID. A fresh Chromium per visit (no HTTP cache, no compiled code). One pair
of series servers serves both arms (PR 448 touches no server file). Arms `tip-a`, `tip-b` (the A/A pair, both
`origin/claude/unified` `b059388b6`) and `pr-a`, `pr-b` (`claude/dial-before-pair` `a3948b1f4`), in Williams order per
(round trip, view), `lab/order.mjs`.

Milestones, ms from navigation on the page's clock: `firstPicture` the first overlay write (written by every paint),
`label` the first quality label, `fill` the status line's first "fill N ms"; and the spans of `/series/metadata`, the
exact series' metadata and the decoder manifest from the Resource Timing entries.

## Prediction (written before any row)

*Theory*, from the code. On the tip, after `/series/metadata` lands, `viewer.js` fetches the exact series' metadata and
transport file (one round trip, in parallel), then awaits `built("dav1d")`, whose manifest fetch is one more (the
manifest is not preloaded: `head.js` preloads the codec's modules and WASM only), and only then connects. On PR 448
the manifest is fetched as `viewer.js` starts, beside the metadata, and the pair while the session dials; the first
paint waits for the pair's check, which lands about a round trip after the metadata, before any frame can.

* `firstPicture`: PR 448 earlier by 1 to 2 round trips (candidates.md §4 item 3): −10 to −20 ms at 10 ms (inside the
  noise: "nothing at 10 ms"), −100 to −200 ms at 100 ms, −400 to −800 ms at 400 ms; this file's reading of the code
  puts it at the upper end (2) unless the manifest's fetch queues behind the page's six HTTP/1.1 connections.
* `fill`: the same shift (candidates.md §1's table), unless the fill is decode-bound on this host (then still the same
  shift from navigation: the decode starts that much earlier).
* Both views alike. The A/A pair within the 10 ms cells' spread.

## Result

Run 2026-11-25 06:33–06:53 UTC, 7 rounds, 168 visits, 20 VOID, 148 kept: `summary.txt`. The first picture −2.0 to −2.3
round trips at 100 and 400 ms in both views, nothing at 10 ms: the prediction met at its upper end. Findings:
`findings.md`.
