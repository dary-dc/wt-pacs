# WINDOW-WHOLE-GROUPS-MEASURE: the frame counts

Each script is `client/view/window.test.mjs`'s `world` and `walk` (PR 446 at `e8a52cfe4`) with a different body. Copy it into
`client/view/` of the tree to count and run it with `node`; on the tip `b059388b6` copy `window.test.mjs`'s harness alongside
(it imports only `./controller.js` and `../transport/downloader.js`). Measured 2026-11-25 06:07-06:10 UTC, Node in a
4-core cloud container. Frames on the stand-in wire, not time or bytes on a link.

`count.mjs`: a pass forward then back, and six steps rocking 24|23, for (n, G, W):

| n/G/W | tree | opening | forward | backward | rock 24\|23 |
| --- | --- | ---: | ---: | ---: | ---: |
| 50/8/15 | tip | 16 | 268 | 280 | 48 |
| 50/8/15 | PR 446 | 16 | 34 | 40 | 0 |
| 50/8/16 | tip | 16 | 260 | 272 | 48 |
| 50/8/16 | PR 446 | 16 | 34 | 40 | 0 |
| 50/8/24 | tip | 24 | 196 | 208 | 48 |
| 50/8/24 | PR 446 | 24 | 26 | 32 | **48** |
| 50/1/15 | tip | 15 | 35 | 35 | 6 |
| 50/1/15 | PR 446 | 15 | 35 | 35 | 6 |
| 64/8/15 | tip | 16 | 392 | 392 | 48 |
| 64/8/15 | PR 446 | 16 | 48 | 48 | 0 |

`rock.mjs` and the rows below (PR 446 unless said): six steps rocking a|a+1 after walking to a.

| n/G/W (shape) | groups held | rock | frames |
| --- | ---: | --- | ---: |
| 50/8/15 (`dbts_b1`) | 2 | 19\|20 (mid-group) | **48** (tip: 48) |
| 50/8/15 (`dbts_b1`) | 2 | 18\|19, 20\|21, 23\|24 | 0 (tip at 23\|24: 48) |
| 50/8/23 | 2 | 23\|24, 31\|32 | 0 |
| 50/8/24, 50/8/31 | 3 | 23\|24, 31\|32 (boundary) | **48** |
| 50/8/24 | 3 | 19\|20 | 0 |
| 50/8/32 | 4 | 19\|20 (mid-group) | **48** |
| 69/8/40 | 5 | 23\|24, 31\|32 | **48** |
| 69/8/54 (`dbts_c1`) | 6 | 35\|36 (mid-group) | **48** |
| 69/8/54 (`dbts_c1`) | 6 | 23\|24, 31\|32, 39\|40 | 0 |
| 50/16/40 | 2 | 23\|24 (mid-group) | **96** |
| 50/16/48 | 3 | 31\|32 (boundary) | **54** |

`dbts_b1` W = 15 and `dbts_c1` W = 54 are `memoryWindow`'s for 2560×3328 and 976×2513 at two bytes (`docs/FIXTURES.md`'s
sizes, *derived*); `dbts_a1` (56 × 1142×1785, W = 65) fits whole and never meets the window.

## The timed cells (WINDOW-WHOLE-GROUPS-MEASURE-2)

`steps.mjs` opens `dbts_b1-q8-g8` (exact series `dbts_b1`) in the product page, `?overlay=1&view=page` (the default view),
the fill on (the default), through one `lab/scripts/link_impair.py` carrying both sessions' UDP and the static host's TCP,
in one of two forms copied from `claude/delivery` `lab/delivery/plan.mjs` `CELLS`: CLEAN (1 ms each way, 90 Mbit/s, 300
packets) and LTE (19 ms each way, 50 Mbit/s, 3 300 packets, 0.1 % loss; its 40 ms blackout every 30 s is not sent). Once
the status line says "fill N ms" and 500 ms more, the browser's tree is slowed by `lab/scripts/cpu_throttle.mjs` at 1×
or 4×, and the page steps 1 → 49 by ArrowDown, then 48 → 0 by ArrowUp, one step after each paint and a dwell of 300 ms.
A step's time: the key's dispatch to the first overlay write once the stepped-to frame has reached the page (at once if
it was held). A pass's bytes: the `wireBytes` of every frame a decoder hands the page from its first key to its last
dwell's end, read off the page's `MessagePort` messages (amended after the one smoke round, which counted only the frames
landing inside a step and so missed those landing in the dwells; the smoke's rows are not kept as results). Arms `tip-a`, `tip-b` (`origin/claude/unified` `9170cdf39`) and `pr-a`, `pr-b` (`9170cdf39` with
PR 446's `0e273ee92` merged locally, `--no-ff`, never pushed; its code diff is PR 446's seven files), in `lab/order.mjs`'s
order per (form, rate, round); a fresh relay and Chromium per visit; one pair of series servers (PR 446 touches no
server file).

**Prediction** (the brief's, written by IMPROVE-1 in `docs/queue-2026-11-24.md`, before this session): "a step's time
at the window's edge and the bytes on the wire, predicted ÷ 4 to ÷ 8". Read here, before any row, as: per pass, the
branch's bytes and its sum of step times over the steps that waited, each ÷ 4 to ÷ 8 of the tip's (the frame counts of
the stand-in wire, 268 → 34 forward and 280 → 40 backward, are ÷ 7.9 and ÷ 7.0, *measured* above); the A/A pairs within
±15 % of each other; at 4× the waits longer on both, the ratio no smaller. Where the link binds (LTE, 50 Mbit/s against
a group of eight view frames, 3.71 Mbit each, *derived* from `candidates.md` §2: 0.6 s a group) and where the decode
binds (4×) is read from the rows, not assumed.
