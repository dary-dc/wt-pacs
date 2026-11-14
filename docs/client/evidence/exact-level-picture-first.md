# Should the client show an exact lower-resolution picture before the exact frame, or scroll HTJ2K at the screen's resolution?

**Question:** an HTJ2K codestream ordered by resolution holds, in a prefix, the exact picture at a lower level (a
power-of-two reduction). Two uses: show that **level picture** first on a Lossless request, the full frame after; or
scroll the whole series as HTJ2K at the level that fits the screen, in place of the optimal-quality AV1 scroll.

*Folded 2026-11-14 from `claude/htj2k-tiles:docs/htj2k-tiles.md` §Screen resolution against the demo's approach (and
its review), §Improve (I3, bands at the viewport's level; I4, the cache), §Improve, measured: stage 3 and §Verdict
(2026-11-12, by a session that wrote none of the design or the run), `3f339d29`; the review of the proposals
(`claude/reviews-2026-11-13:docs/reviews-2026-11-13.md` §4, `8da33d8e`). Arms there: D (today's approach), D+L★ (D
with an exact level picture first on a Lossless request), S★ (HTJ2K at the screen's level for the scroll). Both need
the store-format change called Layout 1 there, not built. Fixtures and host, and where the host saturates, are as in
[`lossless-decode-by-strips.md`](lossless-decode-by-strips.md): three DBT volumes of one dataset, of which only
`dbts_b1` upright and `dbts_c1` sideways reach level 1 on a phone screen; one 4-core host, software decode; only the
5 Mbit/s cell link-bound.*

## Results (measured)

* **D+L★: the level picture at ×0.264 (4×) and ×0.279 (1×) of today's Lossless wait** on `dbts_b1` at 5 Mbit/s,
  against a predicted ×0.22–0.40. The mechanism holds with it: the level is 0.27 of the strips' bytes. The full frame
  after it: ×1.001–1.010 of D's, so the level decoded twice does not show on a link.
* **S★ withdrawn for the scroll.** Where the screen's fit is level 0 it sends the whole exact series, and pictures
  every slice ×11–14 later at 5 Mbit/s (`dbts_a1` ×4.0–5.6 first picture and ×14 every slice; `dbts_c1` ×3.5–4.6 and
  ×11). Only `dbts_b1` (fit level 1) meets its rule: first picture ×0.67–0.90 and every slice ×1.23, and better than D
  in the decode-bound cells, because this host decodes AV1 in software, which a phone with a hardware AV1 decoder may
  not share.
* **Reopens:** 431 of 431 asked and decoded nothing (S★, D+L★). In 24 reopens, all on `dbts_b1`, the **lab** store read
  an optimal-quality picture of frame 47 or 49 (17 MB, the volume's last) back differently; exact and level pictures
  always matched; two visits were refused for quota. The product store keeps only checked frames, so neither reaches
  it. A level-picture cache would add about 215 MB a `dbts_b1` volume (4.3 MB × 50, *derived*); what a phone allows is
  unmeasured.
* The jump-during-cine prediction (within ±5 % of clean) was **refuted**: ×0.39–4.1 with s up to 3.9; the cell cannot
  resolve the arms in six rounds.

## Verdict, with its scope

The demo's approach stands for the scroll on all three volumes. D+L★ survives on its mechanism, on one volume at one
link. **For the owner:** whether an exact level picture may be shown before the frame, and in what words (it is exact
at its level, not the full frame resampled); whether the phone round carries it (the request to the level picture and
to the Lossless picture, from the page's beacon) and a store check on the phone (every record read back equal, within
the reported quota).
