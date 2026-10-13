# Where the fill turns decode-bound, and the GSO cap of 24 (FASTCLOCK)

Above what rate is each codec's fill the decoders', not the wire's; and does the GSO cap of 24 save server CPU with no
fill or ask worse? The protocol and its rule are [`../../docs/transport/link-conditions.md`](../../docs/transport/link-conditions.md)
§Re-measured, proposed; the results are its §Measured, *FASTCLOCK*. Queue row 182.

```bash
lab/av1/fetch_data.sh dbt10_ea1141 ffdms_c1
PATH=$PWD/lab/.av1-build/venv/bin:$PATH lab/av1/tools/tools.sh && VARIANTS=simd client/decode/wasm/dav1d/build.sh
client/decode/wasm/fetch_openjph.sh && client/transport/ts/build.sh && ingest/coded-frames/build.sh
PATH=$PWD/lab/av1/.venv/bin:$PATH FRAMES=1 OUT_ROOT=/tmp/x lab/scripts/gen_htj2k_fixtures.sh g160
cargo build --release -p series-server -p pack-series -p window-harness && cargo build -p pack-series
# cap24: the opt-in quinn patch with its ceiling at 24 (45 as committed), into its own target
sed -i 's/^+const MAX_TRANSMIT_SEGMENTS: usize = 64;/+const MAX_TRANSMIT_SEGMENTS: usize = 24;/' patches/quinn-0.11.11-mtu-gso.patch
CARGO_TARGET_DIR=target/cap24 cargo build --release -p series-server --config 'patch.crates-io.quinn.path="patched/quinn"'
git checkout patches Cargo.lock

W=lab/.av1-work
mkdir -p $W/fc-data && for s in dbt10_ea1141 ffdms_c1; do ln -sfn $PWD/lab/av1/data/$s $W/fc-data/$s; done
lab/av1/.venv/bin/python lab/av1/delivery/split-rule/make_frames.py lab/.av1-build $W/fc $W/fc-data/* --preset allintra:7 --k 2
P=lab/av1/.venv/bin/python; L=$W/load                                            # server-load's series, as its README
$P ingest/coded-frames/ingest.py lab/.av1-build lab/av1/data/dbt10_ea1141 $L/htj2k --codec htj2k
$P ingest/coded-frames/ingest.py lab/.av1-build lab/av1/data/dbt10_ea1141 $L/av1 --representation optimized --preset good:6
for c in htj2k av1; do target/release/pack-series --metadata $L/$c/metadata.json --frames $L/$c --output $L/$c/$c.sbnd; done
PATH=$PWD/lab/av1/.venv/bin:$PATH python lab/ask-ahead/make_series.py lab/av1/data/dbt10_ea1141 $W/ask-dbt10

echo 4194304 > /proc/sys/net/core/rmem_default
B="base=$PWD/target/release/series-server" C="cap24=$PWD/target/cap24/release/series-server"
python3 lab/server-load/run.py --series htj2k=$L/htj2k,htj2k --series av1=$L/av1,av1 --rates 12875000 --sessions 1,32 \
  --server $B --server $C --rounds 10 --out lab/fastclock/rows-gso.jsonl
ARMS="$B,$C" RELAY_CHRT=50 python3 lab/ask-ahead/cells.py $W/ask-dbt10 10 103/46/fifo20 103/46/fifo360 > lab/fastclock/rows-ask.jsonl
export FIREFOX_PATH=...   # Firefox 157.0.1 as row TOTAL4 pins it (lab/av1/delivery/total-time/README.md)
for r in $(seq 0 9); do
  NODE_PATH=$(npm root -g) node lab/av1/delivery/total-time/run.mjs --frames $W/fc --links r50000,r103000,r218000 --one-way-ms 23 \
    --throttles 1,4 --engines chromium,firefox --rounds 1 --first-round $r --out lab/fastclock/rows-fill.jsonl
done
python3 lab/fastclock/summary.py
```

**Fill cells** (`rows-fill.jsonl`): `run.mjs` as rows TOTAL and CROSSMEASURE run it — a visit is its own server, relay
and browser, the product's downloader with three decoders, every frame's pixels hashed against the checksum written at
fetch — on the 10-bit DBT volume (`dbt10_ea1141`, 24 × 678×1727) and the four-view FFDM exam (`ffdms_c1`), HTJ2K and
the optimized AV1 payload (`k2`, libaom 3.15.1 `allintra:7`, which the client sends to WebCodecs in Chromium and
dav1d-WASM in Firefox). Fixed-rate links at 50, 103 and 218 Mbit/s, 23 ms each way, the rig's 200-packet queue; each
row carries the delay and rate the relay printed. The fill's last byte is `receivedMs`, its last frame on the page
`decodedMs`; the tail is their difference.

**The decoders' clock** (defined here, before the fill numbers; the protocol names the question, not the test): between
two adjacent rates, a fill whose time shrinks by less than half what its last byte shrinks is the decoders' from the
higher rate. `meanBusy` (decoders busy at once, of three, over the decode span) is printed beside it.

**GSO cells.** `rows-gso.jsonl`: `server-load/run.py` (server on core 0, `fill_load` on 1–3), 1 and 32 native sessions
each read-paced at 103 Mbit/s (12.875 MB/s), today's build against `cap24`, Williams order per round. Server CPU per MB
is the server's threads' `schedstat` over the fills; its 10 ms granularity makes one session's cell coarse.
`rows-ask.jsonl`: `ask-ahead/cells.py`, one Chromium, an ask for the last frame once half the fill has landed, at
103 Mbit/s and 46 ms behind a 20 ms and a 360 ms FIFO; each row carries the server's datagrams per `sendmsg`.

**Pins.** As `lab/av1/delivery/total-time/README.md`: Chromium 141.0.7390.37, Firefox 157.0.1 (BuildID
20261005135250, conda-forge SHA-256 `f1b53de2…4d7127f35`, micromamba 2.9.0 `8761c382…f13040dd`), libaom 3.15.1,
dav1d 1.5.4 under emscripten 3.1.74, OpenJPH 0.31.0, `@cornerstonejs/codec-openjph` 2.4.11; quinn 0.11.11 with
`patches/quinn-0.11.11-mtu-gso.patch`. Nothing built or fetched is committed.
