# The viewer spike

Throwaway: options A (today's client and painter) and B (Cornerstone3D 5.13.2 painting today's client's frames), run as
[`docs/viewer/architecture.md`](../../docs/viewer/architecture.md) §The spike pre-registers them. The results and the
verdict are in that file, §The spike, as run. Delete this directory once the decision is recorded.

```bash
client/decode/wasm/build/build.sh && client/transport/ts/build.sh && cargo build --release -p series-server -p pack-series
lab/viewer-spike/b/build.sh                                   # Cornerstone3D at the lockfile's pins, into b/dist/cs.js
lab/av1/fetch_data.sh dbts_b1 ffdm_a && ingest/tools.sh       # the series, and the ingest's coders
python3 ingest/from-dicom/from_dicom.py ingest/.build lab/av1/data/dicom/<dbts_b1's key> W/dbts_b1.sbnd --codec htj2k
# ffdm_a: each view's object through from_dicom.py into W/v0..v3.sbnd, then one series of four frames:
python3 lab/viewer-spike/four_views.py target/release/pack-series W/ffdm_a.sbnd W/v0.sbnd W/v1.sbnd W/v2.sbnd W/v3.sbnd
R="node lab/viewer-spike/run.mjs --dbt W/dbts_b1.sbnd --ffdm W/ffdm_a.sbnd"
NODE_PATH=$(npm root -g) $R --gate --out gate.jsonl                            # the gate, measured first
NODE_PATH=$(npm root -g) $R --gate --mutate sample --out mutants.jsonl        # and --mutate row
NODE_PATH=$(npm root -g) $R --rounds 10 --out rows.jsonl && NODE_PATH=$(npm root -g) $R --summary --out rows.jsonl
```

`a/` and `b/` are each option's page and its glue; `source.js` and `views.css` are the page code both share (counted
in each option's glue); `run.mjs`, `four_views.py` and `mutants/` are the runner's.
