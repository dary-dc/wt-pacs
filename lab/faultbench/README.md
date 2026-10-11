# faultbench

One fault for one frame, per decoder path and engine, and what the check, the second decode and the page do: queue
row 145 (FAULTBENCH). The reading is in [`docs/adr/exactness-in-production.md`](../../docs/adr/exactness-in-production.md)
§8, *The fault bench*.

```bash
cargo build --release -p series-server -p pack-series && client/decode/wasm/build/build.sh && bash client/decode/wasm/fetch_xxh3.sh
python3 lab/faultbench/run.py --firefox .../firefox --out rows.jsonl     # Chromium: CHROME_PATH or the lab's Playwright build
python3 lab/faultbench/run.py --summary rows.jsonl
```

**How the fault gets in.** The downloader takes its decoder worker from `config.decoderWorker`; the page points it at
`decode/decoder.js`, a symbolic link to the product's `client/decode/decoder.js`, so the worker runs it unchanged, but
its `./htj2k.js` and `./av1.js` resolve to this directory's wrappers, which re-export the product's modules with
`fault.js` around `decodeFrame`. `fault.js` reads the fault and the frame from the worker's query, and
`webcodecs=off` takes `VideoDecoder` away before the AV1 module looks for it, as `client/contract/webcodecs-spy.js`
does. The series are the contract's frames and golden payloads with their `xxhash` digests, linked under
`lab/.av1-work/faultbench/`. The control row, `none`, must deliver every frame exact.
