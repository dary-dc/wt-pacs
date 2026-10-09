# The client's decoder builds

The two WASM decoders the page loads, built by the product from pinned sources: OpenJPH for HTJ2K and dav1d for
AV1. Queue row 91 (DECODERBUILD) of [`docs/av1/queue.md`](../../../../docs/av1/queue.md); what each build is for and
what it measured is [`docs/decode/README.md`](../../../../docs/decode/README.md) §The build, as delivered.

```bash
client/decode/wasm/build/build.sh            # ~3 min on 4 cores; needs docker, git, curl, python3 with pip
UPDATE=1 client/decode/wasm/build/build.sh   # after a change to a pin, a flag or a wrapper: rewrite the manifest
```

`build.sh` fetches every input into `.cache/` and checks each by commit or sha256, then builds in a container
with no network, the repository mounted at its own path. The outputs land in `client/decode/wasm/built/`; it
refuses to finish unless their sha256 match [`manifest.sha256`](manifest.sha256). Nothing fetched or built is
committed. The page checks what it loads against the same manifest (`wasm-glue.js`, `built()`), and so does
`scripts/gate.sh`, which also calls a build stale when its recipe or a wrapper is newer.

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
| hash-wasm (its `LICENSE`, for the notices) | 4.12.0 | `client/decode/wasm/fetch_xxh3.sh`'s tarball sha256 |

## The builds

| output | from | flags |
| --- | --- | --- |
| `openjph/openjph.{js,wasm}` | [`../openjph/htj2k_decoder.cpp`](../openjph/htj2k_decoder.cpp) over OpenJPH with [`../openjph/cb-threads.patch`](../openjph/cb-threads.patch) | `-O3 -msimd128 -fexceptions -pthread -DOJPH_CB_THREADS=1 -sPTHREAD_POOL_SIZE=1 -sINITIAL_MEMORY=4MB -sALLOW_MEMORY_GROWTH=1` |
| `dav1d/dav1d.{js,wasm}` | [`../dav1d/dav1d_wrap.c`](../dav1d/dav1d_wrap.c) over dav1d | the lab's `simd` arm: `-O3 -msimd128`, `-Dbitdepths=8,16 -Denable_asm=false` |
| `THIRD_PARTY_NOTICES` | every licence the page's code ships under | [`docs/av1/licensing.md`](../../../../docs/av1/licensing.md) §What it obliges |

The OpenJPH build is row HTJ2KMT's adopted one: the code-block pool with one helper thread, so a page that loads it
is cross-origin isolated, as the client already requires. Its range is taken as it packs, except for an 8-bit
unsigned 3-component frame, whose `getRange()` is empty (min > max) and whose window comes from the tags; the
switch is the `pack<…, Ranged>` template argument, chosen per frame from the header.

**Reproducible.** Each compile maps the build directory, the repository and the cache with `-ffile-prefix-map`
(OpenJPH's assertions carry `__FILE__`), so a clone at another path builds the same bytes: the manifest is that
claim, checked on every build.
