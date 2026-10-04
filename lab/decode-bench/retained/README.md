# retained

What a **viewer** costs, rather than a decoder. Every other bench in `lab/decode-bench/` releases
each frame as it goes; this one holds every frame of the series to the end, which is what a viewer
does, and weighs the three places the pixels can be kept. Results and what they mean:
[`docs/decode/README.md` §Retention, measured](../../../docs/decode/README.md).

Headless Chromium, because `performance.measureUserAgentSpecificMemory()` is the only instrument
that counts a WASM heap, a plain `ArrayBuffer` and a `SharedArrayBuffer` on the same scale.

```bash
lab/decode-bench/fetch_decoder.sh                          # the package build
FRAMES=87  lab/scripts/gen_htj2k_fixtures.sh c512          # the three series the lane asks for
FRAMES=237 lab/scripts/gen_htj2k_fixtures.sh g512
FRAMES=64  lab/scripts/gen_htj2k_fixtures.sh g2048
EMSDK=~/emsdk INITIAL_MB=4 lab/decode-bench/wasm/build.sh  # the build at its 4 MB floor

npm install -g playwright && export NODE_PATH="$(npm root -g)"
export CHROME_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome   # if playwright's pin differs
OUT=/tmp/r.json node lab/decode-bench/retained/run.mjs "?series=decode_g512"
```

| query | |
| - | - |
| `series` | `decode_c512` / `decode_g512` / `decode_g2048`; all three if omitted |
| `build` | `package` or `source4`; both if omitted |
| `pools` | instance counts, default `1,2,3,4` |
| `mutate=heap-reused` | make the retained arrangement reuse one decoder, so every frame aliases the last |

**Two things this harness depends on, both checked rather than assumed.**
`run.mjs` passes `--enable-blink-features=ForceEagerMeasureMemory`: without it Chromium delays
every `measureUserAgentSpecificMemory()` by 10–16 s by design, which is 5 calls a cell. The flag
does not cost accuracy — 256 MB allocated in a worker reads as +256 MB with it on, and dropping
the reference reads as −256 MB, so it still collects before it counts.
The heap size comes from `getEncodedBuffer(1).buffer.byteLength`, not `Module.HEAPU8`: the source
build exports no `HEAPU8`, and an emscripten `typed_memory_view` is backed by the WASM memory
itself, so the same expression measures both builds the same way. It agrees exactly with
`HEAPU8.length` where that exists.

**The mutant is the point of the ground-truth check.** `mutate=heap-reused` is the failure this
bench most needs to catch — an arrangement that keeps a frame the next decode overwrote — and it
must report `MISMATCH` on every frame but the last. Run it after any change to `worker.js`.
