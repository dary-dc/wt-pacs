# telemetry-cost

What `client/record/` costs when it is installed, against the same client without it.
`docs/telemetry/adr-instrument-clients-from-outside.md` §What installing it costs holds the numbers.

```bash
bash client/transport-ts/build.sh
node lab/telemetry-cost/cost.mjs                                  # transport-ts, both sweeps
SWEEP=chunks IMPL=transport-wasm ROUNDS=17 node lab/telemetry-cost/cost.mjs
```

`SWEEP` is `both`, `bytes`, `chunks` or `frames`; `IMPL` is `transport-ts` or `transport-wasm`
(the latter needs `client/transport-wasm/pkg`, so `wasm-pack`); `ROUNDS` and `WARMUP` are rounds
timed and rounds discarded.

The seam is a patched global `WebTransport`, which is what `client/conformance/`'s fake already
occupies — so this runs in Node with no browser and no server, on the conformance harness.

**Three arms, not two.** `off` runs twice. The second is a null control: whatever difference it
shows against the first is this rig's resolution, and an overhead smaller than that is not a
measurement, it is noise with a sign. Arms interleave and rotate every round.

Chunks per frame is a knob here rather than an observation. A real link decides it, and the cost
tracks it more closely than it tracks frame size — so the row to read is whichever chunk count a
real session produces, which nothing here measures.

Every millisecond is container-measured.
