# D6 — what a decoder's first frame pays

`run.mjs` drives `index.html` in headless Chromium on a **persistent profile**, so the HTTP cache
and the engine's compiled-code cache survive between visits. Three arms, each a fresh page on a
fresh decoder instance:

* **cold** — a profile that has never seen the decoder
* **warm-http** — the second visit: the bundle is in the HTTP cache
* **warm-code** — the third: anything the engine chose to cache is in place too

Findings: [`../../docs/decode/README.md`](../../docs/decode/README.md) §The first frame.
S13 predicts the third arm buys nothing, because the decoder is instantiated from a buffer and its
glue is evaluated as text — the code cache has nothing to attach to.

```
NODE_PATH=$(npm root -g) node lab/decode-first-frame/run.mjs [rounds]
```

Needs `lab/decode-bench/fetch_decoder.sh` to have run, and the fixtures in `lab/fixtures/`.
