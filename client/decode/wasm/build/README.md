# The client's decoder builds

The two WASM decoders the page loads, built by the product from pinned sources: OpenJPH for HTJ2K and dav1d for
AV1; and, since the frame check's speed measurement, its XXH3-64 from xxHash. Built by the decoder-build row (queue
row 91, DECODERBUILD, [`docs/av1/queue.md`](../../../../docs/av1/queue.md)); what each build is for and
what it measured is [`docs/decode/README.md`](../../../../docs/decode/README.md) §The build, as delivered.

The outputs are committed in `client/decode/wasm/built/` (owner's decision D2, 2026-10-21): a clone or a `git archive`
deploys them as they are, and building them is a way to verify or change them, not a deploy step.

```bash
client/decode/wasm/build/build.sh            # ~3 min on 4 cores; needs docker, git, curl, python3 with pip
UPDATE=1 client/decode/wasm/build/build.sh   # after a change to a pin, a flag or a wrapper: rewrite the manifest, commit both
```

`build.sh` fetches every input into `.cache/` and checks each by commit or sha256, then builds in a container
with no network, the repository mounted at its own path. The outputs land in `client/decode/wasm/built/`; it
refuses to finish unless their sha256 match [`manifest.sha256`](manifest.sha256). Nothing fetched is committed.
The page checks what it loads against the same manifest (`wasm-glue.js`, `built()`). `scripts/gate.sh` checks the
committed bytes against it, every file and no other; in full (not `--quick`) it rebuilds into `build/.rebuilt` and
fails unless the rebuild is the committed bytes, so an input edited without a rebuild is caught by content, not mtime.

## Pins

Every pin is in [`pins.sh`](pins.sh) and [`requirements.txt`](requirements.txt); the scripts refuse any other.

| input | pin | checked by |
| --- | --- | --- |
| base image | Debian `bookworm-slim` by digest, apt from snapshot.debian.org `20261001T000000Z` | digest; apt versions named |
| emscripten | 3.1.74, release `c2655005…`, `wasm-binaries.tar.xz` | sha256, and `emcc --version` in the container |
| Node (emscripten's) | 18.20.3, the emsdk 3.1.74 pin | sha256 |
| cmake, meson, ninja | 3.31.6, 1.5.2, 1.11.1.4, wheels | `pip --require-hashes`, and `cmake --version` |
| OpenJPH | 0.31.0, commit `c68064d0…` | commit, and `ojph_version.h` in the container |
| dav1d | 1.5.4, commit `54706fc6…` | commit, and `meson.build`'s version in the container |
| xxHash | v0.8.4, commit `c87183a7…` | commit, and `xxhash.h`'s version in the container |
| hash-wasm (its `LICENSE`, for the notices) | 4.12.0 | `client/decode/wasm/fetch_xxh3.sh`'s tarball sha256 |

## The builds

| output | from | flags |
| --- | --- | --- |
| `openjph/openjph.{js,wasm}` | [`../openjph/htj2k_decoder.cpp`](../openjph/htj2k_decoder.cpp) over OpenJPH | `-O3 -msimd128 -fexceptions -sINITIAL_MEMORY=4MB -sALLOW_MEMORY_GROWTH=1`, one thread |
| `dav1d/dav1d.{js,wasm}` | [`../dav1d/dav1d_wrap.c`](../dav1d/dav1d_wrap.c) over dav1d | the lab's `simd` arm: `-O3 -msimd128`, `-Dbitdepths=8,16 -Denable_asm=false` |
| `xxh3/xxh3.wasm` | [`../xxh3/xxh3.c`](../xxh3/xxh3.c) over xxHash's `xxhash.h`: the frame check's XXH3-64 | `-O3 -msimd128`, a bare module (`-sSTANDALONE_WASM`), 128 KiB fixed |
| `THIRD_PARTY_NOTICES` | every licence the page's code ships under | [`docs/av1/licensing.md`](../../../../docs/av1/licensing.md) §What it obliges |

The OpenJPH build is single-threaded: a code-block pool (queue row HTJ2KMT) lost a cold ask at 4× here and won no fill
(docs/decode/README.md §The build, as delivered). Its range is taken as it packs, except for an 8-bit unsigned
3-component frame, whose `getRange()` is empty (min > max) and whose window comes from the tags; the switch is the
`pack<…, Ranged>` template argument, chosen per frame from the header.

**Reproducible.** Each compile maps the build directory, the repository and the cache with `-ffile-prefix-map`
(OpenJPH's assertions carry `__FILE__`), so a clone at another path builds the same bytes: the manifest is that
claim, checked on every build.
