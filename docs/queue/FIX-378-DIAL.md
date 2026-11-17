state: started
started: 2026-11-17T09:17Z
heartbeat: 2026-11-17T09:20Z
outputs: claude/lossless-under-loss (PR 378)
## Resume
Pushed to claude/lossless-under-loss: e5fc7406 (failing test), 30968d78 (fix; the test also checks one failure only), 8425d1f2 (README).
Mutants: 6, 5 killed; survivor: the generation guard (a cancel during a failing dial; the consumer drops a stale generation anyway).
Pushed ae64ec70 (review doc corrected in place, new section; line doc Open 16). Next: gate (prereqs building: wasm-pack, transport wasm), then PR 378 body one line; done.
## Result
