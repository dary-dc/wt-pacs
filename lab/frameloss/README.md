# frameloss

Whole fills of row 144's 240-frame 1024² 16-bit HTJ2K series through the real server, with and without the page's
ack, the arms interleaved by [`../order.mjs`](../order.mjs): the cost check of queue row 147 (FRAMELOSS). The reading
is in [`docs/ARCHITECTURE.md`](../../docs/ARCHITECTURE.md) §The downloader, *Three silent losses, closed*.

```bash
cargo build --release -p series-server -p pack-series && client/decode/wasm/build/build.sh
# the series: lab/ffportgc/README.md, then target/release/pack-series ... --output $W/series/series.sbnd
NODE_PATH=$(npm root -g) node lab/frameloss/cost.mjs --series lab/.av1-work/ffportgc/series --before 2e16d887^ \
  --rounds 10 --firefox .../firefox
```

The lever is `client/transport/downloader.js` and `consumer.js` alone, today's against the commit before the fix
(`2e16d887^`), written in place between visits and restored at the end; the page is
[`../ffportgc/index.html`](../ffportgc/index.html), which checks every frame against its SHA-256 from the encoder's
input. The first line printed is both arms' settings; each visit after it is one line, `ms` being the fill's last frame.
