# SESSION-COST-PROTOCOL-FIX: §3's ask counts from the product's code

The review's harness (`../SESSION-COST-PROTOCOL-REVIEW/`) with one case added, `b1F63`: `dbts_b1`'s exact series with
a window of 63 frames (FIT holding level-1 pictures, 1280 × 1664 × 2 B). Copy `session-trace.<commit>.mjs` into
`client/view/` of the commit and run `node client/view/session-trace.<commit>.mjs`; each output line is one case's
frames in the order the wire delivered them (`out.*.jsonl`). MB from `claude/delivery:lab/delivery/inputs.json`.

* `tip`: `claude/unified` `b059388b6`. * `pr446`: `claude/window-whole-groups` `e8a52cfe4` (PR 446).

Run 2026-11-24 ~14:25 UTC, one cloud container, Node 22; the review's counts reproduced exactly. Limits: frames
counted only (1×1 stand-in frames, an instant transport); no browser, link, decode or time.
