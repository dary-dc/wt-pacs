# The AV1 cold open: a depth hint

**Question:** Does a ≤ 10-bit AV1 series reach its first exact frame sooner, cold, if the page skips dav1d's glue and
WASM until WebCodecs fails its probe?

*Folded 2026-11-14 from `claude/coldrtt-hint:lab/page-open/README.md` §A depth hint, `client/README.md` §AV1 cold and
`docs/av1/queue.md`'s 2026-10-07 entry (34417caf, 7f4a7498, 09934040, 334214d2). The hint, its rig and its rows are
on that branch, not in this tree: this tree's `client/README.md` still ends the paragraph with "dav1d wins from
10 ms" (a correction proposed in the line doc's round, `client/README.md` being reserved here). The earlier
measurement it answers is [`lab/page-open/README.md`](../../../lab/page-open/README.md) §Cold round trips by codec.
Measured, headless Chromium 153, one 4-core container. The design these findings shape is
[`../design.md`](../design.md).*

## The question, and why it was asked

Fetching dav1d's WASM at the decoder's start (adopted, `cc47988`) is −1.0 round trips to the first exact frame
through WebCodecs and −3.0 through dav1d from 20 ms up. But a WebCodecs series whose probe passes never uses that
238 KB fallback, and it arrives beside the first frame: +26 ms at 10 ms RTT (1 of 6 rounds earlier), +67 on loopback
(0 of 10), a tie at 20 ms (2026-10-07). The cost was still there on 2026-10-28: `client/viewer/head.js` preloaded
`dav1d.js` and `dav1d.wasm` for every AV1 series, and `av1.js`'s `init` fetched them again, whatever the depth.

## The hint

The series' metadata (`/series/metadata`, fetched before the decoders start, so no round trip) carries `depth`, the
payload header's depth of the top stream, written by `ingest.py`'s `metadata`. At `depth` ≤ 10 the page and each
decoder run WebCodecs' probe of `g{depth}` first and preload or fetch dav1d's glue and WASM only if it fails; a payload
WebCodecs then fails on still loads dav1d on demand. A series without `depth` (every one ingested before) loads both
as before.

## Protocol (committed 2026-10-28, before any timed run)

* **Arms**, on `lab/page-open/codec.html`: `?pre=1` is the product page's preloads (`head.js`), `?hint=1` adds the
  hint. A (`wc-pre`, hint off), A′ (`wc-pre2`, the same page again), B (`wc-hint`). The g10 series (10-bit grey,
  WebCodecs on Chromium), Williams-ordered in each round, 8 rounds, at 10 then 40 ms RTT, cold (a fresh profile a
  visit) and warm; a 100 Mbit relay; every frame 0 checked against the source's checksum. Each visit records whether
  `dav1d.wasm` was asked for: every A and A′ visit must ask, no B visit may.
* **Quoted: latency**, ms from navigation to the first exact frame, cold, as paired B − A and A′ − A per round.
* **Predicted:** at 10 ms B − A −15 to −40 ms, earlier in ≥ 6 of 8 rounds; at 40 ms −10 to −60 ms; warm a tie.
* **Rule:** a cell is VOID when |median A′ − A| > 10 ms or fewer than 7 rounds are kept. Otherwise B wins when the
  median B − A < −10 ms and B is earlier in ≥ 80 % of the rounds kept, loses the other way, ties otherwise. The hint is
  on by default only if it wins at least one cold cell, loses none, and the fallback test passes with its mutations
  caught.
* **The fallback test** (`av1.test.mjs` on the branch): a ≤ 10-bit series whose probe fails fetches the WASM at
  `init` and decodes through dav1d; one whose probe passes never fetches it.

## Results, run 2026-10-28

At `34417ca` with the rig's `7f4a749`, headless Chromium 153, 16 rounds (8, then the 8 the rule's top-up asks for: the
10 ms cell had kept 6), 7 of 96 relay visits VOID and dropped, none failed, every frame 0 exact; `dav1d.wasm` asked in
every A and A′ visit (58 cold, 58 warm) and in none of B's (31, 31). The frames are the golden g10 payload; no HTJ2K
arm ran (its encoder is not in that container). Rows: `claude/coldrtt-hint:lab/page-open/rows-coldrtt-hint.json`.

Cold, ms to the first exact frame, median [range]; paired against A, rounds earlier of rounds paired, median difference:

| RTT | A | A′ − A | B | B − A | cell |
| --- | ---: | ---: | ---: | ---: | --- |
| 10 ms | 262 [220–305] | 4/12, +4 | 225 [188–256] | 13/13, **−41** | B wins |
| 40 ms | 417 [393–448] | 6/14, +8 | 393 [382–419] | 12/14, **−24** | B wins |

Warm, B − A −10.4 ms (12/13) at 10 ms and −7 (9/14) at 40, A′ − A +5 and +3: by the rule a B win at 10 ms and a tie at
40 (*corrected 2026-10-28,* 334214d2: first written as two ties; −10.4 is past the −10 threshold). The cold spread: per
round A′ − A runs −22 to +39 ms at 10 and −40 to +26 at 40 (SD ≈ 20); a bootstrap 95 % interval of the median B − A is
−48 to −25 ms at 10 and −35 to −3 at 40; B − A′ is −44 (15/15) and −15 (13/14). The 40 ms win holds; its size is loose.
After the first 8 rounds the 10 ms cell was VOID (A′ − A +23, 6 kept) and the 40 ms one already won (−26, 6/7); the
top-up is the rule's, not a second look chosen after the fact.

**Where the host saturates:** not measured past one visit at a time on one 4-core container; the relay voids a visit
it was late for.

## Verdict

**The hint wins both cold cells and loses none, so it is on by default on that branch**: ingest writes `depth`, the
viewer passes it, a series ingested before keeps the old loads. The fallback test holds with 4 of 4 mutations caught
(the fetch on a failed probe dropped, the hint ignored, the fetch made on a pass, the probe of the wrong layout).
Against the predictions: 40 ms inside its −10 to −60; 10 ms just past its −15 to −40; warm a tie at 40 ms, and at
10 ms a win the prediction missed.

**Scope.** Chromium on the g10 series only. Not measured: Firefox (its probe of `g10` and `g8` fails, so it loads the
WASM as before, a probe later; not timed), a series whose probe fails, the product page itself (`codec.html` mirrors
`head.js`'s preloads), HTTP/3, 4× CPU, a device, a large first frame, and a series whose first layout is not
`g{depth}`: the hint probes `g10` for an RCT colour series' `c10` and `g8` for a 4:2:0 grey's `g8f`, and not a split's
low `g8`. A wrong guess changes only whether the WASM is fetched ahead, never the decoder.
