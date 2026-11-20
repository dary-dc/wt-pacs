# A device model: what a phone's class predicts, and the prediction for the 2026-11-21 round

*Queue row DEVICE-THEORY, 2026-11-20 (`claude/work-ledger:docs/queue-client-2026-11-14.md`, amendment 25). Theory and
sources; nothing run, on a device or in the cloud. §2 is the pre-registered prediction for the round of
`claude/phone-run:docs/phone-rows/next-round.md`, pushed before any of its cells ran; it is not edited after
2026-11-21 12:00 UTC. Every choice stays the owner's.*

Labels: **(S)** a source quoted verbatim, listed in §8 with its URL, section and revision; **(R)** a result of this
repository, by its file; **(D)** derived here, the arithmetic written out; **(T)** theory, not measured; **(A)** an
assumption, named so that a measurement can replace it. Fixtures and limits: §9.

## 1. What it shows

* **One phone's result carries to another only through three numbers the phone's maker publishes or a page can
  read**: how fast its fast cores are, how many of them there are, and what its storage and decoders promise. The
  model (§3) is those three and nothing else. It gives a range per device class (§4), wide where the sources are thin.
* **The premise it questions: that HTJ2K's decode on a phone is the phone's AV1 decode divided by the cloud's
  ratio.** The round's protocol predicts HTJ2K at 76–107 ms a `dbts_b1` frame that way (`next-round.md` cell 1). The
  ratio is not a constant of the two codecs. dav1d's time is spent in hand-written kernels whose width differs
  between the cloud's x86 and a phone's Arm, and on the phone three decoders share the cores; OpenJPH-WASM is one
  thread of 128-bit WASM SIMD on both. Scaling each codec by the cores it actually uses gives HTJ2K at **43–66 ms a
  frame with three decoders, 14–22 ms effective** (§2, D on A), about half the protocol's figure.
* **If that holds, three things follow** (D, §5). Arm B on a fast link is bound by the wire, not the decode. The
  goodput above which the exact series alone fills faster than the view is ~380 Mbit/s on this phone and *lower* on a
  slower phone (86–420 Mbit/s), because the view's decode slows faster than HTJ2K's. And the cell-2 rule, pooled over
  two series, is predicted *no difference shown*: B faster on `dbts_b1`, near a tie on `dbts_a1`.
* **Where a class's range cannot be had from sources** it says so: a GPU's compute throughput (no vendor publishes
  one), an iPhone's cores (no entry read), the fast core of the round's own chip in the benchmark used (not found).
* **More phones without owning them** (§7): two device clouds with prices read, and two routes that cost nothing.

## 2. The prediction for the round's phone (pre-registered 2026-11-20)

The phone as the repository already names it: a Galaxy S23 on Android 16 with Chrome 157
(`claude/phone-run:docs/phone-rows/README.md`), its SoC "the brand-new Snapdragon® 8 Gen 2 Mobile Platform for Galaxy"
(R, `claude/mobile-decode:docs/decode/mobile/av1-chips.md` S7). Qualcomm's brief for that platform (S1): "1 Prime
core, up to 3.36 GHz", "4 Performance cores, up to 2.8 GHz", "3 Efficiency cores, up to 2.0 GHz"; "Storage: UFS 4.0";
"8K Video Playback @ 60 FPS".

Only cells 1–4 run (`claude/phone-run:docs/phone-rows/SATURDAY.md`: cell 5, the report cells and M1–M22 do not). A
prediction is **missed** when the measured median falls outside its band; the read (PHONE-READ) says held or missed
for each line, and where.

### Cell 1 · decode per frame (`dbts_b1`, 50 frames, in memory)

| arm | decoders | a frame, per decoder | effective a frame | basis |
| --- | ---: | --- | --- | --- |
| HTJ2K (OpenJPH-WASM) | 1 | 37–59 ms | 37–59 ms | §3.1, the prime core (D on A) |
| | 2 | 41–64 ms | 20–32 ms | prime + one performance core |
| | 3 | **43–66 ms** | **14–22 ms** | prime + two performance cores |
| | 4 | 43–67 ms | 11–17 ms | prime + three performance cores |
| the view (WebCodecs, software) | 1 | 85–125 ms | 85–125 ms | §3.2 (T) |
| | 2 | 104–136 ms | 52–68 ms | |
| | 3 | 125–145 ms | 42–48 ms | the 11-11 run again: 133–135 ms (R) |
| | 4 | 140–175 ms | 35–44 ms | |

* `navigator.hardwareConcurrency` reads **8** (D from S1: 1 + 4 + 3).
* **HTJ2K has no saturation point within four decoders** by the cell's rule: each added decoder shortens the
  effective time by more than 10 % (2 → 3 by 29–33 %, 3 → 4 by 22–25 %, D). M12, if ever run: gains to five decoders,
  under 10 % a decoder from the sixth (the efficiency cores).
* **The view's fourth decoder gains 3–20 %** over three: its saturation point is 3 or none within four. Past four
  nothing is gained (§3.2).
* **The ratio the protocol carries does not hold**: the view's time a frame over HTJ2K's, three decoders each, is
  **2.0–3.1** on the phone (D: 133 ÷ 66, 135 ÷ 43), against the cloud's 1.06–1.74 (R).
* **Drift**: the end's 1- and 3-decoder arms within 15 % of the start's (T: loads of ~15 s with 15 s gaps, on a
  charger; the least certain line here).
* **This model is refuted, and the protocol's ratio carry kept, if** HTJ2K's effective time at three decoders is
  over 26 ms (the protocol's band starts there).

### Cell 2 · the delivery arms (home Wi-Fi, three decoders)

The wire is the series' bits over the link's goodput *G* (`link-profiles.md`: ≥ 600 Mbit/s measured, a lower bound).
`dbts_b1` exact is 859.3 Mbit, `dbts_a1` exact 542.5 Mbit (D: 107 410 134 B and 67 815 186 B × 8, R).

| | `dbts_b1-q8-g8` | `dbts_a1-q8-g8-cut` |
| --- | --- | --- |
| A, fill | 2.4–3.3 s, decode-bound (R, 11-11) | 0.8–1.3 s, decode-bound (T: 56 frames at 0.24 of `dbts_b1`'s samples, more bits a sample) |
| B, decode floor | 0.7–1.1 s (D: 50 × 14–22 ms) | 0.24–0.46 s (D: 56 × 12.7–24.4 ms ÷ 3) |
| B, wire at 600 Mbit/s | 1.43 s | 0.90 s |
| B, regime | **wire-bound** (the protocol: decode ≈ wire) | **wire-bound** |
| B, fill | 1.6–2.0 s | 1.1–1.4 s |
| B ÷ A within a round | **0.55–0.80**, all 8 below 1 | **0.9–1.4**, on both sides of 1 |

* **The rule's outcome, pooled over 16 ratios: *no difference shown*** (fewer than 13 below 1), where the protocol
  predicts *B faster*. Per series, deciding nothing: `dbts_b1` 8 of 8 below 1.
* This depends on *G*. B's fill is 859.3 ÷ *G* (or 542.5 ÷ *G*) s plus the rest while the wire binds. Were the link
  to give 900 Mbit/s or more, `dbts_a1`'s wire falls to 0.6 s and *B faster* passes. The read reports *G* beside it.
* C2 against A + B: *no difference shown*, as the protocol. C1's exact-frame latency: **80–130 ms** on `dbts_b1` (D:
  the ask's ~40 ms, R, plus one HTJ2K frame on an idle prime core, 37–59 ms, plus the paint).

### Cells 3 and 4, and the shell reads

* Cell 3: this model adds nothing to the protocol's predictions. Both views decode in the same workers.
* Cell 4 and the codec list: **a hardware AV1 decoder is listed** (A: Qualcomm's brief names no codec for its
  playback line; the release that does could not be read by this session, §8). Whether it takes 2560 × 3328 is not
  predicted: "8K Video Playback @ 60 FPS" is not per codec (R, `av1-chips.md`). `hardware.md` §17's predictions stand.

## 3. The model

A frame's decode is work divided by speed. Work is a property of the codec and the frame, measured once on a
reference host. Speed is a property of the core. What differs between the codecs is how many cores one decoder uses.

**The reference** (R, `docs/client/evidence/decode-speed-of-the-optimal-quality-picture.md`): on "4-core cloud hosts
at 2.1–2.8 GHz", the product's HTJ2K unit (decode, pack, XXH3, compare) takes 57.1 ms a `dbts_b1` frame, 19.8 ms a
`dbts_a1` frame, 20.1 ms a `dbts_c1` frame, one thread.

**A core's speed** is taken from one published single-thread rating that runs "almost identical" code on PCs and
phones (S5). The reference hosts' model was not recorded (A); server Xeons of 2.0–2.8 GHz read 1926–2469 there
(S5, eight parts), so the reference rating is **R0 = 1926–2469**. A core rated *r* runs the reference's work in
`reference ms × R0 ÷ r`.

### 3.1 HTJ2K in WASM: one thread, one core a decoder

OpenJPH-WASM is built with one thread (R, `htj2k-software.md` §2), so *n* decoders use the *n* fastest cores the
scheduler gives them (A: a foreground tab's busy threads are placed on the fastest idle cores). With per-frame times
*t₁ ≤ t₂ ≤ …* on those cores, the effective time a frame is `1 ÷ (1/t₁ + … + 1/tₙ)`.

The round's phone (A, each replaced by cell 1): the prime core rated 2400–3000, a performance core 2000–2400, an
efficiency core 800–1100. No entry for the chip was found in S5. The brackets come from its neighbours there: chips
whose fastest core is a mid-range one read 1989–2381; Arm's page says the performance core's design "delivers the
same performance as Cortex-X1 (the first-generation Cortex-X class of CPU)" (S3); the entry chips' fast cores read
988–1100, and Arm's efficiency core is "Up to 35% performance uplift on previous generation high-efficiency CPU
(Cortex-A55)" (S3).

```
prime        57.1 × 1926 ÷ 3000 = 36.7 ms … 57.1 × 2469 ÷ 2400 = 58.7 ms      (D on A)
performance  57.1 × 1926 ÷ 2400 = 45.8 ms … 57.1 × 2469 ÷ 2000 = 70.5 ms
efficiency   57.1 × 1926 ÷ 1100 = 100 ms  … 57.1 × 2469 ÷ 800  = 176 ms
effective, low end:   1 → 36.7   2 → 20.4   3 → 14.1   4 → 10.8 ms
effective, high end:  1 → 58.7   2 → 32.0   3 → 22.0   4 → 16.8 ms
a frame per decoder at 3: 3 × 14.1 = 42 ms … 3 × 22.0 = 66 ms
```

Not in it (T): memory traffic (a frame is 17 MB out in ~50 ms, far under a phone's memory rate), heat, and a WASM
compiler's Arm code against its x86 code.

### 3.2 AV1 in software: many threads a decoder, kernels as wide as the CPU

Chromium gives each software AV1 decoder min(15, cores) threads at this frame height and, with `optimizeForLatency`,
one frame in flight (R, `claude/mobile-decode:docs/decode/mobile/av1-software.md` §2, sources quoted there). So three
decoders are 24 threads on 8 cores: they share the phone, and a decoder alone is faster than one of three.

The cloud bounds what threads can give one frame (R, Protocol C, `dbts_b1` Q 8): the view over the HTJ2K unit is 1.58
with one core and 1.06 with four at the same throttle, so four cores speed one frame up by 1.58 ÷ 1.06 = **1.5×** at
most (D), and one core's whole work is 1.58 × 57.1 = 90 ms (D).

On the phone the same frame took 133–135 ms as one of three decoders (R). With five fast cores for three decoders
each has under two, a speed-up of ~1.3 (T), so one phone core's whole work is ~135 × 1.3 = 175 ms: **1.9× the
cloud's 90 ms**, on cores this model rates near the cloud's for HTJ2K. The gap is the premise in §1: dav1d's kernels
are written per instruction set (R, `av1-software.md`: Chromium builds `arm64_asm_sources`; the cloud's are x86's
wider ones, T), and 24 threads on 8 cores contend. The factor is fitted to the one phone number, not predicted.

```
1 decoder:  175 ÷ 1.5 (threads) ÷ 1.1 (the prime core, A) = 106 ms          band 85–125
2 decoders: 175 ÷ 1.4 = 125 ms a frame, 62 ms effective                      band 52–68 effective
3 decoders: 133–135 ms (R), 45 ms effective                                  band 42–48
4 decoders: 175 ÷ 1.12 = 156 ms a frame, 39 ms effective                     band 35–44
ceiling:    26 frames a second × 175 ms = 4.5 fast cores of the phone's 5    (D): no gain past four
```

### 3.3 The other quantities

* **A hardware decoder.** Whether one exists and what size it takes is the vendor's choice (R, `av1-chips.md`). The
  platform's floor is small: of media performance class V, "[5.1/H-1-14] MUST support AV1 hardware decoder Main 10,
  Level 4.1" and "AV1 codecs are only required to support 1080p resolution" (S2, §2.2.7.1). A page learns it only by
  configuring a decoder. Its output reaches the XXH3 check at 8 bits only (R, `README.md` there).
* **The cache.** A frame of *F* bytes written at the decode's rate asks `F ÷ effective decode` of the store, and a cold
  read under the decode's time asks the same of the flash. Android's floors (S2): every handheld "[8.2/H-0-1] MUST
  ensure a sequential write performance of at least 5 MB/s" and "[8.2/H-0-3] … sequential read … at least 15 MB/s";
  class V "[8.2/H-1-1] … sequential write … at least 150 MB/s" and "[8.2/H-1-3] … sequential read … at least 250
  MB/s" (§2.2.7.4). A flagship part: "a sequential read speed of 4,200 megabytes per second (MB/s) and a sequential
  write speed of 2,800 MB/s" (S4, UFS 4.0, the part alone, no file system or encryption).
* **Memory.** A decoded `dbts_b1` series is 50 × 2560 × 3328 × 2 B = 852 MB, `dbts_a1` 228 MB (D). Class V: "[7.6.1/H-2-1]
  MUST have at least 8 GB of physical memory" (S2). Below it no floor was read here.
* **HTJ2K in WebGPU compute.** Reach is sourced (R, `gpu-compute-decode.md`: Chrome on Android 12+ with ARM and
  Qualcomm GPUs). One frame fits a binding: "maxStorageBufferBindingSize … 134217728 bytes (128 MiB)" (S6). Its time
  has no source: no GPU vendor read publishes a compute throughput, and a code block is decoded serially by one GPU
  thread, far slower than a CPU core's. **Unknown on every class**; only M20 on a device gives it.

## 4. A range per device class

Classes are price bands, because that is how a published distribution counts phones (S7, shipments of 2025): "The
sub-$200 segment is projected to fall from 40.6% of total shipments in 2025 to 25.6% in 2027"; "the premium $800+
segment is expected to increase from 21.1% to 28.4% share". The middle is the rest, 38.3 % (D). Which chips sit in
which band is (A). Shipments are not the phones in use, and not the phones readers use.

| | entry, under $200 | middle, $200–799 | premium, $800 and over |
| --- | --- | --- | --- |
| share of 2025 shipments (S7; D) | 40.6 % | 38.3 % | 21.1 % |
| fast core's rating (S5) | 988–1100 (three chips) | 1504–2381 (six chips) | ≥ 2400 (A; none read) |
| fast cores (A) | 2 or 4 | 2 or 4 | 5 or more |
| HTJ2K, a `dbts_b1` frame on a fast core (D) | 100–143 ms | 46–94 ms | 37–59 ms |
| HTJ2K effective, three decoders (D) | 33–61 ms | 15–40 ms | 14–23 ms |
| the view effective, three decoders (T) | 90–200 ms | 41–132 ms | 25–48 ms |
| write rate a `dbts_b1` fill asks (D) | 85–190 MB/s | 129–415 MB/s | 355–680 MB/s |
| storage the platform promises (S2) | 5 MB/s write, 15 read | the same, or class V's | class V's 150 write, 250 read |
| hardware AV1 at `dbts_b1`'s size | not promised (S2) | not promised | not promised; the vendor's |
| WebGPU decode | unknown | unknown | unknown |

How each row is derived:

* HTJ2K on a fast core: `57.1 × R0 ÷ r` at both ends of both ranges. Effective at three decoders divides by the three
  fastest cores' speeds summed: 3 with four fast cores, 2.35 with two (the third decoder on a slow core at 0.35 of a
  fast one, A), 2.6 for a prime and two performance cores.
* The view: the round's phone's 45 ms × (2200 ÷ *r*), doubled at the slow end where only two cores are fast (T: the
  third decoder's serial part lands on a slow core). The widest row, and the one cell 1 cannot test on other phones.
* The write rate: 17.04 MB ÷ the view's effective time.
* **iPhones are not in the table**: no rating was read for their chips, and Safari's route differs (the view through
  dav1d-WASM where WebCodecs refuses 10 bits, R). A device session there starts from cell 1.

## 5. What the ranges do to the decisions (derived; nothing decided here)

* **The crossover goodput** (`link-profiles.md`: a frame's bits ÷ its effective decode). The exact series, 17.19 Mbit
  a `dbts_b1` frame: 280–520 Mbit/s on an entry phone, 430–1150 in the middle, 750–1230 at the top. Below it the wire
  binds, so an HTJ2K-only fill is wire-bound on nearly every link a phone has. The view, 3.71 Mbit a frame: 19–41,
  28–90 and 77–148 Mbit/s.
* **Where arm B overtakes arm A**: when 859.3 ÷ *G* is under 50 × the view's effective time. *G* over ~380 Mbit/s on
  the round's phone, 130–420 in the middle band, 86–191 on an entry phone. **The slower the phone, the lower the
  goodput at which the exact series alone is the faster fill**, so a single route for all phones is the wrong shape of
  answer if cell 1 holds this model (ROUTE-POLICY's question).
* **The cache**: a phone at the platform's floor cannot take a fill's write rate at any class; a class-V phone at its
  floor (150 MB/s) cannot either; a UFS 4.0 part can with ×4–8 to spare. The cold read under the decode's time is
  the same comparison against 15, 250 and 4,200 MB/s.
* **Memory**: one `dbts_b1` series decoded is a tenth of a class-V phone's 8 GB and most of what a 3–4 GB phone has
  free (ASK-MODEL's bound).

## 6. What the round can and cannot test of this

Cell 1 replaces the round's phone's three core ratings with measurements and tests §3.1's shape (the effective time
against the decoder count) and §3.2's four bands. It tests nothing about another class: §4 stays derived until a
second phone runs cell 1. The measurement that would shrink §4 most is **cell 1 alone on one middle-band phone with
two fast cores**: it fixes the slow core's share and the view's doubling, the two widest assumptions.

## 7. Routes to more devices (options for the owner; nothing signed up for)

Cell 1 needs no WebTransport and no server of ours beyond static HTTPS (the frames are fetched, then decoded in
memory), so it is the cell that travels. The fixtures are public (CC BY, `docs/FIXTURES.md`); a run sends outside the
page's address, the fixtures and the timings, and no patient data.

| route | what it can run | cost (S) | what it sends outside | limits |
| --- | --- | --- | --- | --- |
| AWS Device Farm | "automated tests and remote access sessions" on real phones (S8) | "one-time free trial of 1,000 device minutes"; "$0.17 per device minute"; "$250.00 per device slot per month" unmetered. Cell 1 on 20 phones at 15 min: $51 (D) | the page's address and the fixtures to the provider's phones; an account | racked phones: heat, the Chrome version and UDP reach are the provider's, not read here |
| Firebase Test Lab | Android app tests on physical devices (S9) | "30 minutes of test time per day on physical devices" free; "$5 per hour for each physical device" | the same, plus a wrapper app that opens the page (not built) | built for apps, not pages |
| other device clouds (BrowserStack, Sauce Labs, Samsung's Remote Test Lab) | named only | not read | | |
| a public bench page, opened by colleagues on their own phones | cell 1, one press | none | the phone's model string and timings to a collector of ours | uncontrolled state; needs a host and a consent line |
| the product's own load report | a frame's decode per load, every device that uses the product | none | what `report-plan.md` already lists | telemetry is off (rate 0); the owner's |

## 8. Sources

Fetched 2026-11-20 unless said.

* **S1** Qualcomm, *Snapdragon 8 Gen 2 Mobile Platform* product brief, "©2022 Qualcomm Technologies, Inc.", PDF
  modified 2024-11-19, part numbers "SM8550-AB, SM8550-AC",
  `https://www.qualcomm.com/content/dam/qcomm-martech/dm-assets/documents/Snapdragon-8-Gen-2-Product-Brief.pdf`, page 2
  (*Kryo CPU*, *Memory*, *Video*). Its footnote 2: "Snapdragon 8 Gen 2 Mobile Platform also available in 3.19 GHz CPU
  version (SM8550-AB). Maximum CPU speed will vary based on platform version." Page 1: "Kryo CPU improves performance
  up to 35%".
* **S2** Android 16 Compatibility Definition, `https://source.android.com/docs/compatibility/16/android-16-cdd`,
  §2.2.4 ([8.2/H-0-*]), §2.2.7.1 ([5.1/H-1-14], [5.1/H-1-22]), §2.2.7.3 ([7.6.1/H-2-1]), §2.2.7.4 ([8.2/H-1-*]). Class
  V is `android.os.Build.VERSION_CODES.V` returned for `MEDIA_PERFORMANCE_CLASS`.
* **S3** Arm, product pages *Cortex-A715* and *Cortex-A510*,
  `https://www.arm.com/products/silicon-ip-cpu/cortex-a/cortex-a715` and `…/cortex-a/cortex-a510`, *Features and
  benefits*; undated pages. Which Arm designs the phone's cores are is not in S1 (A).
* **S4** Samsung Semiconductor Newsroom, "Samsung Develops First UFS 4.0 Storage Solution Compliant with New Industry
  Standard", 2022.05.04,
  `https://news.samsungsemiconductor.com/global/samsung-develops-first-ufs-4-0-storage-solution-compliant-with-new-industry-standard/`.
* **S5** PassMark, CPU pages "As of 20th of November 2026", `https://www.cpubenchmark.net/cpu.php?cpu=<name>`, the line
  *Single Thread Rating*; the method, `https://www.cpubenchmark.net/cross-platform.html`: "These tests were chosen as
  the code used to perform the tasks is almost identical between the PC and mobile versions of PerformanceTest." Read: Unisoc T606 988; SM6225
  1085; MT6769 1100; MT6789 1504; SM6375 1880; Samsung s5e8835 1989; SM7325 2071; Samsung s5e8845 2366; Google Tensor
  G3 2381. Xeon Gold 6330 1926; Platinum 8173M 2058, 8160 2066, 8168 2078, 8280 2196, 8273CL 2200, 8358 2382, 8481C
  2469. A user-submitted average, a few samples for some parts; a benchmark's code is not a decoder's. No entry was
  found for SM8550.
* **S6** W3C, *WebGPU*, Candidate Recommendation Draft, 16 November 2026, `https://www.w3.org/TR/webgpu/`, §*Limits*.
* **S7** Omdia, "Global smartphone market to contract 12% in 2026 as price mix shifts toward higher price bands",
  September 15, 2026,
  `https://omdia.tech.informa.com/blogs/2026/sep/global-smartphone-market-to-contract-12percent-in-2026-as-price-mix-shifts-toward-higher-price-bands`.
* **S8** AWS Device Farm pricing, `https://aws.amazon.com/device-farm/pricing/`, undated page.
* **S9** Firebase Test Lab, *Usage levels, quotas, and pricing*, "Last updated 2026-11-18 UTC",
  `https://firebase.google.com/docs/test-lab/usage-quotas-pricing`.

**Not read:** Qualcomm's release for the platform (`qualcomm.com/news/releases/2022/11/…`, a page that renders only
with scripts), so no codec is quoted for the phone's hardware decoder; Geekbench's and Counterpoint's pages (refused,
HTTP 403); Arm's Cortex-X3 page carries no performance figure in its text.

## 9. Fixtures and limits

No measurement of this row. Behind every (R): three timed DBT volumes of one dataset (`dbts_a1`, `dbts_b1`,
`dbts_c1`); 4-core cloud hosts without a GPU, headless Chromium, software decode, their CPU model not recorded; one
Android 16 phone (Chrome 157) on one home link on one evening, three AV1 decoders, 12 loads a cell. Behind the
model: one published benchmark's single-thread rating standing for a decoder's speed; nine phone chips and eight
server parts read; a price-band distribution of shipments standing for a population of readers' phones. Every (A)
above is a place where the model is a guess until cell 1 or a second phone replaces it.
