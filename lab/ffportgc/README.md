# ffportgc

Whole fills through the product's downloader and decoders in a stock headless Firefox, every frame checked against
its SHA-256 from the encoder's input: the before and after of queue row 144 (FFPORTGC). The reading is in
[`docs/ARCHITECTURE.md`](../../docs/ARCHITECTURE.md) §The downloader, *A frame lost silently in Firefox*.

```bash
cargo build --release -p series-server -p pack-series && client/decode/wasm/build/build.sh
W=lab/.av1-work/ffportgc
PATH=/usr/bin:$PATH OUT_ROOT=$W FRAMES=240 lab/scripts/gen_htj2k_fixtures.sh g1024   # needs numpy
mkdir -p $W/series && for f in $W/decode_g1024/*.j2c; do b=$(basename $f .j2c)
  ln -sf ../decode_g1024/$b.j2c $W/series/$b.htj2k; cp $W/decode_g1024/$b.sha256 $W/series/; done
cp $W/decode_g1024/metadata.json $W/series/
FIREFOX_PATH=.../firefox FOLLOW=1 lab/ffportgc/run.sh $PWD/$W/series 7
```

`FOLLOW=1` spawns decoders as the queue grows (the lab flag `followQueue`), which is when a neutered port can be
collected with frames in flight; the before arm is `client/transport/downloader.js` at the parent of the commit that adds this directory
(`git log --format=%h -- lab/ffportgc | tail -1`), swapped in between visits. Firefox 157.0.1 is the build
`scripts/wtcompat.py --fetch` fetches and checks against Mozilla's `SHA256SUMS`. The 1 200-frame arm is the 240 frames
cycled five times, each with its own `.sha256`.
