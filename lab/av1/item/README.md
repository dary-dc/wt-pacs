# lab/av1/item — the AV1 item, written and read

Queue row 39 (UNIFY) of [`docs/av1/queue.md`](../../../docs/av1/queue.md): the format of
[`docs/av1/item-format.md`](../../../docs/av1/item-format.md), built end to end. The client's half is
`client/downloader/av1*.js` ([`client/downloader/README.md`](../../../client/downloader/README.md)).

```bash
lab/av1/tools.sh && ARMS=simd lab/av1/dav1d-wasm/build.sh     # aomenc 3.15.1, native dav1d, dav1d-WASM
P=lab/av1/.venv/bin/python                                     # numpy, from lab/av1/requirements.txt
$P lab/av1/item/ingest.py lab/.av1-build lab/av1/data/rf_fluoro OUT --representation optimized --preset good:6
target/release/pack-study --metadata OUT/metadata.json --frames OUT --output rf_fluoro.sbnd
node lab/av1/item/check.mjs OUT                                # every item through the client's reader
$P lab/av1/item/make_golden.py lab/.av1-build                  # the client's golden items and probes
```

**`ingest.py`** reads a set as `lab/av1/fetch_data.py` writes it and writes `NNN.av1` items,
`NNN.sha256` (the source's checksums, copied) and `metadata.json` with `"codec": "av1"` and the
representation. It writes nothing at all unless every item decodes back: each stream unit alone
through native dav1d, at the depth it was coded at, merged as the client merges, against the
checksum written when the source was fetched. Refused before coding: RGB over 8 bits, grey over 14
bits after the offset unless `--split K` names the low bits coded apart (k ≤ 8, up to 16 bits, a top of
at most 12 — row 43's matrix; the defaults are unchanged). `--preset` is `cpu0`, `good:N` or `allintra:N` (row 14 names the fastest
within 2 % of cpu0's bytes per content); frames are coded in `--jobs` processes, each a run of
keyframes. RGB streams carry BT.709 primaries, the sRGB transfer and the identity matrix — AV1's RGB
signal; with the identity matrix alone Chromium's WebCodecs reports a BT.709 matrix, the 4:4:4
probes fail and every colour item goes to dav1d-WASM.

**`pack-study`** takes `NNN.av1` when the metadata says `"codec": "av1"` and `NNN.htj2k` otherwise.

**`make_golden.py`** writes seven synthetic 64×48 sources — 8, 10, 12 and 14-bit grey, 11 and 13-bit
signed, 8-bit RGB — with their checksums, and codes each through `ingest.py` in both representations
into `client/conformance/av1/items/`; and a 16×16 unit per layout WebCodecs may take (grey 8 and
10-bit, 4:4:4 8 and 10-bit) into `client/downloader/av1-probe.js`, with the FNV-1a of its coded
planes, checked against native dav1d before it is written.

## Checked (2026-10-05)

* **Real series, every item exact.** The first 8 frames of four series of
  [`docs/FIXTURES.md`](../../../docs/FIXTURES.md) §AV1 data, both representations, cpu0: 96 items,
  every one written (ingest's check) and every one decoded to its source by `check.mjs`. Optimized
  over plain: fluoroscopy 0.918, CT 0.990, MR 0.964, ultrasound 0.861 — row 28's ratios
  (fluoroscopy 0.942/1.027 = 0.917, MR 0.964, ultrasound 0.861) to the third digit.
* **The check catches what it must.** With the low stream left out of the merge, with RGB's planes
  unpermuted, or with the inverse colour transform's ⌊/4⌋ as ⌊/2⌋, `ingest.py` writes nothing and
  names the frame (3 mutations, each on a 13-bit signed and an RGB source, each caught).
