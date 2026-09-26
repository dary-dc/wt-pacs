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
low-resolution share of a smaller whole ([`decode/README.md`](decode/README.md) §A prefix draws a
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
  (see [`adr-client-window-depth.md`](adr-client-window-depth.md)). If large frames ship at a rung, `U`
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
([`adr-stride-is-bandwidth-conservation.md`](adr-stride-is-bandwidth-conservation.md)).

**What a prefix is worth, answered for the decoder** (L19, 2026-09-18): the
fixtures are encoded RPCL, one layer, one tile, five decompositions, so a prefix is a whole smaller
image. The smallest prefix that decodes byte-identical to the full codestream at that level is a
quarter of the frame for the half-size image at ~2:1 and half of it at ~18:1, mutation-checked at
the boundary. **Only the shipped decoder package can do it** (`decodeSubResolution(level)`); the
source build returns a full-size image with detail missing, and only past a floor that is 72 % of a
colour frame ([`decode/README.md`](decode/README.md) §A prefix draws a smaller image). Handing a
decoder a frame's first bytes is not built into the clients: it waits on how a smaller first image
is displayed.

**The rule, fixed before the cell runs:** at 20 Mbit / 50 ms on the rig
([`rig-limits.md`](rig-limits.md) §9), 250 KB frames, time from ask to a viewable image with a 25 %
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

## References

- [`adr-client-window-depth.md`](adr-client-window-depth.md) — `D`, `Tf`, and `U`
- [`adr-stride-is-bandwidth-conservation.md`](adr-stride-is-bandwidth-conservation.md) — the other motion lever
- [`decode/README.md`](decode/README.md) §A prefix draws a smaller image — the measured prefix curve
