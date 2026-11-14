# Does coding the exact frame as three strips make *Lossless* arrive sooner?

**Question:** a Lossless request today fetches one HTJ2K codestream and decodes it on one decoder. If the exact frame
were three horizontal strips, each its own codestream decoded on the client's three decoders as it lands, how much
sooner would the exact frame be on screen, at what byte cost?

*Folded 2026-11-14 from `claude/htj2k-tiles:docs/htj2k-tiles.md` §Improve (I2, three strips), §Improve, measured:
stages 0–2 (2026-11-11), §Improve, measured: stage 3 and §Verdict (2026-11-12, by a session that wrote none of the
design or the run), `3f339d29`; the review of the proposals (`claude/reviews-2026-11-13:docs/reviews-2026-11-13.md` §4,
`8da33d8e`). In that file the arms are D (today's demo approach: the optimal-quality scroll, the whole HTJ2K frame on
request) and D+T3 (the same with three strips); the strips need the store-format change called Layout 1 there
(`docs/disk-layout/target.md` §Layout 1), not built. The sibling question is
[`exact-level-picture-first.md`](exact-level-picture-first.md).*

**Fixtures and host, for every line:** `dbts_a1`, `dbts_b1`, `dbts_c1`, one dataset (EA1141), slices not independent
samples; a 4-core cloud host (Xeon 2.1 GHz) without a GPU, headless Chromium 153.0.8010.12, software WebCodecs, three
decoder workers; a 4× cgroup cap standing in for a phone (*assumption*); emulated links. **The host saturates:** D's
software AV1 fill makes 13 of 20 (set, link) pairs decode-bound at 4×, which leaves the 5 Mbit/s link (`r5000`) the
only link-bound cell. Nothing past it is claimed.

## Results (measured)

* **Exact:** on all 175 frames, every level's prefix decodes on OpenJPEG 2.5.4 and OpenJPH 0.31.0 to its strip's
  witness, and the three level-0 strips stacked equal the frame's SHA-256; every mutant caught.
* **Bytes:** +0.009–0.013 % on `dbts_a1` and `dbts_c1` with the profile (tile-parts at resolutions, TLM); −0.27 to
  −0.30 % on `dbts_b1`, whose sixth decomposition saves (predicted ±0.1 %); +0.11–0.14 % with the strips (`dbts_b1`
  −0.20 to −0.24 %).
* **Decode:** one frame's three strips on three workers at ×0.43–0.48 of the whole frame at 4×, 10 of 10 rounds;
  ×0.972–0.980 at 1×.
* **On the link-bound cell** (`r5000`, 4×): D+T3's Lossless at **×0.923 of D's on `dbts_b1`**, ×0.936 on `dbts_a1`,
  ×0.915 on `dbts_c1`, with the same bytes. *Corrected in place by the verdict:* from the stage-2 decode times the
  strips can explain at most about ×0.97 on `dbts_b1`. The rest is a path difference between the arms no row isolates:
  D runs on the product client (one ask, one decoder, XXH3-checked before the picture), D+T3 on the lab page (nine
  asks on three workers, hashed after the clock).

## Verdict, with its scope

Survives as a candidate, its gain not attributed to the strips. Owed, pre-registered in the source: **A1** on this
host (arms D, D+T1 = today's codestream through the lab page's path, D+T3; `r5000` and `r20000`, 1× and 4×, six
rounds; the strips' effect is D+T3 ÷ D+T1, predicted ×0.96–0.99; the layout stays proposed for the strips only if that
is ≤ ×0.95 × (1 + s); if D+T1 ÷ D ≤ ×0.95, the product's exact path has an overhead the lab page lacks, a client
finding whatever the layout), then a phone round (whether its fill is decode-bound; the request timed on the phone).
Whether the layout waits for A1 is the owner's.
