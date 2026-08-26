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

## References

- [`adr-client-window-depth.md`](adr-client-window-depth.md) — `D`, `Tf`, and `U`
- [`adr-stride-is-bandwidth-conservation.md`](adr-stride-is-bandwidth-conservation.md) — the other motion lever
