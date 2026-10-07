# jxl

Lossless JPEG XL at every effort 1–7 and `--faster_decoding` 0–4, in WASM and decoded natively by the browsers,
against the served HTJ2K. Queue row 63 (JXL) of [`docs/av1/queue.md`](../../../docs/av1/queue.md); the verdict is in
[`docs/decode/README.md`](../../../docs/decode/README.md) §JPEG XL and [`docs/av1/README.md`](../../../docs/av1/README.md)
§Measured here.

```bash
lab/av1/embed/build.sh                          # libjxl 0.12.0 native and WASM (row EMBED's build)
lab/av1/versions/build.sh                       # Chromium 154's headless shell, pinned (row VERSIONS)
lab/decode-bench/fetch_decoder.sh               # OpenJPH, the shipped package
FRAMES=1 OUT_ROOT=/tmp/x lab/scripts/gen_htj2k_fixtures.sh g160   # builds ojph_compress once
lab/av1/fetch_data.sh usb_cine us_liver dbt10_ea1141 dbt12_ea1141 ffdm_a dbtproj_holo mg16_cbis
D=lab/av1/data
lab/av1/.venv/bin/python lab/av1/jxl/encode.py lab/.av1-build lab/.av1-work/jxl --frames 8 \
  $D/usb_cine $D/us_liver $D/dbt10_ea1141 $D/dbt12_ea1141 $D/ffdm_a $D/dbtproj_holo $D/mg16_cbis   # ~4 min
export FIREFOX_PATH=...                         # the engines: below
node lab/av1/jxl/run.mjs --probe --codings jxl-e7-f0,jxl-e1-f0       # every native path, every engine
node lab/av1/jxl/run.mjs --rounds 1 --throttles 1 --codings $(every e and f)   # the sweep, ~15 min
node lab/av1/jxl/run.mjs --rounds 8 --engines chromium154+jxl,firefox+jxl \
  --sets usb_cine,us_liver,dbt10_ea1141,dbt12_ea1141,ffdm_a,dbtproj_holo \
  --codings jxl-e1-f0,jxl-e2-f0,jxl-e7-f3,jxl-e7-f0 --out rows.json      # ~90 min
node lab/av1/jxl/run.mjs --probe --engines chromium154+jxl,firefox+jxl --mutate source   # every exact path fails
node lab/av1/jxl/run.mjs --rounds 1 --throttles 1 --mutate hash      # every arm fails
```

**Engines.** Each is launched as a process that opens the page, as row XBROWSER launched them
([`../xbrowser`](../xbrowser/README.md)):

| engine | build | JPEG XL |
| --- | --- | --- |
| `chromium141` | playwright 1.56.1's Chromium 141.0.7390.37, the lab's pinned engine | no decoder in the binary |
| `chromium154`, `chromium154+jxl` | Chrome for Testing 154.0.8037.92 headless shell (row VERSIONS' pin, SHA-256 `636aa5c7…aed096f9`) | jxl-rs 0.6 (`third_party/rust/jxl/v0_6` in the binary), off by default; `+jxl` is `--enable-features=JXLImageFormat` |
| `firefox`, `firefox+jxl` | Firefox 157.0.1 (BuildID 20261005135250), conda-forge `firefox-157.0.1-hee9eb32_0.conda` (SHA-256 `f1b53de2…4d7127f35`), micromamba 2.9.0 (`micromamba-2.9.0-0.tar.bz2`, SHA-256 `8761c382…f13040dd`) | off by default; `+jxl` sets `image.jxl.enabled` |
| `webkit` | WebKitGTK 2.52.6, Ubuntu 24.04 `libwebkit2gtk-4.1-0` `2.52.6-0ubuntu0.24.04.1`, its MiniBrowser under Xvfb | not built in: the library links no libjxl |

Row XBROWSER recorded micromamba 2.9.0's checksum as `8761c382…a3e8515`; the same file fetched on 2026-10-07 ends
`…f13040dd`. conda-forge now serves Firefox 157.0.1 for 157.0.

**The codings** (`encode.py`): each set's first 8 frames (fewer where the set has fewer) from the PGM/PPM HTJ2K is
coded from. HTJ2K is OpenJPH 0.31.0 in the served profile; JPEG XL is `cjxl -d 0 -e E --faster_decoding=F
--num_threads=0` (libjxl 0.12.0), E 1–7, F 0–4. Every codestream is decoded by `djxl` (or `ojph_expand`) and matched
with the series' checksum; an inexact one is recorded. Four at a time, one thread each, so the encode times are a
loaded core's.

**The probe** (`run.mjs --probe`, `page.js`): each set's first frame through `<img>` drawn to a canvas, through
`createImageBitmap`, through a canvas read as `rgba-float16`, and through WebCodecs' `ImageDecoder`, compared sample
by sample with the fetched frame (its bytes matched to its checksum first). An 8-bit output is scaled back to the
source's range to give the largest error in source units.

**The timing** (`run.mjs`): a set's frames decoded in order, the clock from the first codestream handed in to the
last frame's samples out; one warm-up frame untimed. *WASM* is row EMBED's worker (libjxl 0.12.0, 625 KB `.wasm`,
single-threaded with SIMD; OpenJPH the shipped package) and hashes every frame against the checksums. *Native* is
`createImageBitmap`, `drawImage`, `getImageData` per frame on the page — the samples a viewer could window — and is
hashed the same way, so only 8-bit frames can match. Each (engine × throttle) cell is a fresh browser in a Williams
order every round (`lab/order.mjs`); arms rotate inside it. 4× is `lab/scripts/cpu_throttle.mjs` on the browser's
process tree, once the page has loaded. This container: 4 cores, not a phone.

## Bytes

Each cell is the coding's bytes over the set's HTJ2K bytes · its libjxl-WASM decode time over OpenJPH's, one
round in Chromium 154 at 1× (the sweep; the four codings below were then timed properly). Every one of the 37 frames ×
35 codings is exact through `djxl`, and through the WASM decoder in the sweep: 1 575/1 575 frames.

| set | bits, frames | f | e1 | e2 | e3 | e4 | e5 | e6 | e7 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `usb_cine` | 8 grey, 8 | 0 | 0.963 · 1.5 | 0.924 · 2.6 | 0.825 · 3.6 | 0.823 · 5.2 | 0.814 · 5.1 | 0.809 · 5.2 | 0.806 · 5.1 |
|  |  | 1 | 0.963 · 1.6 | 0.924 · 1.8 | 0.825 · 3.6 | 1.106 · 1.9 | 0.935 · 2.4 | 0.861 · 3.1 | 0.840 · 3.3 |
|  |  | 2 | 0.963 · 1.4 | 0.918 · 2.1 | 0.858 · 4.0 | 1.028 · 1.7 | 0.914 · 1.8 | 0.904 · 2.6 | 0.867 · 3.1 |
|  |  | 3 | 0.963 · 1.4 | 0.918 · 2.1 | 0.858 · 3.9 | 1.027 · 1.8 | 0.914 · 1.7 | 0.915 · 1.9 | 0.906 · 1.7 |
|  |  | 4 | 0.963 · 1.4 | 0.918 · 2.1 | 0.858 · 3.9 | 1.028 · 1.8 | 0.903 · 1.5 | 0.903 · 1.4 | 0.903 · 1.6 |
| `us_liver` | 8 RGB, 8 | 0 | 0.996 · 1.4 | 0.953 · 2.3 | 0.888 · 5.4 | 0.875 · 7.8 | 0.867 · 7.4 | 0.862 · 7.7 | 0.861 · 7.9 |
|  |  | 1 | 0.996 · 1.3 | 0.953 · 2.0 | 0.888 · 6.3 | 0.943 · 2.0 | 0.918 · 4.0 | 0.897 · 4.4 | 0.891 · 5.0 |
|  |  | 2 | 0.996 · 1.4 | 0.944 · 2.4 | 0.900 · 5.6 | 1.017 · 1.9 | 0.925 · 1.7 | 0.921 · 2.6 | 0.910 · 3.2 |
|  |  | 3 | 0.996 · 1.3 | 0.944 · 2.4 | 0.900 · 5.5 | 0.942 · 2.2 | 0.958 · 1.8 | 0.951 · 1.7 | 0.949 · 1.8 |
|  |  | 4 | 0.996 · 1.5 | 0.944 · 2.5 | 0.900 · 5.5 | 1.155 · 2.1 | 0.993 · 1.7 | 0.992 · 1.6 | 0.994 · 1.6 |
| `dbt10_ea1141` | 10, 8 | 0 | 0.952 · 1.5 | 0.919 · 2.4 | 0.900 · 5.9 | 0.898 · 6.6 | 0.894 · 7.4 | 0.896 · 7.8 | 0.863 · 9.5 |
|  |  | 1 | 0.952 · 1.5 | 0.919 · 2.2 | 0.900 · 5.9 | 0.993 · 2.4 | 0.923 · 2.3 | 0.921 · 3.7 | 0.812 · 5.0 |
|  |  | 2 | 0.952 · 1.4 | 0.929 · 2.3 | 0.912 · 5.6 | 0.959 · 2.0 | 0.925 · 2.2 | 0.926 · 3.4 | 0.857 · 4.6 |
|  |  | 3 | 0.952 · 1.5 | 0.929 · 2.3 | 0.912 · 6.3 | 0.923 · 2.3 | 0.928 · 2.5 | 0.928 · 2.3 | 0.928 · 2.2 |
|  |  | 4 | 0.952 · 1.5 | 0.929 · 2.4 | 0.912 · 5.6 | 0.959 · 2.1 | 0.933 · 2.1 | 0.933 · 2.3 | 0.933 · 2.1 |
| `dbt12_ea1141` | 12, 8 | 0 | 0.976 · 1.4 | 0.932 · 2.3 | 0.919 · 5.0 | 0.919 · 6.6 | 0.918 · 7.2 | 0.924 · 8.8 | 0.933 · 9.1 |
|  |  | 1 | 0.976 · 1.4 | 0.932 · 2.1 | 0.919 · 5.3 | 0.999 · 2.4 | 0.936 · 2.1 | 0.932 · 4.0 | 0.933 · 4.8 |
|  |  | 2 | 0.976 · 1.5 | 0.940 · 2.2 | 0.928 · 5.1 | 0.975 · 2.0 | 0.936 · 2.1 | 0.937 · 3.6 | 0.939 · 4.2 |
|  |  | 3 | 0.976 · 1.4 | 0.940 · 2.3 | 0.928 · 5.5 | 0.938 · 2.0 | 0.942 · 2.2 | 0.942 · 2.3 | 0.942 · 2.1 |
|  |  | 4 | 0.976 · 1.4 | 0.940 · 2.1 | 0.928 · 5.5 | 0.975 · 2.1 | 0.948 · 2.2 | 0.948 · 2.2 | 0.948 · 2.1 |
| `ffdm_a` | 12, 4 | 0 | 0.988 · 1.3 | 0.952 · 2.4 | 0.945 · 7.0 | 0.946 · 7.4 | 0.870 · 7.7 | 0.874 · 8.9 | 0.884 · 9.3 |
|  |  | 1 | 0.988 · 1.3 | 0.952 · 2.4 | 0.945 · 6.9 | 0.989 · 2.2 | 0.885 · 2.3 | 0.883 · 3.7 | 0.886 · 4.0 |
|  |  | 2 | 0.988 · 1.4 | 0.965 · 2.7 | 0.958 · 7.0 | 0.974 · 2.3 | 0.943 · 2.5 | 0.947 · 3.6 | 0.948 · 3.7 |
|  |  | 3 | 0.988 · 1.2 | 0.965 · 2.7 | 0.958 · 7.0 | 0.957 · 2.5 | 0.949 · 2.3 | 0.948 · 2.2 | 0.948 · 2.4 |
|  |  | 4 | 0.988 · 1.3 | 0.965 · 2.6 | 0.958 · 7.0 | 0.974 · 2.2 | 0.956 · 2.4 | 0.956 · 2.3 | 0.956 · 2.1 |
| `dbtproj_holo` | 14, 8 | 0 | 1.026 · 1.1 | 0.970 · 1.7 | 0.954 · 4.0 | 0.953 · 4.7 | 0.954 · 5.2 | 0.955 · 6.2 | 0.960 · 6.9 |
|  |  | 1 | 1.026 · 1.1 | 0.970 · 1.5 | 0.954 · 3.9 | 0.977 · 1.4 | 0.980 · 1.6 | 0.972 · 2.9 | 0.964 · 3.9 |
|  |  | 2 | 1.026 · 1.1 | 0.977 · 1.7 | 0.962 · 4.0 | 0.977 · 1.5 | 0.977 · 1.8 | 0.975 · 2.7 | 0.971 · 3.4 |
|  |  | 3 | 1.026 · 1.1 | 0.977 · 1.8 | 0.962 · 4.2 | 0.977 · 1.5 | 0.975 · 1.8 | 0.975 · 1.8 | 0.975 · 1.8 |
|  |  | 4 | 1.026 · 1.1 | 0.977 · 1.7 | 0.962 · 4.1 | 0.977 · 1.5 | 0.975 · 1.7 | 0.975 · 1.7 | 0.975 · 1.7 |
| `mg16_cbis` | 16, 1 | 0 | 0.942 · 1.0 | 0.890 · 2.0 | 0.929 · 5.3 | 0.890 · 5.6 | 0.528 · 6.4 | 0.528 · 7.0 | 0.528 · 7.7 |
|  |  | 1 | 0.942 · 1.0 | 0.890 · 1.9 | 0.929 · 5.1 | 0.903 · 1.7 | 0.538 · 1.9 | 0.536 · 2.9 | 0.534 · 3.7 |
|  |  | 2 | 0.942 · 1.1 | 0.899 · 2.0 | 0.939 · 5.2 | 0.898 · 1.8 | 0.561 · 2.0 | 0.559 · 2.8 | 0.560 · 3.3 |
|  |  | 3 | 0.942 · 1.1 | 0.899 · 2.0 | 0.939 · 5.3 | 0.890 · 1.7 | 0.565 · 2.0 | 0.565 · 2.2 | 0.565 · 2.1 |
|  |  | 4 | 0.942 · 1.1 | 0.899 · 2.0 | 0.939 · 5.2 | 0.898 · 1.9 | 0.567 · 2.0 | 0.567 · 2.0 | 0.567 · 2.2 |

* **The fastest JPEG XL decodes like HTJ2K and saves nothing**: effort 1 is 0.94–1.03 of the bytes at 1.0–1.6× the
  decode. Effort 2 is 0.89–0.97 at 1.7–2.6×.
* **The default (e7, f0) is the smallest or within 2 % of it on six of seven sets, at 5.1–9.5× the decode.**
  `dbt12_ea1141` and `ffdm_a` are smallest at e5 (0.918, 0.870), the 14-bit projections at e4 (0.953), and
  `dbt10_ea1141` at e7 f1 (0.812 against f0's 0.863).
* **`--faster_decoding` 3–4 at e5–7 decodes in 1.4–2.5×** at 0.90–0.99 of the bytes (0.57 on the scan); 1–2 are between. At e1–e3 it
  changes nothing or costs bytes; at e4 it costs up to 0.28 of HTJ2K's bytes (`usb_cine` f1, `us_liver` f4).
* **The 16-bit film scan is the outlier**: 0.528 at e5–7, half HTJ2K's bytes; e1–e4 are 0.89–0.94.
* Encode, a loaded core: e1 takes HTJ2K's time (0.01–0.08 s a frame; 1.9 s against 0.9 s for the 30 MP scan), e7
  14–47× HTJ2K's.

## The engines

Each set's first frame (`jxl-e7-f0`; `jxl-e1-f0` gave the same on the first five sets), every path against the
fetched samples. *exact* is every sample equal; otherwise the largest error in source units, and in brackets in steps
of the 8-bit output, (2^B − 1)/255 source units each:

| engine | path | 8 grey, 8 RGB | 10 | 12 (DBT, FFDM) | 14 | 16 |
| --- | --- | --- | --- | --- | --- | --- |
| `chromium141`, `chromium154`, `firefox` | every path | refused: `<img>` and `createImageBitmap` throw a decode error, `ImageDecoder.isTypeSupported("image/jxl")` is false | | | | |
| `webkit` | every path | refused; no `ImageDecoder` at all | | | | |
| `chromium154+jxl` | `<img>`, `createImageBitmap` | exact | 12 (3.0) | 48 (3.0) | 192 (3.0) | 768 (3.0) |
| | float16 canvas read | exact | 12 (3.0) | 48, 49 (3.0) | 192 (3.0) | 783 (3.0) |
| | `ImageDecoder` (`BGRX`) | exact | 4 (1.0) | 15.9 (1.0) | 63.7 (1.0) | 254 (1.0) |
| `firefox+jxl` | `<img>`, `createImageBitmap`, `ImageDecoder` (`BGRX`) | exact | 2.1 (0.5) | 8.5, 8.9 (0.5) | 32.1 (0.5) | 143 (0.6) |
| | float16 canvas read | not offered: `getImageData` returns 8 bits | | | | |

* **Only 8 bits come back, from every engine and every path.** `ImageDecoder` hands out `BGRX` whatever the depth,
  and the canvas holds 8 bits a channel. Firefox rounds to the nearest 8-bit step (half a step at most); Chromium's
  `ImageDecoder` is within one step, and its `<img>` within three. Chromium's float16 canvas read is a 16-bit
  container of the same 8-bit picture: its error is the `<img>` one, never under 3 steps.
* **8-bit grey and RGB are exact** in both engines, through every path, on both frames.
* **Who decodes at all**: Chromium 154 has jxl-rs compiled in (`third_party/rust/jxl/v0_6` in the binary), behind
  `JXLImageFormat`, off by default; Chromium 141, the lab's pinned engine, has no decoder. Firefox 157.0.1 decodes
  with `image.jxl.enabled` set, off by default. Ubuntu's WebKitGTK 2.52.6 links no libjxl, so it has none; Safari
  has decoded JPEG XL since 17.0 (WebKit's 2023-09-18 release post) — not testable here, and only its platform
  decoder could say what it returns above 8 bits.

## Decode time

Each cell is the median over 8 interleaved rounds of the round's time over OpenJPH's in the same cell, WASM ·
native; OpenJPH's own ms a frame beside it. The six sets that are not the 30 MP scan, their first 8 frames (`ffdm_a`
4). WASM and OpenJPH: 7 040/7 040 frames exact. Native: 2 048/2 048 on the 8-bit sets, 0/3 584 above 8 bits (the
canvas holds 8 bits; §The engines).

| set | engine | × | OpenJPH ms | e1-f0 WASM · native | e2-f0 WASM · native | e7-f3 WASM · native | e7-f0 WASM · native |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `usb_cine` | Chromium 154 | 1× | 5.5 | 1.58 · 2.54 | 2.05 · 2.35 | 1.83 · 2.26 | 5.35 · 4.42 |
|  |  | 4× | 19.4 | 1.80 · 2.41 | 2.05 · 2.30 | 1.97 · 2.27 | 6.28 · 4.27 |
|  | Firefox 157 | 1× | 4.8 | 1.91 · 2.00 | 2.27 · 1.65 | 2.45 · 2.03 | 6.44 · 3.24 |
|  |  | 4× | 21.1 | 1.88 · 1.39 | 2.28 · 1.36 | 2.05 · 1.48 | 6.44 · 2.29 |
| `us_liver` | Chromium 154 | 1× | 12.3 | 1.33 · 0.90 | 2.00 · 1.19 | 1.76 · 1.15 | 7.50 · 3.15 |
|  |  | 4× | 58.2 | 1.17 · 0.61 | 1.74 · 0.80 | 1.60 · 0.81 | 7.17 · 2.64 |
|  | Firefox 157 | 1× | 13.4 | 1.23 · 1.10 | 1.80 · 1.17 | 1.64 · 1.16 | 7.07 · 2.82 |
|  |  | 4× | 65.3 | 1.22 · 0.73 | 1.76 · 0.81 | 1.60 · 0.94 | 6.42 · 2.20 |
| `dbt10_ea1141` | Chromium 154 | 1× | 16.7 | 1.33 · 2.77 | 2.09 · 2.95 | 1.98 · 3.22 | 8.48 · 4.98 |
|  |  | 4× | 69.1 | 1.51 · 2.64 | 2.30 · 2.77 | 2.09 · 2.94 | 8.95 · 4.72 |
|  | Firefox 157 | 1× | 15.8 | 1.39 · 3.10 | 2.12 · 3.72 | 2.20 · 3.70 | 8.74 · 5.23 |
|  |  | 4× | 75.8 | 1.36 · 2.80 | 2.12 · 2.99 | 2.06 · 3.21 | 8.18 · 4.32 |
| `dbt12_ea1141` | Chromium 154 | 1× | 12.7 | 1.40 · 2.65 | 2.12 · 2.88 | 2.12 · 3.18 | 8.30 · 4.80 |
|  |  | 4× | 52.3 | 1.51 · 2.49 | 2.26 · 2.67 | 2.14 · 2.92 | 9.03 · 4.69 |
|  | Firefox 157 | 1× | 12.4 | 1.51 · 2.96 | 2.25 · 3.17 | 2.19 · 3.19 | 8.67 · 5.08 |
|  |  | 4× | 58.4 | 1.34 · 2.48 | 2.07 · 2.70 | 1.98 · 2.81 | 8.15 · 4.19 |
| `ffdm_a` | Chromium 154 | 1× | 77.8 | 1.32 · 3.53 | 2.62 · 3.93 | 2.47 · 4.21 | 9.87 · 6.06 |
|  |  | 4× | 344.9 | 1.42 · 3.41 | 2.65 · 3.73 | 2.42 · 4.16 | 9.64 · 6.08 |
|  | Firefox 157 | 1× | 75.5 | 1.45 · 4.07 | 2.55 · 4.50 | 2.43 · 4.51 | 9.97 · 5.88 |
|  |  | 4× | 344.0 | 1.42 · 3.69 | 2.51 · 3.97 | 2.47 · 4.04 | 10.01 · 5.70 |
| `dbtproj_holo` | Chromium 154 | 1× | 49.5 | 1.10 · 2.14 | 1.58 · 2.69 | 1.68 · 2.56 | 6.85 · 3.90 |
|  |  | 4× | 233.9 | 1.06 · 1.72 | 1.51 · 2.20 | 1.58 · 2.08 | 6.39 · 3.43 |
|  | Firefox 157 | 1× | 45.3 | 1.07 · 2.59 | 1.70 · 3.11 | 1.73 · 2.84 | 7.51 · 4.51 |
|  |  | 4× | 214.6 | 1.03 · 2.20 | 1.62 · 2.58 | 1.56 · 2.50 | 6.85 · 3.64 |

* **No JPEG XL arm decodes like HTJ2K in WASM.** Effort 1 is 1.03–1.91× OpenJPH (slower in 181 of 192 paired rounds),
  e2 1.51–2.28×, e7 with `--faster_decoding=3` 1.56–2.45× (190 of 192), the default 5.35–10.0× (192 of 192). Firefox's WASM
  and OpenJPH run in 0.87–1.21× Chromium's time on the same arm.
* **Native is faster than libjxl-WASM at the default effort and slower at the fast ones**: e7 f0 native 2.2–6.1×
  OpenJPH, under its WASM in 192 of 192 rounds; e1 native 1.7–4.1× on grey above 8 bits, where it is also not exact.
* **One cell where JPEG XL beats OpenJPH: 8-bit RGB, native, fast efforts** — the ultrasound at e1–e7 f3 decodes in
  0.61–1.19× OpenJPH's time, lowest at 4× (0.61 Chromium, 0.73 Firefox). It is exact because it is 8-bit, where the
  canvas loses nothing. Native time includes `drawImage` and `getImageData`.
* Where the host saturates: one decoder at a time on four cores; native decodes may use the engine's own threads
  (jxl-rs 0.6 is multithreaded in Chromium), so a native cell may use more than one core where WASM uses one.

**Checked.** Mutated, every check failed: `encode.py`'s exactness check one off on every sample, 36/36 codings of
`usb_cine` and `dbt12_ea1141`; the source one off in the probe, every exact path (12/12) failed; one digit of every checksum in the timing,
10/10 arms 0/8 (`usb_cine`, `dbt12_ea1141`, OpenJPH, e1 and e7, WASM and native).
