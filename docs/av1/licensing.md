# AV1 — licences

What every AV1 component this phase may build, ship or fetch is licensed under, and what that
obliges. Checked 2026-10-03 against each project's own files (links below); **a risk note, not legal
advice** — several sources were read through a summarising fetch, so re-read the linked text before
relying on a clause. Anything not confirmed from a primary source says so.

## Components

| component | where it runs | code licence | patents | source |
| --- | --- | --- | --- | --- |
| dav1d | client (WASM), lab (CLI) | BSD-2-Clause | none in its licence; `doc/PATENTS` is the AOM Patent License 1.0 | [COPYING](https://raw.githubusercontent.com/videolan/dav1d/master/COPYING), [PATENTS](https://raw.githubusercontent.com/videolan/dav1d/master/doc/PATENTS) (the GitHub mirror; code.videolan.org refused the fetch) |
| libaom (`aomenc`) | ingest | BSD-2-Clause | AOM Patent License 1.0 | [LICENSE](https://aomedia.googlesource.com/aom/+/refs/heads/main/LICENSE), [PATENTS](https://aomedia.googlesource.com/aom/+/refs/heads/main/PATENTS) |
| SVT-AV1 | ingest | BSD-3-Clause-Clear since v0.9 (2022-01-19; BSD-2-Clause before) | AOM Patent License 1.0, separately — "Clear" grants no patent rights itself | [LICENSE.md](https://gitlab.com/AOMediaCodec/SVT-AV1/-/raw/master/LICENSE.md), [PATENTS.md](https://gitlab.com/AOMediaCodec/SVT-AV1/-/raw/master/PATENTS.md) |
| rav1e | ingest, if used | BSD-2-Clause | AOM Patent License 1.0 | [LICENSE](https://raw.githubusercontent.com/xiph/rav1e/master/LICENSE) |
| Emscripten runtime and glue | client | MIT / UIUC-NCSA, bundled musl MIT | — | [LICENSE](https://raw.githubusercontent.com/emscripten-core/emscripten/main/LICENSE) |
| WebCodecs | the browser's | — (the browser vendor's software) | — | [AV1 registration](https://w3c.github.io/webcodecs/av1_codec_registration.html) |
| OpenJPH (today's HTJ2K decoder) | client | BSD-2-Clause | — | [LICENSE](https://raw.githubusercontent.com/aous72/OpenJPH/master/LICENSE) |
| FFmpeg, the distribution's package (6.1.1, libaom 3.8.2, libdav1d 1.4.1) | lab only: makes WCAP's streams, decodes the native reference | GPL-2.0-or-later as that package is configured (`--enable-gpl`) | — | [LICENSE.md](https://raw.githubusercontent.com/FFmpeg/FFmpeg/master/LICENSE.md) |
| NumPy | lab only: the synthetic frames | BSD-3-Clause | — | [LICENSE.txt](https://raw.githubusercontent.com/numpy/numpy/main/LICENSE.txt) |

All of these are compatible with this repository's MIT licence: nothing is relicensed, and none
but FFmpeg carries a copyleft or source-offer duty — which never reaches here, since the lab runs
it as a separate program, links nothing against it and ships nothing built from it.

## What it obliges

* **Shipping a binary is redistribution.** A dav1d `.wasm`, its glue, or a server or ingest binary
  linking an encoder carries each component's copyright notice, conditions and disclaimer in the
  materials shipped with it — a `THIRD_PARTY` notices file served beside the client.
* **The AOM Patent License text ships with any AV1 implementation we distribute** (§1.2), and a
  distributor makes its own necessary claims available under the same licence.
* **Defensive termination** (§1.3): the patent licence ends for whoever starts patent litigation
  alleging an AV1 implementation infringes.
* **No endorsement**: VideoLAN's, AOM's or SVT-AV1's names are not used to promote this project
  (SVT-AV1's third clause).
* **Unconfirmed**: whether Emscripten's generated glue needs its notice (treated as yes).
* **What the dav1d build links** (`-Wl,--trace`, [`lab/av1/dav1d-wasm`](../../lab/av1/dav1d-wasm/README.md)):
  dav1d, emscripten's libc (musl, MIT), dlmalloc (public domain) and compiler-rt (Apache-2.0 with
  LLVM exception, whose exception waives notice for what compiles into a binary). No libc++: the
  wrapper is C. The libc++ question this line used to ask is answered by that.

## Patents, as a fact base

AOM's grant covers its members' and distributors' necessary claims only. Sisvel runs an AV1 pool
claiming patents held outside the Alliance ("nearly 2,000" at its 2019 launch); its 2019 statement
was that it will not seek royalties for encoded content and licenses hardware implementations only,
"but this could change" — its current terms are **unconfirmed** (the page moved). Avanci Video lists
AV1 among the standards it pools, aimed at streaming services; whether it reaches software or medical
imaging is **unconfirmed**. No court or regulator ruling on either pool's essentiality claims was
found. Residual risk is counsel's call, not this file's.

## DICOM

**DICOM defines no AV1 transfer syntax** (PS3.6 Annex A has no AV1 entry; video is MPEG-2/4, HEVC,
and Sup 225 multi-fragment video). Lossless AV1 is therefore this project's own frame format: the
store (SBND) is not DICOM, so nothing here breaks, but an archive exchanging AV1 frames as DICOM would
need a private transfer syntax and could not claim conformance for it. HTJ2K's lossless transfer
syntaxes are `1.2.840.10008.1.2.4.201` and `.202`.
