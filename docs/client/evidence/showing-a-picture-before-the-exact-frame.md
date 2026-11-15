# Which picture, in which carrier, may stand before the exact frame?

**Question:** before 2026-11-09 the client was to show a lossy picture first and reach the exact frame from it (a
preview, a residual, a layered stream). Which carriers were measured, what did they give, and what of it still bears
on the optimal-quality view?

*Folded 2026-11-14 as a record. **Superseded** by the owner's design of 2026-11-09: one optimal-quality view, the
exact HTJ2K frame on explicit request, the residual and the preview dropped ([`../design.md`](../design.md) §Decided).
Sources, each a pre-registered protocol and its run: `claude/av1-top-first:docs/av1/top-first.md` (theory, 2026-11-04,
`c2830266`); `claude/av1-preview-noise:docs/av1/preview-noise.md` (2026-11-07, `b2b3df05`) and, on the same branch,
`snr-preview.md` and `profile-carriers.md`; `claude/av1-profile-carriers:docs/av1/profile-carriers-review.md` (an
independent review, 2026-11-04, `9aec9477`); the decode audit's restatement
(`claude/av1-audit-decode:docs/av1/audit-decode.md` findings 6, 16, 19, `ea329b54`); the enhancement-layer study
(`claude/av1-lcevc-lossy:docs/av1/queue.md` row 19, *Lossy viewing*, theory, 2026-11-02, `196de50c`). Fixtures for
every number: `dbts_a1`, `dbts_b1`, `dbts_c1` of one dataset, 4-core cloud hosts, headless Chromium, software decode;
no phone, no breast ultrasound cine.*

## Results, as recorded

* **The split's top stream first** (*derived* from committed byte arrays): the top is 63–71 % of the shipped
  lossless payload, so the top-only picture (off by at most 3 source levels) is a late near-exact one, 0.12–0.29 s
  ahead of the payload's at 20 Mbit/s, every slice at 0.63–0.71 of its time to exact; the SVC base came at 0.07–0.10 s.
* **A tiny full-size preview** (Q 40–56): the finest-band noise is gone at Q 40 (e_N ÷ σ 1.031–1.128 on 14 DBT
  series); its decode follows the pixel count more than the bytes, so it decodes no faster than Q 24.
* **Every AV1 carrier's decode to every exact slice is 2.8–10× the shipped HTJ2K's**, and the residual plus its add
  1.2–1.6 HTJ2K frames. *Corrected by the audit:* those ratios divide by the codec package's HTJ2K, which carries a
  range pass the product no longer runs, so they understate HTJ2K's lead by up to 21–31 %; "`two` decided slower than
  `sep`" was the JS add (a tie, 0.98–1.02, once removed); SVC's dominance counted bytes and time, not fidelity (a
  quarter-size base at 38.0–38.7 dB against a full-size Q 24 preview at 45.8–46.5 dB).
* **One layered stream or separate payloads:** separate payloads for the exact ask (one HTJ2K frame's decode, against
  a layered exact layer predicted from its own previous exact frame). The independent review found 22 findings, 3 of
  which change the verdict: it stands for the exact frame on request only, the other roles open.
* **The scalable base through WebCodecs** is present on this branch: cutting the OBUs with `spatial_id` > 0 gives the
  base, identical to native dav1d at operating point 1 ([`../../av1/README.md`](../../av1/README.md)).
* **An enhancement layer (LCEVC) for lossy viewing: not worth building on present evidence** (theory). A visually
  lossless DBT stream must carry dense full-size noise, so base AV1 plus LCEVC is expected at AV1's bytes or above
  (*derived*), and the only web decoder draws 8-bit RGB through WebGL, losing 10–12-bit window and level. One offline
  bytes-at-equal-fidelity measurement would decide; not run.

## What still bears on the client

The exact frame by its own HTJ2K payload, not through a lossy layer, is what these runs favoured, and what the
2026-11-09 design kept. A picture before the exact frame survives in one form only: an exact level picture
([`exact-frame-by-htj2k-layout.md`](exact-frame-by-htj2k-layout.md); HTJ2K's own ladder and layers are [`htj2k-progressive-delivery.md`](htj2k-progressive-delivery.md)), the owner's to allow.
