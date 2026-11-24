# SESSION-COST-PROTOCOL-REVIEW: §3's ask counts on the product's code

`session-trace.*.mjs`: `client/view/window.test.mjs`'s harness (the real `Controller` and `downloader.js` behind a
stand-in transport and decoders, each step's frame here before the next) driving `session-cost.md` §1's trace. Copy
into `client/view/` of the commit named and run with `node`; frame bytes from `claude/delivery:lab/delivery/inputs.json`.

* `.tip.mjs` at `claude/unified` `b059388b6` (the commit `model.py` says it simulates; harness of `5353ae8de`).
* `.pr446.mjs` at `claude/window-whole-groups` `e8a52cfe4` (PR 446; harness of that branch, `meta.lossy.g` set).

| volume, form (n, G, W) | model.py | product at b059388b6 | PR 446 |
| --- | --- | --- | --- |
| dbts_a1 view (56, 8, 56) | 56, 4.64 MB | 56, 4.64 MB | 56, 4.64 MB |
| dbts_a1 exact (56, 1, 56) | 56, 67.81 | 56, 67.81 | 56, 67.81 |
| dbts_b1 view (50, 8, 15) | 764, 355.69 | **796, 370.54** | **130, 60.61** |
| dbts_b1 exact (50, 1, 15) | 132, 284.63 | 132, 284.63 | 132, 284.63 |
| dbts_c1 view (69, 8, 54) | 198, 17.17 | **177, 15.40** | **85, 7.74** |
| dbts_c1 exact (69, 1, 54) | 99, 100.66 | **84, 87.12** | 84, 87.12 |

Measured 2026-11-24 ~13:35 UTC in one cloud container, Node 22. Limits: frames counted only (1×1 stand-in frames, an
instant transport: the infinite pipeline `model.py` also assumes); no browser, link, decode or time.
