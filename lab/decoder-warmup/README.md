# decoder-warmup

What a warm-up decode at `init` is worth to the first frames of a fill, and whether its **shape**
is what decides it. The numbers live in
[`../../docs/decode/README.md`](../../docs/decode/README.md) §Warming the decoders; this says how
they were made.

Three arms, one fresh page and one fresh session each, against one server per set:

* **none** — the product as it was: three decoders, no warm-up.
* **mismatch** — a warm-up frame of the *other* set's shape (8-bit colour against a 16-bit grey
  series, and the reverse).
* **match** — a warm-up frame of the series' own shape.

`run.mjs` rotates the arm order every round, so a drift in the host lands on all three alike, and
reports the median, the range and wins out of *n* against `none` on the same round. Each visit
reports the decode of frames 0, 1 and 2 — one per decoder, the three that pay the tiering —
`first_ms` (the page's `connect()` to frame 0 delivered) and `fill_ms` (to the last frame).
Pixels are hashed after the fill, never inside it, and every arm's digests must agree.

```bash
lab/decode-bench/fetch_decoder.sh                    # the decoder the page loads
lab/scripts/gen_htj2k_fixtures.sh cine512 g512       # the two series
NODE_PATH=$(npm root -g) CHROME_PATH=... node lab/decoder-warmup/run.mjs 12
```

`SETS`, `FRAMES` and `OUT` override the two sets, the fill's length and where the rows are
written. The runner builds `exact-server` and `pack-study` in release, makes its own certificate
and passes each page its own session URL — it does **not** touch `client/dev-transport.json`, so
it can share the box with a job that does.

**Read before trusting a number.** Loopback, headless, on a box carrying other lanes: only the
within-round differences between the arms are claimed, never the level. The fill is 12 frames and
the decoders are three, so `fill_ms` on a set whose frames are large is wire-bound and says little
about decode — `d0`/`d1`/`d2` are the decode measurement, `fill_ms` is the check that a warm-up
did not cost the fill.
