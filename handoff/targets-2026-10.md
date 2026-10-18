# Direction, 2026-10 (not a destination)

The design reviews read this file. It is the owner's **direction**, gathered from what he has already decided; it is
not a fixed target, it will change, and **he is not to be asked these questions again**. The goal is not one optimum
for one scenario but enough understanding to adapt the product quickly when the needs change.

**How a review uses it:** for each design, name the parameters that decide it, show how the choice changes across
each parameter's plausible band ("if the need is X, A; if Y, B"), prefer choices that can be switched quickly
(configuration, not structure), and state what switching later would cost. A choice that locks the product into one
scenario says so.

## The direction (owner, with the date he said it)

* **The goal:** serve as many sessions as possible at the lowest cost, while keeping latency low and throughput
  high; which of the two matters depends on the use case (2026-10-18). Both count: the fill's time to all frames
  (it feeds the client cache that frames are shown from) and one frame's latency; a lever that only moves per-frame
  waits without shortening the fill is not interesting, and capping what the server sends is unwelcome (2026-09-11).
* **This phase:** resources, on-demand latency, fill throughput; resilience is a later phase (2026-09-24).
* **Clients:** mobile, resource-constrained devices on lossy wireless links. Remove work rather than add decoders; no
  TCP for the fill unless proven; loopback is receiver-bound and is not the regime the product lives in (2026-09-11).
* **Content:** the final image is always lossless and bit-exact; what may change is when bytes arrive and what is
  shown first (2026-09-18). Breast imaging first: mammography, tomosynthesis (DBT) slices, breast ultrasound and its
  cine, ABUS; other cine second; CT/MR volumes stay HTJ2K (2026-10). Series of 12 bits or fewer are filled; deeper
  ones get the screen-sized fit plus tiles; no low-resolution preview (2026-10-10).
* **Client cache:** OPFS; a frame is never decoded twice; compressed versus decoded is undecided (2026-09-11).
* **Comparisons:** each stack at its best configuration; every number with its exact source (2026-10-12).

## Open by design (estimate across a band; do not ask)

| Parameter | Why it decides something | Band to reason over |
|---|---|---|
| Sessions per host, and how many fill at once | disk queue depth, executor threads, memory and memlock per session | a few to thousands |
| Series sizes (frames × frame size) | whether the working set fits the page cache; fill vs. tile reader | mammography 4 × ~50 MB to CT 2 000 × ~0.5 MB |
| Storage under the series | where reads wait; io_uring vs. the pool; readahead | local NVMe, SATA SSD, HDD, network storage |
| The server host | the saturation point; whether io_uring is allowed (containers, SELinux) | a small ARM box to a many-core server |
| Links | congestion control, an ask during a fill | Wi-Fi to cellular, RTT 10–200 ms, loss 0–5 % |
| Reopening a series | OPFS size and eviction | never to daily |
