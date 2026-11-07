# residual-exact

Row RESIDEXACT. Does the residual (exact − decoded VL view), made on the server from native dav1d, rebuild the exact
frame on every client decoder? Equivalently (*derived*: the residual is added in exact integer arithmetic): does
every client decoder return native dav1d's samples? The result and its sources are
[`docs/av1/residual-exact.md`](../../../../docs/av1/residual-exact.md).

```bash
lab/av1/tools/tools.sh aom dav1d                    # libaom 3.15.1 (aomenc, aomdec), dav1d 1.5.4
lab/av1/fetch_data.sh dbts_a1 dbts_b1 dbts_c1
client/decode/wasm/build/build.sh                   # dav1d-WASM, checked against manifest.sha256
lab/av1/.venv/bin/python lab/av1/delivery/residual-exact/streams_test.py lab/.av1-build lab/.av1-work/rx-test
lab/av1/.venv/bin/python lab/av1/delivery/residual-exact/streams.py lab/.av1-build lab/.av1-work/rx \
  lab/.av1-work/rx.jsonl lab/av1/data/dbts_{a1,b1,c1}           # 20 VL views; native dav1d ×2, aomdec
node lab/av1/delivery/residual-exact/run.mjs lab/.av1-work/rx lab/.av1-work/rx-browser.jsonl   # Chromium
lab/av1/.venv/bin/python lab/av1/delivery/residual-exact/report.py lab/.av1-work/rx.jsonl lab/.av1-work/rx-browser.jsonl
# the comparison mutated: one sample flipped after decoding, in aomdec's and in each browser decoder's output
lab/av1/.venv/bin/python lab/av1/delivery/residual-exact/streams.py lab/.av1-build lab/.av1-work/rx-mutate \
  lab/.av1-work/rx-mutate.jsonl lab/av1/data/dbts_a1 --qs 8 --groups 16 --mutate
node lab/av1/delivery/residual-exact/run.mjs lab/.av1-work/rx-mutate lab/.av1-work/rx-mutate-browser.jsonl --mutate
```

| file | does |
| --- | --- |
| `streams.py` | codes each VL view with `aomenc_args` (the profiles branch's, checked identical at run time), refuses film grain, decodes with native dav1d `--threads=1` (the reference) and `--threads=4` and with `aomdec`, compares every luma sample; `--refs` writes the reference luma for the browser |
| `obu.py` | the sequence header's `film_grain_params_present`, copied from `lab/av1/profiles/obu.py` at `1232918d` |
| `decode.html`, `decode.mjs` | one cell through dav1d-WASM (the product's build) or WebCodecs, every luma sample against the reference, `copyTo()` with no `format` |
| `run.mjs` | headless Chromium (Playwright), the arms in rotated order per cell, the media log's decoder name per WebCodecs arm |
| `report.py` | the tables in the doc |
| `streams_test.py` | `compare()` sees one flipped sample; the grain flag reads 1 when denoising is on (both mutated: each fails when its check is broken) |

Only luma is compared: every view is 4:0:0, and the AV1 specification has a 4:0:0 decoder's U and V ignored
(§7.18.1: "If NumPlanes is equal to 1, then the U and V planes should be ignored"). Nothing is timed.
