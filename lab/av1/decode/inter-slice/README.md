# inter-slice

A slice predicted from its neighbour before HTJ2K: a reversible 5/3 step across each pair of
slices, its low and high band each coded as a served HTJ2K frame, against the two served frames.
Queue row 213 (INTERSLICE) of [`docs/av1/queue.md`](../../../../docs/av1/queue.md), by row 194's
protocol; the reading is in [`docs/codecs/README.md`](../../../../docs/codecs/README.md) §Beside the codec.

```bash
FRAMES=1 OUT_ROOT=/tmp/x lab/scripts/gen_htj2k_fixtures.sh g160  # builds ojph_compress once
client/decode/wasm/build/build.sh                                # the product's OpenJPH-WASM (docker)
lab/av1/fetch_data.sh xa_dynact16 dbt10_ea1141 dbt12_ea1141 ct_lidc
lab/av1/.venv/bin/python lab/av1/decode/inter-slice/make_pairs.py lab/.av1-work/interslice \
  lab/av1/data/{xa_dynact16,dbt10_ea1141,dbt12_ea1141,ct_lidc}                         # ~2 min, prints the bytes
NODE_PATH=$(npm root -g) node lab/av1/decode/inter-slice/interslice.mjs --rounds 12 --throttles 1,4  # ~1 h
NODE_PATH=$(npm root -g) node lab/av1/decode/inter-slice/interslice.mjs --rounds 1 --throttles 1 --mutate sample
```

**Pairs.** Slices (2k, 2k+1); an odd last slice is in neither arm. Across two samples with JPEG
2000's symmetric extension the 5/3 lifting is H = x1 − x0, L = x0 + ⌊(H + 1)/2⌋. L is coded as the
series' own frame is (signed in SIZ by `sign_htj2k.py` where the series is signed), H as a signed
frame one bit wider than the set's largest |H|. Both arms are the served profile (`ojph_compress`
0.31.0, 5 decompositions, 64×64 blocks, RPCL, reversible). Bytes are over every pair; decode over
the first 9 pairs (18 slices). JPEG 2000 Part 2's own multi-component transform is not in any
browser decoder here, so this is the arm the protocol names in its place.

**Arms**, each a worker of its own (`pair-worker.js`) on the product's OpenJPH-WASM build
(`client/decode/wasm/built`, its manifest's digests checked at load) through `client/decode/htj2k.js`:
`two` decodes the two served frames; `lift` decodes the two bands and inverts the step in JS,
taking each slice's range as it writes. The time is the worker's, from the pair's bytes to the two
slices with their ranges. One warm-up pair per worker, then the pairs one at a time.

**Order.** Every throttle cell is a fresh browser, in a Williams order each round
(`lab/order.mjs`); sets and arms rotate inside it. 4× is `lab/scripts/cpu_throttle.mjs` on the
browser's process tree.

**Checked.** `make_pairs.py` matches every slice with the checksum written when the series was
fetched, and every pair's bands, decoded by `ojph_expand` and inverted, with both. Each mutation
made it exit: the inverse's rounding dropped, H not shifted to unsigned, a slice checked against its
neighbour's checksum, H one bit too narrow. In the browser every slice's SHA-256 and its reported
range are checked: `--mutate sample` and `--mutate truth` turned every cell to 0/9; the inverse's
rounding dropped in the worker turned every `lift` cell to 0/9 and left `two` at 9/9; a maximum
reported one too high turned `lift` to 0–1/9.

**The run.** `summary.txt` is the printed bytes and timing of the run the reading quotes, `rows.json` its rows.

**Pins.** Node 22.22.0, playwright 1.56.1's Chromium 141.0.7390.37 (`CHROME_PATH` overrides), OpenJPH 0.31.0 for the
encoder, the product's decoder build as `client/decode/wasm/build/pins.sh` pins it, numpy from
`lab/av1/requirements.txt`. Nothing fetched, built or generated is committed.
