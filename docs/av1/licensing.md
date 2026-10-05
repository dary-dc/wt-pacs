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
| libjxl (`cjxl`, `djxl`) 0.7.0, the distro's | lab only (SIZE's reference column); not shipped | BSD-3-Clause | its own royalty-free patent grant (`PATENTS`, "Additional IP Rights Grant") | [LICENSE](https://raw.githubusercontent.com/libjxl/libjxl/main/LICENSE), [PATENTS](https://raw.githubusercontent.com/libjxl/libjxl/main/PATENTS); the package's `copyright` agrees |
| OpenJPEG 2.5.4 (`opj_compress`, `opj_decompress`, a WASM decoder) | lab only (row EMBED); not shipped | BSD-2-Clause | none granted (its licence says so) | [LICENSE](https://raw.githubusercontent.com/uclouvain/openjpeg/master/LICENSE), read from the pinned tag |
| libjxl 0.12.0 (`cjxl`, `djxl`, a WASM decoder) | lab only (row EMBED); not shipped | BSD-3-Clause; its WASM decoder links Highway (Apache-2.0 or BSD-3-Clause) and emscripten's libc++ (Apache-2.0 with LLVM exception) | its own royalty-free grant (`PATENTS`) | [LICENSE](https://raw.githubusercontent.com/libjxl/libjxl/main/LICENSE), [PATENTS](https://raw.githubusercontent.com/libjxl/libjxl/main/PATENTS), the submodules' own files at the pinned tag |
| OpenJPH (today's HTJ2K decoder) | client | BSD-2-Clause | — | [LICENSE](https://raw.githubusercontent.com/aous72/OpenJPH/master/LICENSE) |
| FFmpeg, the distribution's package (6.1.1, libaom 3.8.2, libdav1d 1.4.1) | lab only: makes WCAP's streams, decodes the native reference | GPL-2.0-or-later as that package is configured (`--enable-gpl`) | — | [LICENSE.md](https://raw.githubusercontent.com/FFmpeg/FFmpeg/master/LICENSE.md) |
| NumPy (2.4.6 in `fetch_data.sh`) | lab only: the synthetic frames, row DATA's extraction | BSD-3-Clause (its wheel also bundles 0BSD, MIT, Zlib, CC0 parts) | — | [LICENSE.txt](https://raw.githubusercontent.com/numpy/numpy/main/LICENSE.txt) |
| zlib 1.3 (through Python 3.11's `zlib`) and the browser's `DecompressionStream` | lab only (row ENCX: deflating the low bits); at ingest if adopted, and the browser's own code on the client, nothing shipped | zlib licence | — | [LICENSE](https://raw.githubusercontent.com/madler/zlib/master/LICENSE); `DecompressionStream`: [Compression Streams](https://compression.spec.whatwg.org/) |
| pydicom 3.0.1 | lab only: row DATA's extraction (`lab/av1/fetch_data.sh`, hash-pinned in `lab/av1/requirements.txt`) | MIT | — | PyPI metadata |
| LCEVCdec 4.2.2 (the MPEG-5 Part 2 decoder SDK), LCEVCdecJS 1.3.0 (its web decoder) | nowhere: read for row LCEVC, not built, fetched or shipped | BSD-3-Clause-Clear; its notice adds that the code must keep that licence when incorporated and that onward distribution stays under the patent exclusion | **none granted**: "No patent licenses are granted under this license", patent enquiries to the licensor; its commercial terms are royalty-bearing per service per secondary reports (2021), **unconfirmed** — the licensor's pages were refused by the container's network policy | [LICENSE.md](https://raw.githubusercontent.com/v-novaltd/LCEVCdec/main/LICENSE.md), [COPYING](https://raw.githubusercontent.com/v-novaltd/LCEVCdec/main/COPYING), [LCEVCdecJS LICENSE](https://raw.githubusercontent.com/v-novaltd/LCEVCdecJS/main/LICENSE) |
| Firefox 157.0 (via conda-forge, micromamba 2.9.0), WebKitGTK 2.52.6 with GStreamer 1.24 (Ubuntu 24.04), wabt 1.0.37 | lab only (row XBROWSER): the engines under test, `wasm-validate`; not shipped | Firefox MPL-2.0; WebKitGTK LGPL-2.1 and BSD-2-Clause; GStreamer LGPL-2.1-or-later; micromamba BSD-3-Clause; wabt Apache-2.0 | — | each package's own licence file as installed |
| AVM v1.0.0 (`avmenc`, `avmdec`; AV2's reference software, commit `966a7d7`) | lab only (row AV2); not shipped, and no browser decoder exists | BSD-3-Clause-Clear (`LICENSE`, © 2021 Alliance for Open Media): no patent rights granted by the code licence | its `PATENTS` is the AOM Patent License 1.0, byte-identical to libaom 3.15.1's (sha256 `661fb8e5…`); its grant covers “the specification designated … for which this License was issued”, and the tree does not say that AOM issued it for AV2's — **unconfirmed** | [LICENSE](https://raw.githubusercontent.com/AOMediaCodec/avm/v1.0.0/LICENSE), [PATENTS](https://raw.githubusercontent.com/AOMediaCodec/avm/v1.0.0/PATENTS), read from the pinned tag |

All of these are compatible with this repository's MIT licence — LCEVC's code too, though its
patents are not granted and no open LCEVC encoder exists ([`lab/av1/lcevc`](../../lab/av1/lcevc/README.md)).
Nothing is relicensed, and none but FFmpeg carries a copyleft or source-offer duty — which never reaches here, since the lab runs
it as a separate program, links nothing against it and ships nothing built from it.

## What it obliges

* **Shipping a binary is redistribution.** A dav1d `.wasm`, its glue, or a server or ingest binary
  linking an encoder carries each component's copyright notice, conditions and disclaimer in the
  materials shipped with it — a `THIRD_PARTY` notices file served beside the client.
* **The AOM Patent License text ships with any AV1 implementation we distribute** (§1.2), and a
  distributor makes its own necessary claims available under the same licence.
* **How the client meets both:** `lab/av1/dav1d-wasm/build.sh` writes `THIRD_PARTY.txt` beside the
  `.wasm` from the pinned sources' own files — dav1d's `COPYING` and `doc/PATENTS` (the AOM Patent
  License 1.0), emscripten's `LICENSE` and musl's `COPYRIGHT` — and the dispatch arm checks it is
  served there. Nothing is copied by hand, so a tag bump carries its own text.
* **Defensive termination** (§1.3): the patent licence ends for whoever starts patent litigation
  alleging an AV1 implementation infringes.
* **No endorsement**: VideoLAN's, AOM's or SVT-AV1's names are not used to promote this project
  (SVT-AV1's third clause).
* **Unconfirmed**: whether Emscripten's generated glue needs its notice (treated as yes).
* **What the dav1d build links** (`-Wl,--trace`, [`lab/av1/dav1d-wasm`](../../lab/av1/dav1d-wasm/README.md)):
  dav1d, emscripten's libc (musl, MIT), dlmalloc (public domain) and compiler-rt (Apache-2.0 with
  LLVM exception, whose exception waives notice for what compiles into a binary). No libc++: the
  wrapper is C. The libc++ question this line used to ask is answered by that.

## Data

The public series of row DATA ([`../FIXTURES.md`](../FIXTURES.md) §AV1 data) are CC BY 3.0 or
4.0, per series as the NCI Imaging Data Commons index records it: reuse, derivatives and
redistribution allowed with attribution. Fetched, never committed; anything derived from them that
is published carries the collection DOIs listed there.

Row TOTAL's LTE link replays mahimahi's `TMobile-LTE-short` trace (GPL-3.0), fetched by
`lab/av1/total/run.mjs` into a local cache and checked against the hash PROF recorded; a trace is
input to the lab's relay, never committed and never shipped.

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
