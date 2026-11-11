state: done
started: 2026-11-11 14:43 UTC
heartbeat: 2026-11-11 15:30 UTC
outputs: `claude/oq-integrity` (from `claude/proposals`) at `39a7bdd3`: `docs/lines/proposals.md` §Integrity; no PR
(the row names none)
## Resume
Done. Nothing owed by this row. Docs only: no gate run (no code changed).
## Result
§Integrity separates integrity from quality; theory and pre-registered protocols only, nothing built or measured.
* I1, a reconstruction digest: the ingest already decodes every OQ frame through dav1d; one XXH3-64 of each, in
  `lossy.reconstruction`, checked by `decoder.js`'s existing `checked()`. AV1 §7.2 makes the output "identical in all
  respects" across conforming decoders when no film grain is signalled (the ingest codes without); WebCodecs only
  hints the decoder kind (§7.9), so the digest is what covers a phone's hardware decoder. Cost (assumption): 1.2–5.2 ms
  a frame here, 5–52 ms on a phone, 1–10 % of a decode; no sampling. Gap found: at G > 1 a mismatched inter frame has
  no second decode today (`av1.js`); I1 includes re-decoding its group on dav1d-WASM.
* I2, the coding error per frame at the ingest: RMS e, max |Δ|, e_N ÷ σ (window-free, the criterion Q 8 was chosen by);
  the overlay converts e to display levels at the current window. Never "visually lossless".
* I3, label and overlay per outcome (matched, matched on re-decode, not as coded → blocked, no digest → grey).
* Protocols: I1 on the 18 demo series in Chromium, both routes, 5 mutants, cost interleaved ≥ 7 rounds at 1× and 4×;
  I2 against the quality study's rows. Fixtures: three DBT volumes of one dataset; no hardware AV1 decoder in any cell.
Owner decisions: (1) whether DEMO-UX's green mark ships before I1 (until then it claims a check nobody ran);
(2) whether to build I1 (+ the group re-decode) and I2, and when.
