# A faster exact frame by the HTJ2K layout: strips, an exact level picture first, the screen's level

**The question:** can the reader's *Lossless* request (and the scroll) be served sooner by laying the exact HTJ2K
series out differently — three strips decoded on the decoders the client already runs, an exact picture at a reduced
resolution level shown before the whole frame, or HTJ2K at the screen's level in place of the optimal-quality view
for the scroll — with every frame still exact?

*Folded 2026-11-14 from `claude/htj2k-tiles:docs/htj2k-tiles.md` (`13d62d26`) §Improve, measured: stages 0–2 and stage 3
(2026-11-11/12, by a session that wrote none of the protocol) and §Verdict (2026-11-12, by a session that wrote none
of the theory, the protocol or the run); the theory and pre-registered protocol are in that file's §Theory, §Protocol
and §Improve. PR 324. Also `claude/proposals:docs/lines/proposals.md` §Consolidated H1–H3 and
`claude/reviews-2026-11-13:docs/reviews-2026-11-13.md` §4. **Nothing here is built on this branch.** AV1 previews shown
before the exact frame are another question (`showing-a-picture-before-the-exact-frame.md`, planned beside this file); the resolution ladder for the scroll is [`htj2k-progressive-delivery.md`](htj2k-progressive-delivery.md).*

**Names, defined once here:** *D* is the demo's approach (the optimal-quality AV1 scroll, the whole HTJ2K frame on
request); *D′* the same under a second name, the A/A pair; *D+T3* D with the exact frame in three strips; *D+L★* D+T3
with the frame's exact picture at the screen's fit level shown first; *S★* HTJ2K at the screen's level for the scroll;
*Layout 1* the store format these need (tile-parts at resolutions, TLM markers, a base ≤ 64 as DICOM asks, three
strips, band-major entries).

## Fixtures and where the host saturates

Three timed DBT volumes of one dataset (`dbts_a1` 56 × 1142×1785, 12 bits; `dbts_b1` 50 × 2560×3328, 10 bits;
`dbts_c1` 69 × 976×2513, 12 bits); only `dbts_b1` upright and `dbts_c1` sideways reach level 1 at a phone's fit; no
breast ultrasound cine. One 4-core cloud host without a GPU, headless Chromium 153.0.8010.12, three decoder workers
(nothing past three claimed); a 4× cgroup cap standing in for a phone (*assumption*); links emulated by the rig's relay;
D's series Q 8 at G 16. **The host saturates:** D's software AV1 fill makes 13 of 20 (set, link) pairs decode-bound at
4×, which leaves `r5000` (5 Mbit/s) as the only link-bound cell on every volume. Nothing past it is claimed.

## Results (measured)

* **Exactness.** The profile and three strips held on 175 of 175 frames (every TLM length equal to its Psot; every
  level's prefix with EOC appended decoding to its witness on OpenJPEG 2.5.4 and OpenJPH 0.31.0; the strips stacked
  equal to the frame); the lab binding 456/456; stage 2 **17 920/17 920 pictures exact**; stage 3 every level and
  Lossless picture exact in every kept visit (1 053 kept of 1 200; 125 void, the relay late; 22 failed, all after the
  clock in the lab store). Mutants caught, among them the decoder's SIZ reset removed (72/456 strips not exact after a
  level): a product binding needs that reset.
* **Bytes.** The profile: +0.009 to +0.013 % (`a1`, `c1`); **−0.27 to −0.30 %** on `dbts_b1`, whose sixth
  decomposition saves (the theory had put it at ±0.1 %). Three strips: +0.11 to +0.14 %; `dbts_b1` −0.20 to −0.24 %.
* **Decode** (stage 2, first 8 frames, 10 rounds): three strips on three workers **×0.43–0.48 of the whole frame at 4×**
  (×0.45–0.52 at 1×), 10 of 10 rounds ≤ ×0.60 on every volume; on one worker ×0.98–1.04: strips add no decode, they
  spread it.
* **The Lossless request on the link** (stage 3, 6 rounds, the median of round-paired ratios; s the p90 of |D′/D − 1|):

  | reading, 4× unless said | `dbts_b1` `r5000` (the link-bound cell) | the other clean cells (readings only) | the lossy cell `r20000 l1` |
  | --- | --- | --- | --- |
  | D+T3's Lossless ÷ D's | **×0.923** (s 0.016); 1× ×0.972 | ×0.73–0.94 | ×0.85–1.17 |
  | D+L★'s level picture ÷ D's Lossless | **×0.264**; 1× ×0.279 | `dbts_b1` ×0.28–0.37 | ×0.14–0.39 |
  | D+L★'s Lossless ÷ D+T3's | ×1.010; 1× ×1.001 | ×0.94–1.07 | ×0.77–1.17 (s up to 3.9) |
  | S★'s first picture ÷ D's | ×0.665 | `dbts_a1` ×1.3–5.6; `dbts_c1` upright ×1.1–4.6 | — |
  | S★'s every slice ÷ D's | ×1.227 | `dbts_a1` ×7.5–20; `dbts_c1` upright ×5.8–14 | — |

  On the other volumes at `r5000`: D+T3 ×0.936 (`a1`), ×0.915 (`c1`), ×0.908 (`c1` sideways). The lossy cell cannot
  resolve the arms in six rounds (one lossy round moves a ratio more than the arms differ).
* **The store, outside the rule** (a lab OPFS store standing in for the product's): every reopen asked 0 bands and
  decoded 0 pictures (1 053/1 053). But **in 24 reopens on `dbts_b1`** (18 in the D arms, 6 in D+L★) the store read an
  optimal-quality picture (frame 47 or 49, 17 MB, the volume's last) back differently from its filled copy; exact and
  level pictures always matched; unexplained. **Two visits were refused for storage quota** on the same volume. A
  level-picture record would add about 215 MB per `dbts_b1` volume (4.3 MB × 50, *derived*); how much a phone allows
  is unmeasured. These bear on the cache ([`cache-in-opfs.md`](cache-in-opfs.md), [`cache-options.md`](cache-options.md)).

## Verdict (2026-11-12), with its scope

* **D+T3, three strips for Lossless: survives, its gain not attributed.** ×0.923 of D on `dbts_b1` at `r5000`, 4×,
  within R3's bound only with s. From stage 2's decode times the strips can explain at most about ×0.97 there; the
  rest is a path difference between the arms no row isolates (D runs on the product client: one ask, one decoder,
  XXH3-checked before the picture; D+T3 on the lab page: nine asks on three workers, hashed after the clock).
* **D+L★, an exact level picture first: survives on its mechanism** (the level is 0.27 of the strips' bytes), ×0.26–0.28
  of today's wait on `dbts_b1` at 5 Mbit/s. Whether an exact level picture may be shown before the frame, and in what
  words, is the owner's.
* **S★ for the scroll: withdrawn.** Only `dbts_b1` (fit level 1) meets its rule; where the fit is level 0 S★ sends the
  whole exact series, every slice ×11–14 later at 5 Mbit/s. **The demo's approach stands for the scroll** on all three
  volumes. (Its better showing in decode-bound cells comes from this host's software AV1, which a phone with hardware
  AV1 may not share.)
* Both survivors need Layout 1, a store-format change. Everything is one host, three DBT volumes of one dataset, one
  link-bound cell.

## Owed, pre-registered in that file's §Verdict

**A1, attribution, on this host before any phone:** D, D+T1 (today's whole codestream as one entry through the lab
page's path), D+T3, at `r5000` and `r20000`, 1× and 4×, all three volumes, 6 rounds, D′ the A/A pair. The strips'
effect is D+T3 ÷ D+T1 (predicted ×0.96–0.99 at 4× on `dbts_b1`); Layout 1 stays proposed for D+T3 only if it is
≤ ×0.95 × (1 + s); **if D+T1 ÷ D ≤ ×0.95, the product's exact path has an overhead the lab page lacks: a client
finding whatever the layout.** Then on a phone: whether its fill is decode-bound (it is, on the one phone measured,
[`fill-bound-on-phone.md`](fill-bound-on-phone.md)); the Lossless request with D, D+T3, D+L★ alternated; and the store
(every record read back equal and within the reported quota).

Raw rows: `claude/htj2k-tiles:lab/htj2k-tiles/improve/rows/` (`stage3-s3a.jsonl`, `-s3b`, `-s3c`; a replicate of
rounds 4–5 in `stage3-s3c-4.jsonl`, outside the verdict).
