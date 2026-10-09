# gpu

What a WebGPU HTJ2K decode stage would pay to move a frame, measured; what it could save, bounded.
Queue row 62 (GPU) of [`docs/av1/queue.md`](../../../../docs/av1/queue.md); the sources, the bound and the
reading are in [`docs/decode/README.md`](../../../../docs/decode/README.md) §Faster HTJ2K in the browser.

```bash
NODE_PATH=$(npm root -g) node lab/av1/decode/webgpu/transfer.mjs --rounds 8 --throttles 1,4 --passes 7   # ~20 min
NODE_PATH=$(npm root -g) node lab/av1/decode/webgpu/transfer.mjs --rounds 1 --throttles 1 --mutate     # every cell 0/n
python3 lab/av1/decode/webgpu/bound.py   # the bound, from the profile, this run and the paper's kernel times
```

**Transfer** (`transfer.mjs`, `transfer.html`). Headless Chromium with WebGPU on SwiftShader (the
container has no GPU; Chromium offers no adapter without the flags). Per frame size, a frame of
deterministic samples is made in the page and its SHA-256 written; the device holds it as a decode
stage would leave it, and the wasm heap holds the same bytes. Two arms, each returning a buffer the
page keeps:

* `heap` — the copy out today: a new buffer filled from a `WebAssembly.Memory`.
* `webgpu` — the codestream written up (`writeBuffer`, half the samples' bytes, an assumption), the
  frame copied to a `MAP_READ` buffer, `mapAsync`, copied out of the mapped range, `unmap`. No shader
  runs: this is the plumbing alone, the term a bound subtracts.

Every pass's frame is hashed against the truth after its timing. A fresh browser per (round ×
throttle), throttles, sizes and arms in Williams orders (`lab/order.mjs`); per-round median of 7
passes. 4× is `lab/scripts/cpu_throttle.mjs` on one core. `--mutate` flips one bit of the frame both
arms hold: every cell went 0/n. Timer resolution is the page's 0.1 ms (not cross-origin isolated).

**What SwiftShader leaves unmeasured.** The device's own copies here are CPU copies, so a discrete
GPU's bus and a phone's driver are not in these numbers; no shader is timed, since SwiftShader runs
WGSL on the CPU.

**Pins.** Node 22.22.0; playwright 1.56.1's Chromium 141.0.7390.37 and its SwiftShader. Nothing
fetched or built.
