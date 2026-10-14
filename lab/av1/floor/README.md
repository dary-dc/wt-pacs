# floor

Queue row 194 (COMPLEMENT): how much any lossless coder could still save over HTJ2K, from each series' noise, and
what a linear term across slices is worth. The reading is in
[`docs/codecs/README.md`](../../../docs/codecs/README.md) §Beside the codec.

```bash
lab/av1/fetch_data.sh ct_lidc mr_ispy1 rf_fluoro xa_dynact16 dbt12_ea1141 dbt10_ea1141 dbtproj_holo
lab/av1/.venv/bin/python lab/av1/floor/floor.py lab/av1/data/{ct_lidc,mr_ispy1,rf_fluoro,xa_dynact16,dbt12_ea1141,dbt10_ea1141,dbtproj_holo} > rows.jsonl
```

**Per series, one row:** `floor_bits` [low, high] — bits a sample no coder can avoid, from the flattest quarter of
each intensity's 16×16 blocks taken as noise: *low* from Immerkær's high-pass σ (exact for white noise, low when the
noise is correlated, as CT's is), *high* from the residual of one 10-tap causal least-squares predictor fitted on
those blocks (high: a finite predictor cannot fully separate a smooth signal from the noise); each σ per intensity
bin is turned into the entropy of a Gaussian rounded to integers and averaged over every block. `pred2d_bits` and
`pred3d_bits`: the zero-order entropy of a per-frame 10-tap predictor's residual, without and with five taps from the
previous frame (`pred2d_bits_same_frames` drops the first frame, so the two compare). `sigma_by_intensity`: [bin's
lower edge, σ low, σ high].

**Checked.** `check()` runs first on every call: a white-noise field, a ramp, a twin slice, and a synthetic set (a
smooth body under σ 6, a textured band at σ 30, a constant pad) whose low floor must land within 0.1 bit of the
noise's. Each of seven mutations — the Immerkær constant, the Gaussian's width, the flat-block selection inverted, the
previous slice's taps dropped, the block order transposed, truncation for rounding, the noise mean over every block —
fails it.

**Pins.** numpy 2.4.6 from `lab/av1/requirements.txt` (hash-pinned); the sets as `lab/av1/data.json` pins them.
Nothing fetched is committed.
