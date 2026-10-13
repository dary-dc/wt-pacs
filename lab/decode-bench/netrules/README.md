# netrules

Queue row NETMEASURE of [`docs/av1/queue.md`](../../../docs/av1/queue.md): row NETRULES' three protocols run as
written ([`docs/decode/README.md`](../../../docs/decode/README.md) §Not yet tried, *Net protocols*), each judged by
[`lab/scripts/aa_rule.py`](../../scripts/aa_rule.py) against an A/A arm run in the same rounds. The reading is in that
section's §Measured.

```bash
dockerd &                                      # the decoder builds need docker
client/decode/wasm/build/build.sh              # the delivered build, checked against its manifest
lab/decode-bench/emsdk/build.sh                # em6: the same recipe under emscripten 6.0.11, names restored
lab/decode-bench/copy/build.sh                 # pt and copy
client/transport/ts/build.sh
lab/av1/fetch_data.sh dbt12_ea1141 dbt12_c dbtproj_ge syn2d_d ffdm_d usrgb_aml usrgb_apollo usrgb_crc usrgb_lca usrgb_mel usrgb_stad
PATH=lab/av1/.venv/bin:$PATH FRAMES=1 OUT_ROOT=/tmp/x lab/scripts/gen_htj2k_fixtures.sh g160   # ojph_compress, once
D=lab/av1/data; lab/av1/.venv/bin/python lab/decode-bench/emsdk/make_frames.py lab/.av1-work/netrules g512 c512 \
  $D/dbt12_ea1141 $D/dbt12_c $D/dbtproj_ge $D/syn2d_d $D/ffdm_d $D/usrgb_{aml,apollo,crc,lca,mel,stad}
lab/decode-bench/netrules/arms.sh              # the A/A copies, the fill's copy worker, every set's variants.json
cp lab/.openjph-build/wasm/em6mut.js lab/.av1-build/ojph-wasm/em6mut-6.0.11.js   # and em6.wasm as em6mut-6.0.11.wasm
NODE_PATH=$(npm root -g) node lab/decode-bench/netrules/wasm_fetches.mjs --arms ojph-del-3.1.74,ojph-em6-6.0.11,ojph-em6mut-6.0.11
export FIREFOX_PATH=.../FirefoxApp/firefox     # Firefox 157.0.1, below
R=lab/decode-bench/netrules/run.sh             # each round after /proc/stat's steal reads ≤ 2 % over 10 s
$R emsdk-frame 12; $R emsdk-net 12; $R start-net 12; $R copy-frame 12; $R copy-memory 3; $R copy-net 12
python3 lab/decode-bench/netrules/cells.py emsdk-net [--confirm emsdk-net-confirm]    # a line a cell, the rule's verdict
```

**Arms.** `del` is the delivered build. The A/A arm is the same build under a second name: `delcopy` its `.js` and
`.wasm` copied (sha256 equal) for EMSDKNET and COPYRGB, `delname` the same `variants.json` entry under another key for
STARTAA. `em6` is row 134's 6.0.11 build with `wasmBinary` and `mainScriptUrlOrBlob` restored; `copy` and `pt` are row
134's. In a fill, `copy` runs `client/decode/decoder.js` with its codec module swapped for `../copy/htj2k-copy.js`
(`arms.sh` writes it; nothing else differs). `need` is the downloader's `startOnNeed`. Every arm: the series server
at `cubic-restart` and quinn's initial window, the same relay, Chromium 141.0.7390.37 (Playwright 1.56.1).

**Links** (`total-time/run.mjs`'s `n<kbit/s>`): 23 ms each way and a FIFO of `--queue-ms 650`, the relay on a core of
its own. **Firefox** 157.0.1 (BuildID 20261005135250), conda-forge `firefox-157.0.1-hee9eb32_0.conda` (SHA-256
`f1b53de244dc14b0a0d2d848aa41d7cf0edb95992cd477dccac40ff4d7127f35`) installed by micromamba 2.9.0
(`micromamba-2.9.0-0.tar.bz2`, SHA-256 `8761c382127e6363bd9e0a2451aa3ef90d071a79133f736e2f759a3bf13040dd`); stock
Firefox takes its work from the page's query and posts the rows back (`../copy/run.mjs --engine firefox`).

**Checked.** Every frame against the `.sha256` written from the encoder's input; `--mutate sample` and `--mutate truth`
failed every frame of every arm in each harness (`newer/decode.mjs`, `copy/run.mjs` in both engines, `total-time/run.mjs`
for a fill and a cold ask). `wasm_fetches.mjs` counts the `.wasm` requests of a page and its workers: one for `del`
and `em6`; the mutant `em6mut` (the glue's `wasmBinary` line removed) asks four and decodes nothing.

Nothing built or fetched is committed; `raw/` holds the rounds as measured.
