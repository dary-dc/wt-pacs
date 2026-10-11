# ADR: fit delivered resolution to the viewport for frames larger than it

**Status:** accepted, **blocked on a dependency outside this repo** · **Date:** 2026-08-26 ·
**Tags:** delivery, codec, client

---

## 1 · Context

Frames divide cleanly by whether they exceed the viewport:

| | example | delivered |
| - | ------- | --------- |
| **Smaller than the viewport** | 512×512 CT | whole frame — every pixel is needed, and it is upscaled anyway |
| **Larger than the viewport** | 1996×2457 tomosynthesis | this ADR |

For the second class, sending every pixel means sending detail the display cannot show. At 10 Mbps a
2.99 MB frame takes 2.5 s, so a stack of them is not scrollable at any depth setting. **No ask policy,
window, or stride fixes this** — the bytes are simply too many.

The classifier is **dimensions against viewport**, not modality. Modality only correlates.

---

## 2 · Decision

**Deliver the resolution rung that fits the viewport. Use tiles for zoom past native, not for fitting.**

Three regimes, distinguished by what the reader is actually looking at:

| reader is | delivered |
| --------- | --------- |
| Viewing a frame that fits | whole frame, native |
| Viewing a larger frame fitted to the viewport | the **rung** that fits |
| Zoomed past the fitted view | **tiles** covering the visible region, at native |

Tiles and rungs are not interchangeable. **A tile subset is a crop; a rung is a downsample.** Fitting
needs a downsample, so tiles cannot do it.

### What it buys — tomosynthesis at 10 Mbps

| rung | dims | MB | `Tf` | fps | `D` | miss cost |
| ---- | ---- | -- | ---- | --- | --- | --------- |
| 0 native | 1996×2457 | 2.99 | 2.5 s | 0.4 | 1 | 0 |
| 1 | 998×1229 | 0.80 | 0.67 s | 1.5 | 2 | 670 ms |
| 2 | 499×614 | 0.21 | 0.18 s | **5.6** | 2 | 180 ms |

Rung shares come from the measured resolution ladder (0.35 / 0.70 / 1.97 / 6.90 / 26.92 / 100%).
**They are content-dependent** (measured 2026-09-18): the half-size image takes 23–25 % of the
bytes at ~2:1 compression (CT-like) and **48 %** at ~18:1 (ultrasound-like cine), where an
eighth-size image is 5.9 % rather than ~1–2 % — the better the content compresses, the larger the
low-resolution share of a smaller whole ([`decode/README.md`](../decode/README.md) §A prefix draws a
smaller image).

---

## 3 · Why not the alternatives

| Option | Verdict |
| ------ | ------- |
| **Whole frame always** | 0.4 fps. Not a product |
| **Native crop filling the viewport** | Viable and complementary — ~20% of the bytes, full sharpness, but shows *part* of the frame. Panning becomes a refetch across the whole stack, and the reader loses the overview. A deliberate mode, not the default |
| **Full decode then downsample client-side** | Correct output, **zero byte saving**. Pointless for the problem being solved |
| **Fit the rung** *(chosen)* | Whole frame, reduced sharpness, ~7–27% of the bytes |

---

## 4 · Consequences

### Positive

- Large-frame modalities become scrollable for the first time in this design
- The classifier is a property of the data (dimensions vs viewport), so it needs no per-modality table

### Negative

- **A miss penalty appears where there was none.** At native, `Tf` is so large that `D = 1` and nothing
  is ever queued. Dropping a rung raises `D` to 2 and introduces a 180–670 ms miss cost. Cheap for what
  it buys, but it is a new cost, not a free win
- **`U` loses most of its justification.** Large `Tf` was the main case where `U` changed the answer
  (see [`client-window-depth.md`](client-window-depth.md)). If large frames ship at a rung, `U`
  fires only for ordinary frames on ~1 Mbps links
- Reduced sharpness during motion. Whether that is acceptable is a fidelity ruling, not an engineering
  one

### Blocked

**This ADR is accepted but not implementable.** Reduced-resolution planes do not reach the render path
in the current integration target; the constraint and the two routes around it are recorded outside
this repo. Every row below rung 0 in §2 is what we would get, **not what we have.**

Today everything ships at rung 0.

---

## 5 · Follow-up

- Unblock the render path — the dependency is tracked outside this repo
- **Spatial tile decodability is unmeasured.** Every measurement to date used a single-tile image. The
  zoom regime in §2 rests on it
- Re-check `U` once large frames ship at a rung — if its only remaining case is 1 Mbps, consider
  removing it from the depth formula

---

## 6 · Bytes per displayed frame (T4)

**Open.** On a 20 Mbps link a 250 KB frame is 100 ms of wire, and nothing below the wire moves
that. Three levers above it cut bytes per displayed frame, none of them a transport change, and
each needs the render path to accept less than the whole frame: a **prefix** (a truncated HTJ2K
codestream is a viewable smaller image), a lower **rung** (§2), and **stride**
([`stride-is-bandwidth-conservation.md`](stride-is-bandwidth-conservation.md)).

**What a prefix is worth, answered for the decoder** (L19, 2026-09-18): the
fixtures are encoded RPCL, one layer, one tile, five decompositions, so a prefix is a whole smaller
image. The smallest prefix that decodes byte-identical to the full codestream at that level is a
quarter of the frame for the half-size image at ~2:1 and half of it at ~18:1, mutation-checked at
the boundary. **Only the shipped decoder package can do it** (`decodeSubResolution(level)`); the
source build returns a full-size image with detail missing, and only past a floor that is 72 % of a
colour frame ([`decode/README.md`](../decode/README.md) §A prefix draws a smaller image). Handing a
decoder a frame's first bytes is not built into the clients: it waits on how a smaller first image
is displayed.
*Corrected (row RESLEVEL, 2026-10-07):* the package's level output is exact only once clamped to the declared depth;
"byte-identical" was to its own whole-codestream decode (§7).

**The rule, fixed before the cell runs:** at 20 Mbit / 50 ms on the rig
([`rig-limits.md`](../rig-limits.md) §9), 250 KB frames, time from ask to a viewable image with a 25 %
prefix against the whole frame. **Apply prefix delivery if it is at least 2× faster to first
viewable and the viewer accepts the prefix as an image**; the full frame then follows on the same
stream. The rung and stride decisions follow from the same number at their own byte counts. If no
truncation of the packed fixtures decodes, the packer's progression order is the first change, not
the transport. Report per truncation: decodes or not, bytes, time to viewable at 20 Mbit.

**The wire piece, unbuilt.** A prefix ask is `RequestFrame` plus a byte or rung bound; the server
serves the prefix, then the rest. On a shared stream the rest queues behind later prefixes; on a
per-frame stream it is the same stream's tail, and abandoning a tail the reader has moved past
needs `RESET_STREAM_AT` (reliable partial reset, required by the WebTransport draft), which neither
quinn nor wtransport carries yet, and whose support in Chromium is unchecked.

---

## 7 · The level a phone screen needs, measured (row RESLEVEL, 2026-10-07)

**Proposed, not built.** Measured in the lab on the breast series ([`decode/README.md`](../decode/README.md) §A frame at
the level the screen needs, [`lab/av1/decode/resolution-level`](../../lab/av1/decode/resolution-level/README.md)): a fill that sends every frame's
prefix first and every rest after puts the first exact picture on screen at ×0.09–0.69 of today's time and every frame
of a four-view study at ×0.06–0.50, on every link of row 23 at 1× and 4×, and finishes every whole frame at a tie
(×0.98–1.04). §6's rule — 2× to first viewable — holds at 5 and 20 Mbit on every series (×0.09–0.45), and at 50 Mbit
on the mammograms only (DBT slices ×0.65–0.69).

**What it would take, each piece structural:**

1. **The store**: today's codestreams unchanged (RPCL, one layer, one tile already put the level first); each frame
   indexed at its level's byte offset — the smallest exact prefix, 26–29 % of a frame at level 1, 7 % at level 2. Ingest
   finds it with the decoder (as the lab does) or from packet lengths (PLT); the level is the store's or the ask's.
2. **The wire**: §6's prefix ask — the prefix first, the rest on zoom or behind every prefix. The lab carried it with
   no wire change, the prefix and the rest as two store entries a frame (2F entries, prefixes first), which is the
   same bytes in the same order; the downloader's own window then decides when the rests go.
3. **The decoder**: `decodeSubResolution(level)` on the prefix, then **a clamp to 2^B − 1** — without it 15 of 35 frames
   are not exact — and the prefix kept until its rest arrives, joined, decoded whole. Grey unsigned measured; signed
   and colour not.
4. **The render path** accepting a picture a quarter or a sixteenth the size, scaled up until the whole arrives — §4's
   blocker, unchanged.

The owner decides 1, 2 and 4; until the render path takes a smaller picture, none of it reaches a screen.

## 8 · The owner's rule for large frames, and what it needs (row TILEDESIGN, 2026-10-11)

**The rule (the owner, 2026-10-10):** "every series over 12 bits that is not a volume or 3D view — breast or not; the
product serves whatever a radiologist reads, breast is only the next phase — is served at the resolution that fits the
client's screen, plus tiles for zoomed regions; volumes and 3D views keep their own path, HTJ2K only for now; series
at 12 bits or less are filled." It is §2's decision made for a class of series; what follows is **a proposal, theory
only: nothing here is built or timed**.

### 8.1 · What it covers

| series | b | not a volume? | under the rule | frame |
| --- | --- | --- | --- | --- |
| FFDM For Processing (raw) | 13–14 ([`../av1/series.md`](../av1/series.md) §1d) | yes | fitted + tiles | 2560×3328, 3328×4096 |
| DBT projections, raw | 14 | yes: 15–26 views by angle | fitted + tiles | 1664–3328 × 2048–4096 |
| CR / DX over 12 bits | DX allows 6–16 (PS3.3 C.8.11.3); none in the lab | yes | fitted + tiles | not measured here |
| XA / RF at 16 bits | allowed (C.8.7.1, C.8.19.2); none seen | yes, cine | fitted; fits most screens whole | 512²–1024² class |
| CT | 13 on three vendors | a stack is a volume | its own path, HTJ2K | 512² |
| MR | 9–11 | volume | filled | small |
| FFDM For Presentation, synthesized 2D, DBT slices, processed projections, US | 8–12 | — | **filled**, whole frames as today | up to 3328×4096 |

**In the breast family the rule reaches only For Processing images**, and whether those are AV1 targets at all is
already the owner's (§Blocked, row 121 DATAAUDIT). Outside it, CR/DX is the case it was written for; no CR or DX
series is in the lab. A frame no larger than the screen fits at level 0, so for small frames the rule is today's fill.

### 8.2 · "Fits the screen", counted two ways

The level is the most reduced one whose size still covers the displayed size, the frame fitted whole into the
viewport. One viewport filling the screen; two side by side (a left–right hanging) is one level coarser on the wide
frames:

| screen | device px · CSS px | 3328×4096 | 2560×3328 | 2394×2850 | 1914×2572 |
| --- | --- | --- | --- | --- | --- |
| phone 1080×2400, DPR 2.625 | device · CSS | L1 · L3 | L1 · L2 | L1 · L2 | L0 · L2 |
| tablet 2048×2732, DPR 2 | device · CSS | L0 · L1 | L0 · L1 | L0 · L1 | L0 · L0 |
| laptop 2560×1600, DPR 2 | device · CSS | L1 · L2 | L1 · L2 | L0 · L1 | L0 · L1 |
| 5 MP diagnostic 2048×2560, DPR 1 | both | L0 | L0 | L0 | L0 |

**The cost per level** is the smallest exact prefix ([`../decode/README.md`](../decode/README.md) §A frame at the
level the screen needs): L1 25.8–29.0 % of the frame, L2 7.0–7.5 % (measured, breast, ~2:1); L3 ~2 % and L4 ~0.7 %
from §2's ladder (not measured on breast). So device pixels cost **4× to 13× the bytes of CSS pixels** on a phone
(L1 against L2–L3), and give the radiologist the sharpness the panel has; CSS pixels upscale by the DPR. **On a 5 MP
diagnostic display both counts are L0**: the rule there sends every pixel, and tiles never apply until a zoom past 1:1.
The choice of count is the owner's; the viewport, not the screen, is what the client measures (§1).

### 8.3 · The store

Two layouts reach a region:

| | tiles as independent codestreams | precincts with PLT in one codestream |
| --- | --- | --- |
| decoder | today's OpenJPH build, one call a tile | one that decodes by region: OpenJPH does not (skips PLT, no region decode, rows 109, 113); OpenHTJ2K decodes every block of each row a region reaches and is ×1.13–1.41 slower whole |
| server | serves stored entries as today | parses packet offsets and serves a partial codestream a decoder must accept (a JPIP-like server, ISO/IEC 15444-9) |
| bytes | +0.01–0.59 % at k = 2–3 (row 133) | precinct overhead, not measured |
| an ask's decode | k = 3 tiles on 3 idle workers ×0.388–0.448 of the whole frame at 4× (row 133) | not measured with a region decoder that skips columns |
| grid | horizontal strips measured; a 2D grid not | any precinct grid |

**Proposed: tiles as independent codestreams**, each in the served profile (RPCL, one layer, five levels), so each
tile's level-L picture is an exact prefix of it, as for whole frames today. In the store, a tile's codestream is cut at
its level boundaries into **bands** (the coarsest level's prefix, then each finer level's increment), and the bands are
laid out **band-major**: every frame's and tile's coarsest band first, then every next band. A fitted series at level
L is then one contiguous range of entries, and a zoom is the finer bands of the tiles in view. The SBND table already
indexes entries; what it lacks is the map from (frame, tile, band) to entry, the tile grid and the level of each band
— in the metadata, or a version 2 table. A level picture's exactness needs **a digest per tile and level** taken from
the encoder's input (the 5/3 analysis and clamp that `ll.py` witnesses), beside today's per-frame digests: a
store-content change ([`exactness-in-production.md`](exactness-in-production.md)).

### 8.4 · The wire

* **No wire change** (proposed first): entries are asked as frames are today. The fitted view is
  `stream_frames {from: 0, to: last entry of band L}`; a zoom is `request_frame` per band of each tile in view. The
  RESLEVEL lab carried prefixes and rests this way, two entries a frame, with no server change. The cost: an ask ends a
  running fill ([`../WIRE.md`](../WIRE.md) §An ask during a fill), so a zoom during the fitted fill stops it and the
  downloader re-asks the rest, as it does today; and the envelope's index is an entry's, which the client maps back.
* **A region ask** (`{"op":"request_region","frame":N,"level":L,"tiles":[…]}`, or a level on `stream_frames`): the
  server maps (frame, tile, band) to entries; clients stop carrying the map. A wire change, versioned.

### 8.5 · The client

**The same decoder build with more of its workers.** Each tile is a whole codestream OpenJPH decodes as it is; the k
tiles of one ask go to k idle decoders and are written at their rows into the frame's `SharedArrayBuffer`, which the
client already decodes into and is cross-origin isolated for ([`../../client/README.md`](../../client/README.md)).
What changes is the dispatch: one ask becomes k jobs, and the decoders it wants idle are the ones row 113 L5 and P-START
find unused today; decoders started on first need (P-START) would start them on the first tiled ask. The level picture
is `decodeSubResolution(L)` on the joined bands, then the clamp to 2^B − 1 (§7.3); a zoom joins the finer bands and
decodes those tiles whole. A fill of a tiled series decodes k pieces a frame on whatever decoders are free, so its time
is predicted unchanged (row 133's one-worker arm, ×0.99–1.08 at 4× on the large series). **Nothing past k = 3 is claimed**:
three workers and the page filled the container's 4 cores. The render path must take a picture smaller than the frame
— §4's blocker, unchanged.

### 8.6 · A case for the owner: large frames at 12 bits and under

The rule fills them whole. A four-view 12-bit FFDM exam fills in 10.9–20.0 s at 5 Mbit, 2.89–5.19 s at 20 and
1.33–2.30 s at 50 (HTJ2K, 1×; rows 95–96, `lab/av1/bytes/mammography-at-scale`); synthesized 2D 20.6 · 5.36 · 2.35 s.
§7's level-first fill on the same links put the first exact picture on screen at ×0.09–0.49 of that and every view at
×0.06–0.50, the whole a tie. Whether the 12-bit large frames keep the plain fill, as the rule says, or take §7's level
first (no tiles) is the owner's.

### 8.7 · Proposed rows, none queued

1. **TILEGRID**: P-TILE's harness on a 2×2 and 3×3 grid of the large series: bytes, the ask on k idle workers, and the
   bytes a 1080×2400 zoom at 1:1 fetches, against horizontal strips.
2. **BANDS**: the band-major store in the lab, no server change: a fitted fill at L1 and L2 and a zoom, through the
   downloader, on row 23's links, every level picture against its digest from the encoder's input.
3. **CRDX**: a sound CR or DX set over 12 bits in the lab (none today), so the rule's main case outside the breast
   has data.

## References

- [`client-window-depth.md`](client-window-depth.md) — `D`, `Tf`, and `U`
- [`stride-is-bandwidth-conservation.md`](stride-is-bandwidth-conservation.md) — the other motion lever
- [`decode/README.md`](../decode/README.md) §A prefix draws a smaller image — the measured prefix curve
- [`decode/README.md`](../decode/README.md) §A frame at the level the screen needs — §7's numbers
