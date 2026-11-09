# HTJ2K resolution levels and regions for large frames

*Row HTJ2K-TILES, 2026-11-09. Theory, predictions and a pre-registered protocol; **nothing here is run**. A
separate approach beside the optimal-quality design ([`lines/optimal-quality.md`](lines/optimal-quality.md) on
`claude/docs-lines`, §Open 9), lower priority than the week's demo. Sources are [S1]–[S8] at the end; *derived* marks
our arithmetic, *unverified* what no source here checks.*

## The question

For series whose frames are large (DBT slices and FFDM, up to 3328×4096 in the fixtures) or whose stored depth D is
high (12–16 bits), is lossless HTJ2K with resolution levels and HTJ2K tiles or precincts a better way than whole
frames to put an exact picture of what the screen shows on it first, and the full frame after?

* **At the fit:** the resolution level that matches the viewport, exact at that level.
* **On a zoom or a pan:** only the HTJ2K tiles or precincts in view, exact at full resolution in that region.
* **The price:** bytes and decode time per ask against whole-frame HTJ2K, and time to the screen's exact picture on
  shaped links.
* **The composition:** with the optimal-quality (OQ) AV1 view, as an alternative for some modalities or as the
  delivery of the exact frame a reader asks for.

## What earlier work settled, and what it did not

| settled | where | what it leaves |
| --- | --- | --- |
| Today's codestreams (RPCL, one layer, one HTJ2K tile, five levels) hold every level as an exact prefix: level 1 is 25.8–29.0 % of a frame, level 2 6.7–7.7 %, on breast series at ~2:1 | [`decode/README.md`](decode/README.md) §A frame at the level the screen needs; `claude/htj2k-progressive` §HTJ2K progressive, measured | nothing about regions |
| A level picture from its prefix decodes in ×0.27–0.31 of the whole frame (level 1), ×0.08 (level 2); exact once clamped to 2^D − 1 | the same | — |
| A level-first fill put the first exact picture on screen at ×0.09–0.69 of today and every frame at ×0.06–0.50, the whole a tie | [`adr/resolution-fitting-for-large-frames.md`](adr/resolution-fitting-for-large-frames.md) §7 | one fill of four views; no zoom |
| **As a fast preview the ladder is not one**: its first picture is 1.9–7.8× an AV1 preview's, since a level-1 prefix is ~27 % of a frame | `claude/htj2k-progressive` §HTJ2K progressive, measured | this question is not a preview: exact pixels at the screen's resolution and region |
| Quality layers: closed for previews (one HT set split puts 77–99 % of the bytes in layer 1; two sets cost 1 + layer 1) | `claude/htj2k-progressive` §Quality layers, measured | not used here |
| Three horizontal HTJ2K tiles as independent codestreams: bytes +0.12–0.59 %, an ask on 3 idle decoders ×0.39–0.45 of the whole frame at 4× | [`decode/README.md`](decode/README.md) §Not yet tried, P-TILE (row TILEMEASURE) | no 2D grid; no zoom's bytes on a link |
| Region decode in OpenHTJ2K costs a region's rows, not its area; today's codestreams (one precinct a resolution) cannot be fetched by region | [`decode/README.md`](decode/README.md) §Region decode, measured | precincts in the stored layout not tried |
| The proposal for the owner's large-frame rule: HTJ2K tiles, banded and band-major, no wire change | [`adr/resolution-fitting-for-large-frames.md`](adr/resolution-fitting-for-large-frames.md) §8 | TILEGRID and BANDS proposed, not run |

The owner's rule of 2026-10-10 (frames over 12 bits fitted plus regions; 12 bits or fewer filled) and of 2026-10-11
(device pixels) stand; this protocol is the measurement §8.8 says the proposal still needs, widened to precincts and
to the OQ design of 2026-11-09.

## Terms

The glossary's **tile** is the server's read of an asked frame, so a codec's tile is always an **HTJ2K tile** here.

* **Level ℓ:** the picture after ℓ of the codestream's NL = 5 decompositions are left out, ⌈W/2^ℓ⌉ × ⌈H/2^ℓ⌉; level 0
  is the frame. *Exact at level ℓ*: equal, sample for sample, to the reversible 5/3 analysis of the encoder's input
  taken to ℓ levels and clamped to [0, 2^D − 1] (`lab/htj2k-progressive/witness.py`).
* **Viewport:** the client's drawing area in device pixels, w × h (device pixels decided 2026-10-11). **Zoom z:**
  displayed pixels per frame sample. **Fit:** the frame whole in the viewport, z_fit = min(w/W, h/H).
* **The level an action needs:** ℓ(z) = min(NL, max(0, ⌊log2(1/z)⌋)), the most reduced level still at least as large
  as what is displayed (*derived*; §8.2's rule).
* **Screen-exact picture:** every viewport pixel painted from samples exact at ℓ(z) in the visible rectangle. Whether a
  level picture counts as exact for reading is the owner's ruling, not this doc's (§Theory 2).
* **Region:** the visible rectangle in frame samples, w/z × h/z around the pan centre, clamped to the frame.
* **Layouts:** **W**, today's whole codestream asked whole; **L**, the same codestream asked level-first; **P**, one
  codestream with precincts and an index; **T3** and **T9**, three strips and a 3 × 3 grid of HTJ2K tiles, each its
  own codestream (§8.3's proposal).
* **Backfill:** after an action's picture, the rest of the frame fetched behind it, so the frame ends exact whole.
