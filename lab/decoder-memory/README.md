# decoder-memory

What **one decoder worker** costs the renderer, resident. The numbers and what they mean live in
[`docs/decode/README.md`](../../docs/decode/README.md) §What a decoder worker costs, resident;
this says how they were made.

```bash
cp -r <a worktree with them>/lab/fixtures/decode_g512 lab/fixtures/     # or gen_htj2k_fixtures.sh
cp ~/.cache/wt-pacs-decoder-2026-09-20/openjphjs.* lab/.openjph-build/deliver/   # the wrapper as delivered
PATH=~/.local/opt/node-v22.23.2-linux-x64/bin:$PATH \
NODE_PATH=~/.local/opt/node-v22.23.2-linux-x64/lib/node_modules \
CHROME_PATH=~/Apps/chrome-portable/opt/google/chrome/google-chrome \
  node lab/decoder-memory/run.mjs --rounds 6 --out /tmp/mem.jsonl
```

**A worker has no RSS of its own** — dedicated workers are threads in the page's renderer — so the
per-worker cost is a **slope in the worker count inside one arm**: the same page decodes the same
series at `decoders=1` and at `decoders=3`, and the answer is `(RSS₃ − RSS₁) / 2`. `run.mjs` finds
the renderer that appeared when the page opened (`--type=renderer`, a descendant of the browser
process, diffed against the set held before), samples `/proc/<pid>/status` every 100 ms, and keeps
the **peak** over the decodes and the **settled** value after
`performance.measureUserAgentSpecificMemory()` — which collects across the agent cluster before it
counts, so the settled figure is post-GC in the workers too. The same call gives the workers'
JS+WASM bytes, and the twin arms report each worker's WASM heap directly.

| query | |
| - | - |
| `arm` | `prod` (`client/downloader/decoder.js` as adopted) · `perdec1` (it, one frame in flight per worker) · `twin` (the bench's copy in the product's configuration) · `fresh` (a decoder object per frame) · `share` (one `WebAssembly.Module` compiled on the page for every worker) |
| `decoders` | workers, default 3 |
| `series` | a `lab/fixtures/decode_*` set, default `decode_g512` (237 × 512×512 × 16-bit) |
| `mutate` | `pixel` — flip a sample before the digest · `skip` — drop every fifth frame |
| `ballast` | MB each worker allocates and touches: the slope's calibration |
| `path` | `direct` (the workers alone) or `downloader` — the whole client, session included, which needs `exact-server` on a study of the same frames and `client/dev-transport.json` pointing at it |
| `hold` | `1` keeps every decoded frame to the end, as a viewer does |

`twin` exists so `fresh` and `share` differ from a running decoder by **one knob**, and it is run
as a cell of its own: it has to read as `prod` does, or the knobs are not the only difference.

**Every frame is checked against the `.sha256` the generator wrote from the encoder's input**, in
every cell, and `run.mjs` prints the cells that were not clean. Mutants: `mutate=pixel` must report
a mismatch, `mutate=skip` must report fewer frames checked than the series has, and `ballast=N`
must move the per-worker slope by N MB and nothing else.

**Read before trusting a number.** Memory, not time — the wall-clock column is context, and the
arms are not a timing claim. Container-free but shared box: cells are interleaved and the count
order rotates, so only within-round pairs are compared. The bench drives the decoder workers
directly, not through a session, because the term being weighed is inside the worker; if a decoder
worker's cost here ever fails to reproduce what the page-level ablation sees, the bench is wrong
and the full path is what to run.
