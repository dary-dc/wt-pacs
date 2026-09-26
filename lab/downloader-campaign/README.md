# downloader-campaign

What the downloader costs against today's harness path, on the same server, interleaved. The
numbers live in [`docs/ARCHITECTURE.md`](../../docs/ARCHITECTURE.md) §Results; this
says how they were made.

```bash
./server/scripts/gen_dev_cert.sh
lab/decode-bench/fetch_decoder.sh                         # the decoder the Dd arm runs
lab/scripts/gen_htj2k_fixtures.sh c512                    # 87 real HTJ2K frames, 512x512x3
# pack them as a study: NNN.j2c → NNN.htj2k, then
cargo run --release -p pack-study -- --metadata lab/fixtures/decode_c512/metadata.json --frames <dir> --output c512.sbnd
cargo run --release -p exact-server -- --port 4433 --study c512.sbnd
python3 server/dev-server.py --port 8765
NODE_PATH=$(npm root -g) node lab/downloader-campaign/run.mjs --rounds 8 --out campaign.jsonl
```

Three arms, one fresh session each: **H**, today's harness path — the TS session on the page, the
fill as a waiter per frame, `touch` on the bytes (`client/harness/shell.js`); **Dw**, the downloader
with decode off — the same bytes, delivered from its worker; **Dd**, the downloader decoding with
three decoders — pixels in a `SharedArrayBuffer`, the product path. Five scenarios: a fill of 80
frames, one cold ask, and a fill with an ask for a frame outside it once 10, 50 or 90 % has landed.

Every round runs every scenario on every arm with the arm order rotated, so a drift in the host
lands on all arms alike. The page measures ask → delivered, fill issue → last frame at the page,
frames delivered, its own handling time and JS-heap peak, and `measureUserAgentSpecificMemory`
after; the driver adds, over CDP, the page's main-thread task time and the renderer's GC count —
tracing is stopped *before* the memory measurement, which forces a GC of its own. *Corrected
2026-09-24 (M1):* that count is of every `V8.GC*` trace event, and most of those are phases of one
collection; `throttle.mjs` counts collections.

`throttle.mjs` (M1) runs the fill under Chromium's CPU throttle, 1×, 4× and 6× by default. Per
thread it reports collections, GC pause and task time, splitting the page's time into the
product's (message dispatch and code under `/client/`) and this page's own. From the page it takes
a sampled allocation profile. It waits on a 200 ms timer, because waiting on animation frames is
main-thread work the fill would be charged.

```bash
NODE_PATH=$(npm root -g) node lab/downloader-campaign/throttle.mjs 5   # rounds; THROTTLES=1,4,6 ARMS=H,Dw,Dd ALLOC=0
NODE_PATH=$(npm root -g) node lab/downloader-campaign/port.mjs --rounds 7   # the pixel port's message alone
NODE_PATH=$(npm root -g) node lab/downloader-campaign/resources.mjs 7       # DECODERS=1,2,3 CORES=2,4 THROTTLES=1,4
```

`resources.mjs` (RC1) runs Dd with `?decoders=`, one fresh browser a visit pinned with `taskset`,
and samples every process and thread of it (`lab/scripts/proc_sampler.mjs`): peak PSS and RSS by
process kind, on-CPU time by thread name.

*Corrected 2026-09-25 (PH1):* a call inside a message's dispatch or a timer is counted once — it was
counted with its dispatch as well — and the product's share per frame is printed without the page's
handler. `ALLOC=0` turns the allocation sampler off, whose cost lands on the page's time.
`port.mjs` posts the decoder's message, and variants of it, from a worker at a fill's pace and charges
each dispatch from the trace.

**Read before trusting a number.** Container-measured, loopback, 4 cores: the Dd arm is
decode-bound here and says nothing about a device. `run.mjs` launches the full Chromium by
explicit path — the headless shell playwright otherwise picks has no
`measureUserAgentSpecificMemory`. On H an ask ends the fill on the server and nothing re-issues it,
so "frames delivered" is the finding there, not a failure of the rig.
