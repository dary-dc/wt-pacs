# decoder-warmup

What a warm-up decode at `init` is worth to the first frames of a fill, and whether its **shape**
is what decides it. The numbers live in
[`../../docs/decode/README.md`](../../docs/decode/README.md) §Warming the decoders; this says how
they were made.

Four arms, one fresh page and one fresh session each, against one server per set:

* **none** — the product as it was: three decoders, no warm-up.
* **mismatch** — a warm-up frame of the *other* set's shape (8-bit colour against a 16-bit grey
  series, and the reverse).
* **mismatch-sized** — the other shape again, resized to the same **sample count** as the matching
  frame. Without it, `match` against `mismatch` prices shape and size together, and size turns out
  to be the larger half.
* **match** — a warm-up frame of the series' own shape.

`run.mjs` rotates the arm order every round, so a drift in the host lands on all of them alike, and
reports the median, the range and wins out of *n* against `none` on the same round. Each visit
reports the decode of frames 0, 1 and 2 — one per decoder, the three that pay the tiering —
`first_ms` (the page's `connect()` to frame 0 delivered) and `fill_ms` (to the last frame).
Pixels are hashed after the fill, never inside it, and every arm's digests must agree.

```bash
lab/decode-bench/fetch_decoder.sh                                  # the decoder the page loads
lab/scripts/gen_htj2k_fixtures.sh cine512 g512 warmup_c92 warmup_g277
NODE_PATH=$(npm root -g) CHROME_PATH=... node lab/decoder-warmup/run.mjs 12
RTT=40 node lab/decoder-warmup/run.mjs 12                          # with an idle window to warm in
THROTTLES=1,4,6 SCENARIOS=fill,ask ARMS=none,match node lab/decoder-warmup/run.mjs 7   # WU1
```

`THROTTLES` slows every browser thread per visit (`lab/scripts/cpu_throttle.mjs`; the warm-up is in
the decoders, which Chromium's own throttle does not reach). `SCENARIOS=ask` opens a session with
no fill and asks frame 5 at once: the cold ask.

`SETS`, `ARMS`, `FRAMES`, `RTT` and `OUT` override the two sets, which arms run, the fill's
length, the round trip `lab/scripts/link_impair.py` imposes on **both** planes — the warm-up is a
static fetch and pays the link like everything else — and where the rows are written. Every row
carries every frame's decode, so the steady state quoted in the findings is read back from
`OUT` rather than printed here. The runner builds `exact-server` and `pack-study` in release, makes its own certificate
and passes each page its own session URL — it does **not** touch `client/dev-transport.json`, so
it can share the box with a job that does.

**Read before trusting a number.** Loopback, headless, on a box carrying other lanes: only the
within-round differences between the arms are claimed, never the level. The fill is 12 frames and
the decoders are three, so `fill_ms` on a set whose frames are large is wire-bound and says little
about decode — `d0`/`d1`/`d2` are the decode measurement, `fill_ms` is the check that a warm-up
did not cost the fill. With a round trip the fill arrives one frame at a time and `pump()` hands
them all to the first free decoder, so only `d0` is a cold decoder's first frame there.
The first visit to each set is discarded, and the one after it checks that a warm-up which is not
a codestream still delivers the whole fill.
