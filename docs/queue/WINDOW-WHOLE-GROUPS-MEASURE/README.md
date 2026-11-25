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
