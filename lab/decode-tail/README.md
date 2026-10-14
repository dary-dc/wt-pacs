# decode-tail

After a fill's last byte, is the decoder pool finishing a backlog it could not have avoided, or work it left
waiting while a decoder sat idle? `run.mjs` runs a fill through the downloader (`page.js`) — or, with a
`direct:` variant, through the same TS transport on the page (`direct.js`) — against a server per set on
loopback, driverless Chromium, cells in a Williams order (`lab/order.mjs`). `range.mjs` times the range pass
alone in a worker; `decoder-reuse.js` and `decoder-split.js` are alternative decoder workers. The readings:
[`docs/decode/README.md`](../../docs/decode/README.md) §The decode tail, §The decode tail on a slow CPU and
§The range pass; the downloader against direct, [`docs/ARCHITECTURE.md`](../../docs/ARCHITECTURE.md)
§The downloader variant during a fill, against direct.

```bash
bash client/transport/ts/build.sh && client/decode/wasm/fetch_openjph.sh   # the TS client, the decoder package
lab/scripts/gen_htj2k_fixtures.sh c512 g512 s12                            # lab/fixtures/decode_*
NODE_PATH=$(npm root -g) node lab/decode-tail/run.mjs --rounds 7 --sets c512,g512 \
  [--variants name=[direct:]decoderDir,...] [--decoders 3] [--throttles 1,4,6] [--asks 20,43,66]
NODE_PATH=$(npm root -g) node lab/decode-tail/range.mjs [--rounds 7] [--throttles 1]
```

`run.mjs` builds `series-server` and `pack-series` and makes its own certificate. `--throttles` other than 1
is `lab/scripts/cpu_throttle.mjs`, which needs a writable `cpu` cgroup (v1, or a delegated v2 scope).
