# wcap

What WebCodecs' AV1 decoder accepts in headless Chromium and whether it returns the encoder's
input exactly. The findings live in [`../../../docs/decode/README.md`](../../../docs/decode/README.md)
§AV1; this says how they were made.

```bash
pip install numpy==2.1.3
python3 lab/av1/wcap/make_streams.py /tmp/wcap        # 24 IVFs + manifest.json, ~40 s
NODE_PATH=$(npm root -g) node lab/av1/wcap/probe.mjs /tmp/wcap /tmp/wcap.json
MUTATE=1 ARMS=tu PREFS=no-preference NODE_PATH=$(npm root -g) node lab/av1/wcap/probe.mjs /tmp/wcap
```

**Pins.** The distribution's FFmpeg 6.1.1-3ubuntu5 with libaom 3.8.2-2ubuntu0.1 (encoder) and
libdav1d 1.4.1-1build1 (the native reference); playwright 1.56.1's Chromium 141.0.7390.37
(`CHROME_PATH` overrides). Nothing is fetched.

**Streams.** `make_streams.py` draws frames with `lab/scripts/gen_frame_pnm.py`, writes their planes
raw, records a SHA-256 per frame per plane, and encodes each with

```bash
ffmpeg -f rawvideo -pix_fmt PIX -s 256x192 -r 25 -i in.raw \
  -c:v libaom-av1 -aom-params lossless=1 -cpu-used 6 -row-mt 0 -g G -keyint_min G \
  -pix_fmt PIX -f ivf out.ivf
```

`PIX` is `gray*` (4:0:0, libaom sets `monochrome`), `yuv420p*`, `yuv422p*` or `gbrp*` (4:4:4 with
the identity matrix); `G` is 1 (intra) or 8 (inter). Each IVF frame is one temporal unit, and the
probe hands each to the decoder as one `EncodedVideoChunk`, `key` on keyframes, sequence header
in-band, no `description`.

**Arms.** `tu` (flushed), `nodelim` (temporal delimiters stripped), `noflush` and `noflush:N` (the
first N units, never flushed: how many frames the decoder holds), each under `no-preference`,
`prefer-software` and `prefer-hardware`. `MUTATE=1` flips one sample of every decoded frame; every
cell must then fail.
