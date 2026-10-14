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
| libjxl (`cjxl`, `djxl`) 0.7.0, the distro's | lab only (the lossless-bytes measurement's reference column, queue row SIZE); not shipped | BSD-3-Clause | its own royalty-free patent grant (`PATENTS`, "Additional IP Rights Grant") | [LICENSE](https://raw.githubusercontent.com/libjxl/libjxl/main/LICENSE), [PATENTS](https://raw.githubusercontent.com/libjxl/libjxl/main/PATENTS); the package's `copyright` agrees |
| OpenJPEG 2.5.4 (`opj_compress`, `opj_decompress`, a WASM decoder) | lab only (the embedded-codec measurement, queue row EMBED); not shipped | BSD-2-Clause | none granted (its licence says so) | [LICENSE](https://raw.githubusercontent.com/uclouvain/openjpeg/master/LICENSE), read from the pinned tag |
| libjxl 0.12.0 (`cjxl`, `djxl`, a WASM decoder) | lab only (the embedded-codec measurement); not shipped | BSD-3-Clause; its WASM decoder links Highway (Apache-2.0 or BSD-3-Clause) and emscripten's libc++ (Apache-2.0 with LLVM exception) | its own royalty-free grant (`PATENTS`) | [LICENSE](https://raw.githubusercontent.com/libjxl/libjxl/main/LICENSE), [PATENTS](https://raw.githubusercontent.com/libjxl/libjxl/main/PATENTS), the submodules' own files at the pinned tag |
| OpenJPH (today's HTJ2K decoder) | client | BSD-2-Clause | — | [LICENSE](https://raw.githubusercontent.com/aous72/OpenJPH/master/LICENSE) |
| FFmpeg, the distribution's package (6.1.1, libaom 3.8.2, libdav1d 1.4.1) | lab only: makes the WebCodecs capability probe's streams (queue row WCAP), decodes the native reference, and decodes the breast-family measurement's ultrasound clips and stills in `fetch_data.sh` (queue row BREAST), and reads the sequence headers the per-stream codec string is derived from (queue row CODECSTR) (`trace_headers`, `ffprobe`) | GPL-2.0-or-later as that package is configured (`--enable-gpl`) | — | [LICENSE.md](https://raw.githubusercontent.com/FFmpeg/FFmpeg/master/LICENSE.md) |
| NumPy (2.4.6 in `fetch_data.sh`) | lab only: the synthetic frames, the public series' extraction (queue row DATA) | BSD-3-Clause (its wheel also bundles 0BSD, MIT, Zlib, CC0 parts) | — | [LICENSE.txt](https://raw.githubusercontent.com/numpy/numpy/main/LICENSE.txt) |
| zlib 1.3 (through Python 3.11's `zlib`) and the browser's `DecompressionStream` | lab only (the low-stream measurement, queue row ENCX: deflating the low bits); at ingest if adopted, and the browser's own code on the client, nothing shipped | zlib licence | — | [LICENSE](https://raw.githubusercontent.com/madler/zlib/master/LICENSE); `DecompressionStream`: [Compression Streams](https://compression.spec.whatwg.org/) |
| pydicom 3.0.1 | lab only: the public series' extraction (`lab/av1/fetch_data.sh`, hash-pinned in `lab/av1/requirements.txt`) | MIT | — | PyPI metadata |
| LCEVCdec 4.2.2 (the MPEG-5 Part 2 decoder SDK), LCEVCdecJS 1.3.0 (its web decoder) | nowhere: read for the LCEVC study (queue row LCEVC), not built, fetched or shipped | BSD-3-Clause-Clear; its notice adds that the code must keep that licence when incorporated and that onward distribution stays under the patent exclusion | **none granted**: "No patent licenses are granted under this license", patent enquiries to the licensor; its commercial terms are royalty-bearing per service per secondary reports (2021), **unconfirmed** — the licensor's pages were refused by the container's network policy | [LICENSE.md](https://raw.githubusercontent.com/v-novaltd/LCEVCdec/main/LICENSE.md), [COPYING](https://raw.githubusercontent.com/v-novaltd/LCEVCdec/main/COPYING), [LCEVCdecJS LICENSE](https://raw.githubusercontent.com/v-novaltd/LCEVCdecJS/main/LICENSE) |
| Firefox 157.0 (via conda-forge, micromamba 2.9.0), WebKitGTK 2.52.6 with GStreamer 1.24 (Ubuntu 24.04), wabt 1.0.37 | lab only (the WebKit and Firefox decode measurement, queue row XBROWSER): the engines under test, `wasm-validate`; not shipped | Firefox MPL-2.0; WebKitGTK LGPL-2.1 and BSD-2-Clause; GStreamer LGPL-2.1-or-later; micromamba BSD-3-Clause; wabt Apache-2.0 | — | each package's own licence file as installed |
| Chrome for Testing 154.0.8037.92 headless shell (its JPEG XL decoder jxl-rs 0.6 inside), Firefox 157.0.1 (via conda-forge, micromamba 2.9.0) | lab only (the JPEG XL measurement, queue row JXL): the engines under test; not shipped | Chromium BSD-3-Clause and its third-party notices; jxl-rs BSD-3-Clause; Firefox MPL-2.0 | not read here | each package's own licence file as installed |
| gst-plugin-dav1d 0.13.7 (crates.io, SHA-256 `52614ade…7afb3f6`), built against Ubuntu 24.04's libdav1d7 1.4.1 and GStreamer 1.24.2 | lab only (the cross-engine exactness study, queue row XENGINE): a GStreamer AV1 decoder that takes WebKitGTK's frame alignment; not shipped | MIT OR Apache-2.0; dav1d BSD-2-Clause | — | the crate's `Cargo.toml` |
| Firefox (`FIREFOX_157_0_RELEASE`, `fdd757a2`) and WebKit (`webkitgtk-2.52.6`, `4fb33923`) sources | nowhere: read for the cross-engine exactness study, not built | MPL-2.0; LGPL-2.1 and BSD-2-Clause | — | each tree's licence files |
| AVM v1.0.0 (`avmenc`, `avmdec`; AV2's reference software, commit `966a7d7`) | lab only (the AV2 measurement, queue row AV2); not shipped, and no browser decoder exists | BSD-3-Clause-Clear (`LICENSE`, © 2021 Alliance for Open Media): no patent rights granted by the code licence | its `PATENTS` is the AOM Patent License 1.0, byte-identical to libaom 3.15.1's (sha256 `661fb8e5…`); its grant covers “the specification designated … for which this License was issued”, and the tree does not say that AOM issued it for AV2's — **unconfirmed** | [LICENSE](https://raw.githubusercontent.com/AOMediaCodec/avm/v1.0.0/LICENSE), [PATENTS](https://raw.githubusercontent.com/AOMediaCodec/avm/v1.0.0/PATENTS), read from the pinned tag |
| hash-wasm 4.12.0 (npm, its `LICENSE` read from the tarball); blake3 1.0.8 and xxhash 3.6.0 (PyPI wheels, hash-pinned in `lab/av1/exact/in-production/requirements.txt`) | lab only (the in-production exactness design, queue row EXACTPROD): the hashes timed in the browser, and the truth's independent hashers; not shipped | hash-wasm MIT; blake3 CC0-1.0 OR Apache-2.0; xxhash BSD-2-Clause (each wheel's metadata) | — | the package files |
| hash-wasm 4.12.0, its single-algorithm XXH3 build (`dist/xxhash3.umd.min.js`, 18 KB with its WASM inline; `client/decode/wasm/fetch_xxh3.sh`, tarball sha256 pinned); xxhash 3.6.0 (PyPI wheel, hash-pinned in `lab/av1/requirements.txt`) | client (the decoder worker's frame check before row 179, now behind `hasher: "hash-wasm"`), ingest (the frame digest) | hash-wasm MIT; xxhash BSD-2-Clause, wrapping xxHash (BSD-2-Clause) | — | the tarball's `LICENSE`; the wheel's metadata |
| xxhash-rust 0.8.19 (crates.io, its `xxh3` feature, checksum in `Cargo.lock`); blake3 1.0.8 (PyPI wheel, hash-pinned in `lab/av1/requirements.txt`) | ingest: the Rust ingest's raw-frame check and frame digest (`ingest/from-parser`); the parser mirror's group-file names, a stand-in not shipped | xxhash-rust BSL-1.0; blake3 CC0-1.0 OR Apache-2.0 | — | the crate's `LICENSE` and `Cargo.toml`; the wheel's metadata |
| xxHash v0.8.4 (git tag, commit `c87183a7…c695e4f0` checked), built to WASM under the decoders' pinned emscripten (`client/decode/wasm/build`; the lab's two arms by `lab/av1/exact/hashfast/build.sh`) | client (the decoder worker's frame check since row 179, `xxhash.h` alone, `-msimd128`); lab (row 179's bench, a scalar build beside it) | BSD-2-Clause | — | the tag's `LICENSE`, beside the build and in `THIRD_PARTY_NOTICES` |
| OpenHTJ2K v0.19.0 (commit `e0f7ae8`), built to WASM with a lab wrapper | lab only (the region-decode measurement, queue row REGIONDECODE): region and stripe decode; not shipped | BSD-3-Clause (© Osamu Watanabe); its bundled Highway (Apache-2.0) is not compiled in — the one include is commented out | — | [LICENSE](https://raw.githubusercontent.com/osamu620/OpenHTJ2K/v0.19.0/LICENSE), read from the pinned tag |
| OpenJPH 0.31.0's cleanup-pass decoder (`ojph_block_decoder32.cpp`) and VLC tables (`table0.h`, `table1.h`), ported to WGSL and JavaScript | lab only (the WebGPU block decoder, queue row WEBGPUHT): `lab/av1/decode/webgpuht`; not shipped. The tables are read from the pinned clone at run time, not committed | BSD-2-Clause (© 2019 Aous Naman, Kakadu Software, UNSW); the port keeps OpenJPH's notice in `LICENSE.OpenJPH` beside it | — | [LICENSE](https://raw.githubusercontent.com/aous72/OpenJPH/0.31.0/LICENSE), read from the pinned clone |
| Chrome for Testing (stable, beta and canary, the newest each run; 155.0.8059.39, 156.0.8078.12 and 157.0.8097.0 on 2026-10-11), Firefox release and nightly (157.0.1, checked against Mozilla's `SHA256SUMS`; 160.0a1 build 20261010192814, against its `.checksums`); Python's `cryptography` (50.0.1, the distribution's) | lab only (`scripts/wtcompat.py`, queue row WTCOMPAT): the browsers that dial, and the decryption of their dials; not shipped | Chromium BSD-3-Clause and its third-party notices; Firefox MPL-2.0; `cryptography` Apache-2.0 or BSD-3-Clause | not read here | each package's own licence file as installed |
| quiche (`541aa2a`, `0b2bc13`, `a162819`), Chromium `net/` at the three channels' commits, neqo (v0.31.1, v0.32.0, `main` `cce5f8f`, branch `users/jesup/ietf_draft_15_support` `c3d983e`), Firefox's `neqo_glue`, WebKit `56118d9`, quinn `38b9f52`, wtransport `b16674e` | nowhere: read for the draft-compatibility study (queue row WTCOMPAT), not built | quiche BSD-3-Clause; neqo MIT or Apache-2.0; WebKit LGPL-2.1 and BSD-2-Clause; quinn and wtransport MIT or Apache-2.0 | — | each tree's licence files |
| Speedtest by Ookla Global Fixed and Mobile Network Performance Maps (2026 Q3 parquet tiles); M-Lab NDT daily statistics (2024); pyarrow 17.0.0 and NumPy 2.1.2 (PyPI, a throwaway venv) | lab only (the link-conditions study, queue row LINKREAL: `lab/link-conditions/`); fetched and checksummed, never committed or shipped | Ookla's data CC BY-NC-SA 4.0 (attribution given in `docs/transport/link-conditions.md`; non-commercial, so only derived percentiles are quoted, and whether a commercial deployment may rely on them is the owner's to read); M-Lab's NDT data CC0 1.0; pyarrow Apache-2.0; NumPy BSD-3-Clause | — | [Ookla README](https://github.com/teamookla/ookla-open-data/blob/master/README.md), [M-Lab data use](https://support.measurementlab.net/help/en-us/10-data/7-how-is-the-data-collected-through-m-lab-tests-used) |
| FFmpeg n7.1 (`b08d796`) `libavformat/`, GPAC's, MKVToolNix's, MediaInfo's, DCMTK's and pydicom's licence files and docs | nowhere: read for the containers study (queue row CONTAINERS), not built | FFmpeg LGPL-2.1-or-later (GPL-2.0-or-later with `--enable-gpl`); GPAC LGPL-2.1-or-later; MKVToolNix GPL-2.0; MediaInfo BSD-2-Clause; DCMTK BSD-3-Clause; pydicom MIT | — | each tree's licence files ([`../disk-layout/containers.md`](../disk-layout/containers.md) §10) |
| FFmpeg 6.1.1 (the distribution's, `6.1.1-3ubuntu5`), pydicom 3.0.1 (hash-pinned in `lab/av1/requirements.txt`), meson 1.5.2 (PyPI, to build the pinned dav1d of `lab/av1/tools/tools.sh`) | lab only (the containers measurement, queue row CONTAINERBENCH): FFmpeg packs and extracts MP4, Matroska and MXF with `-c copy`, pydicom packs and reads the DICOM arms (`lab/container-bench`); not shipped | FFmpeg GPL-2.0-or-later as that package is configured; pydicom MIT; meson Apache-2.0 | — | each package's own licence file as installed |
| moby/profiles `seccomp/v0.2.3` (`seccomp/default.json`, sha256 `536529b6…4c74`, the profile Docker 29.8.2 vendors) | deploy: `deploy/seccomp-uring.json` is that profile with one entry added (`deploy/seccomp-uring.sh` writes it from the pinned fetch); the deployment loads it, nothing is linked | Apache-2.0 (no NOTICE file at the tag): a derived file must say it was changed, which the script's header and `deploy/README.md` §Container settings do | — | [LICENSE](https://raw.githubusercontent.com/moby/profiles/seccomp/v0.2.3/LICENSE), read from the pinned tag |

All of these are compatible with this repository's MIT licence — LCEVC's code too, though its
patents are not granted and no open LCEVC encoder exists ([`lab/av1/bytes/lcevc`](../../lab/av1/bytes/lcevc/README.md)).
Nothing is relicensed, and none but FFmpeg carries a copyleft or source-offer duty — which never reaches here, since the lab runs
it as a separate program, links nothing against it and ships nothing built from it.

## What it obliges

* **Shipping a binary is redistribution.** A dav1d `.wasm`, its glue, or a server or ingest binary
  linking an encoder carries each component's copyright notice, conditions and disclaimer in the
  materials shipped with it — a `THIRD_PARTY` notices file served beside the client.
* **The AOM Patent License text ships with any AV1 implementation we distribute** (§1.2), and a
  distributor makes its own necessary claims available under the same licence.
* **How the client meets both:** the product's decoder builds ([`client/decode/wasm/build`](../../client/decode/wasm/build/README.md))
  write one `THIRD_PARTY_NOTICES`, served with the client at `client/decode/wasm/built/`, from the pinned sources'
  own files: OpenJPH's `LICENSE`; dav1d's `COPYING` and `doc/PATENTS` (the AOM Patent License 1.0); emscripten's
  `LICENSE`, musl's `COPYRIGHT`, and the `LICENSE.TXT` of libc++, libc++abi and compiler-rt (the OpenJPH build
  is C++); xxHash's `LICENSE`; hash-wasm's `LICENSE`. Each build's own licence files sit beside it, and the manifest pins the notices'
  bytes with the binaries'. Nothing is copied by hand, so a tag bump carries its own text. The lab's
  `client/decode/wasm/dav1d/build.sh` still writes its `THIRD_PARTY.txt` beside its variants.
* **The frame check's hasher** is xxHash's (row 179), whose BSD-2-Clause `LICENSE` sits beside its build. hash-wasm's,
  `client/decode/xxh3.test.mjs`'s reference and loaded by no page since row 218, carries its MIT `LICENSE`, fetched
  beside its script from the pinned tarball by `client/decode/wasm/fetch_xxh3.sh`.
* **Defensive termination** (§1.3): the patent licence ends for whoever starts patent litigation
  alleging an AV1 implementation infringes.
* **No endorsement**: VideoLAN's, AOM's or SVT-AV1's names are not used to promote this project
  (SVT-AV1's third clause).
* **Unconfirmed**: whether Emscripten's generated glue needs its notice (treated as yes).
* **What the dav1d build links** (`-Wl,--trace`, [`client/decode/wasm/dav1d`](../../client/decode/wasm/dav1d/README.md)):
  dav1d, emscripten's libc (musl, MIT), dlmalloc (public domain) and compiler-rt (Apache-2.0 with
  LLVM exception, whose exception waives notice for what compiles into a binary). No libc++: the
  wrapper is C. The libc++ question this line used to ask is answered by that. The OpenJPH build is C++
  and links libc++ and libc++abi (Apache-2.0 with LLVM exception); their notices ship anyway.

## Data

The public series ([`../FIXTURES.md`](../FIXTURES.md) §AV1 data; queue rows DATA and DATA3) are CC BY 3.0
or 4.0, per series as the NCI Imaging Data Commons index records it (the missing-depths series: CBIS-DDSM CC BY 3.0;
EA1141, CPTAC-LUAD, NLST, CMB-CRC and ISPY2 CC BY 4.0; the breast family's, queue row BREAST: Breast-Diagnosis CC BY 3.0,
CMB-BRCA CC BY 4.0): reuse, derivatives and redistribution allowed with attribution. The breast family's
ultrasound comes from two Zenodo records, each licence read from the record itself: the BUVFM demo
dataset (breast ultrasound video clips, CC BY 4.0) and BUS-BRA (breast ultrasound stills, CC BY 4.0;
the archive's own `LICENSE.txt` is an MIT-style permission that asks for its article to be cited).
Fetched, never committed; anything derived from them that is published carries the citations
listed there.

The five-link total-time measurement's LTE link (queue row TOTAL) replays mahimahi's `TMobile-LTE-short` trace (GPL-3.0), fetched by
`lab/av1/delivery/total-time/run.mjs` into a local cache and checked against the hash the phone-like link profiles recorded (cloud queue PROF); a trace is
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
store (SBND) is not DICOM, so nothing here breaks, but an archive exchanging AV1 payloads as DICOM would
need a private transfer syntax and could not claim contract for it. HTJ2K's lossless transfer
syntaxes are `1.2.840.10008.1.2.4.201` and `.202`.
