# The native client's milestones

**Question:** Is the native client's painter exact (M1), does it fill or answer an ask faster than the browser on one
machine (M2), and is its file cache verified and crash-safe (M3)?

*Folded 2026-11-14 from `claude/direction:docs/lines/native.md` §2 *Results that stand* (2026-11-12). The protocols,
predictions, full tables and mutants are in [`../../native/README.md`](../../native/README.md) §6, which owns them and
is not repeated here; this file is the verdicts with their fixtures, so the client's design can point to one place. M4
(the core on one Android phone, after the ARM decoder port) has not run. The window on each paint thread, timed
against the browser after M2: [`native-window-against-browser.md`](native-window-against-browser.md); the wire against
WebTransport: [`native-client-wire-parity.md`](native-client-wire-parity.md).*

**Fixtures, for every result below:** cloud containers, 4 vCPU, no GPU, software rendering (lavapipe for native,
SwiftShader for the browser); no native run on a phone or a GPU. Run 2026-10-28. The lab rigs for M2 and M3 were
removed from the tip (`3a4a5922`); M2's runner is pinned at `0920153d`, M3's cells at `a237cf3e`, and M2's rows at
`claude/core@2e6fa5b2`.

| milestone | verdict | the numbers | scope, and where the host saturates |
| --- | --- | --- | --- |
| **M1, the painter exact before it is fast** | **passes** | 54 exact cells × DPR 1 and 2, \|Δ\| = 0 against the browser suite's float64 CPU reference; fractional cells at most 1 code; every mutant the browser suite catches is caught, and one it misses | lavapipe (llvmpipe, Mesa 25.2.8) only. Vulkan says the 8-bit conversion *should*, not must, round to nearest, so exactness on a GPU is not shown |
| **M2, fill and ask against the browser** | on a clean link **a native client buys nothing** on fill or ask on desktop; under 2 % random loss at 20 Mbit its fill is **about 4 % faster** (0.960, one decidable cell; 0.944–0.948 in every lossy cell post hoc); its clear gain is **where client CPU binds**: 0.43–0.48 of the fill and 0.30–0.33 of the first frame on loopback | 20 Mbit clean: 0.996 (61 MB), 0.982 (4.4 MB); the ask at depth 1, 40 ms, painted 1.038 (1024², P3 fails), exact 1.013; 20 692 of 20 692 frames exact | on loopback the browser holds its two client cores at 0.96, so P1 is read at a two-core client and claims nothing for more cores; behind the relay nothing is busy. The native arm decodes one frame at a time on its receive loop, the browser on three workers; native reads the whole target back, the browser one pixel |
| **M3, the file cache** | **the design stands** | warm reopen from the cache 373 ms (345–443) against 25 145 ms from the relay at 20 Mbit, 0.015×; 100 of 100 random kills clean (7 749 frames whole, 2 251 absent, 0 torn); 7 of 7 flipped bytes refused and fetched again | a synthetic 87-frame 768×920 12-bit series, 60.9 MB, ext4. The reopen read the page cache: a **cold reopen** (after a reboot) is **not measured**, nor a **power loss** (the two fsync mutants survive) |

**What it decides (the rule's reading, M2):** on desktop on a clean target link the native client's case is not the
fill or the ask; it rests on the cache, background work and phones, where the client's CPU is more likely to bind.
M4 measures that on a phone; a GPU desktop reruns M1 and M2 on a GPU, the first numbers that are not software
rendering.
