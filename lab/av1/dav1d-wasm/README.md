# dav1d in WASM

dav1d built with emscripten, a wrapper in the shape `decoder.js` needs, and a check that it is exact.
Row 4 (WASM) of [`docs/av1/queue.md`](../../../docs/av1/queue.md); the verdict is in
[`docs/av1/README.md`](../../../docs/av1/README.md) §A2.

```bash
lab/av1/dav1d-wasm/build.sh          # emsdk, dav1d, native CLI, three WASM arms -> lab/.av1-build
lab/av1/dav1d-wasm/make_streams.sh   # lossless test streams -> lab/.av1-build/streams
node lab/av1/dav1d-wasm/exact.mjs    # every frame, every arm; MUTATE=sample|order to watch it fail
```

Nothing built or generated is committed; everything lands in `lab/.av1-build` (gitignored).

## Pins

| tool | version | how |
| --- | --- | --- |
| dav1d | 1.5.4, commit `54706fc6bc0cdecab7e9593974a4039cc038fca7` | git tag, commit checked by `build.sh` |
| emscripten | 3.1.74 (emsdk tag `3.1.74`), the version the shipped HTJ2K decoder is built with | emsdk |
| meson | 1.5.2 | pip, in `lab/.av1-build/venv` |
| numpy | 2.1.3 | pip, same venv, for `gen_frame_pnm.py` |
| encoder | the host's ffmpeg 6.1.1-3ubuntu5 with libaom 3.8.2-2ubuntu0.1 | apt; row 1 owns the encoders |
| second native decoder | the same ffmpeg's libdav1d 1.4.1-1build1, with its assembly | apt |

## The build

`meson` with an emscripten cross file, `-Dbitdepths=8,16 -Denable_asm=false -Denable_tests=false
-Dlogging=false --buildtype=release`, static; the wrapper (`dav1d_wrap.c`) linked with `emcc -O3
-sMODULARIZE=1 -sALLOW_MEMORY_GROWTH=1`. The native reference is the same tag and options with the
CLI on: its assembly is off too (no nasm on the host), so the second native decoder, ffmpeg's
libdav1d, is the one that runs assembly.

| arm | compile flags | link | `.wasm` | gzip -9 |
| --- | --- | --- | --- | --- |
| plain | — | — | 546 284 B | 218 863 B |
| simd | `-msimd128` | — | 623 042 B | 237 924 B |
| simd-mt | `-msimd128 -pthread` | `-sPTHREAD_POOL_SIZE=4` | 635 174 B | 243 738 B |

`-msimd128` is the compiler's auto-vectorisation only: dav1d has no hand-written WASM SIMD. The
threaded arm builds and decodes (four threads, Node 22); in a browser it needs cross-origin
isolation, which the client already has for its `SharedArrayBuffer`s, and its pool is workers spawned
from inside a decoder worker. The emscripten glue is not counted in the sizes.

What the link pulls in (`-Wl,--trace`): `libdav1d.a`, emscripten's libc (musl, MIT), dlmalloc
(public domain) and compiler-rt (Apache-2.0 with LLVM exception). No libc++: the wrapper is C.

## The wrapper

The client's own module is `client/downloader/decode-av1.js`, which runs the `simd` arm and flushes
before every keyframe (every frame at G = 1); `make_client_frames.sh` makes its warm-ups and
conformance frames, the two group sets (G = 8 and one group) coded without alt-ref frames.
`build.sh` also writes `THIRD_PARTY.txt` beside the builds — the notices a shipped build owes.

`dav1d.mjs`: `createDecoder(factory, {threads})` gives `decode(bytes)` — one temporal unit in, one
picture out as tightly packed planes (`Uint8Array` at 8 bits, `Uint16Array` above), with `width`,
`height`, `bits`, `layout` and `matrix` — and `close()`. One decoder holds a group's reference state
from its keyframe on. dav1d runs with `max_frame_delay = 1`, so a temporal unit gives its picture
back before the next goes in. `ivfFrames` splits an IVF file into temporal units, which is what the
store would hold per frame.

## The streams

256 × 256, 16 frames, from `lab/scripts/gen_frame_pnm.py` — `ct` content for grey, `cine` for colour —
written planar (`pnm_planar.py`) and coded by ffmpeg's libaom with `-aom-params lossless=1
-cpu-used 6 -g G -keyint_min G`, G = 1 (intra) and 8 (inter), into IVF:

| cell | ffmpeg `-pix_fmt` | profile | layout |
| --- | --- | --- | --- |
| g8, g10, g12 | `gray`, `gray10le`, `gray12le` | Main, Main, Professional | 4:0:0 |
| c8, c10, c12 | `gbrp`, `gbrp10le`, `gbrp12le` with `-colorspace rgb` | High, High, Professional | 4:4:4, identity matrix (G, B, R as Y, U, V) |

libaom's defaults keep a look-ahead, so the G = 8 streams carry hidden alt-reference frames: their
temporal units hold 1, 3, 1, 1, 2, 1, 1, 1 frame OBUs per group. Every unit still shows exactly one
frame.

## Exactness

`exact.mjs` decodes every stream with each arm and checks every frame against four things: the
generator's `.sha256` of its samples (interleaved, the ground truth), the planar input fed to the
encoder, the native dav1d CLI (`--muxer yuv`) and ffmpeg's libdav1d. **Every arm matches both native
decoders on every frame**: 3 arms × 12 streams × 16 frames, one picture per temporal unit, in order,
threads on and off.

Against the input, 27 of 36 stream runs are exact — every intra stream, and inter at 8 bits and at
c10. The other three streams (each in all three arms) are **libaom 3.8.2's, not a decoder's**: all
three decoders agree and the input differs.

| stream | frames wrong | samples wrong | max \|Δ\| |
| --- | --- | --- | --- |
| g10 G = 8 | 2 of 16 | 3 of 1 048 576 | 1 |
| g12 G = 8 | 6 of 16 | 15 904 of 1 048 576 | 11 |
| c12 G = 8 | 6 of 16 | 144 of 3 145 728 | 2 |

Mutations, run against the simd arm: one sample flipped in the WASM output (`MUTATE=sample`) fails
all 12 streams against both natives; the colour planes interleaved in the wrong order
(`MUTATE=order`) fails all 6 colour streams, because the two ground truths then disagree.
