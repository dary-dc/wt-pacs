# Link profiles: what a reader's phone has, and what binds a fill on each

*2026-11-14, queue row LINK-TARGETS. Theory and sources only: nothing was run. One row is measured (the home Wi-Fi
fit); every other number is someone else's measurement, a standard's **target**, or arithmetic on those, marked (D).
This file builds on [`link-conditions.md`](link-conditions.md) (2026-10-13), whose summaries of the Ookla tiles and
M-Lab's NDT are reused here, not recomputed.*

**The question.** What links does a reader on a phone actually have, and where on them does a fill bind: on the wire,
on the decode, or on the round trip?

**The answer, short.**

* **The optimal-quality view (arm A, C1's fill) is decode-bound on the phone above ~83 Mbit/s of goodput and
  wire-bound below** (D). That puts the median home Wi-Fi, 5G and mmWave on the decode side, LTE and one stream to a
  far server on the wire side, and public and enterprise Wi-Fi near the line.
* **HTJ2K (arm B, C2's second half) is wire-bound on every profile but mmWave and the measured home Wi-Fi**, if its
  phone decode keeps the cloud's ratio to the view's, which is **unmeasured** (D: a crossover of ~470–660 Mbit/s).
* **An exact frame on request (C1) is bound by round trips**: 2.15 MB after a silence is 5–8 round trips of slow
  start plus one for the ask, 0.04–0.53 s across the profiles (D), and during a fill it waits behind ~6 MiB ahead of
  it (0.08–2.8 s, D, [`link-conditions.md`](link-conditions.md) item 9).
* **A study's length changes how much is fetched, held and cached, not the regime.**
* What is unknown and decides most: the phone's HTJ2K decode per frame, the loss a radio leaves to the transport, the
  buffer depth (loaded RTT) per profile, and any measurement at all of hospital Wi-Fi.

---

## 1 · The profiles, from sources

Every quotation is verbatim; *read* gives the date this repository read it. Rates are downlink; p10 · p50 · p90 unless
marked. "(M)" is a summary computed here from an open dataset, with its script, in
[`link-conditions.md`](link-conditions.md) §Link profiles (Ookla tiles 2026 Q3, test-weighted percentiles of tile
means, multi-connection to a near server: they read capacity, not one session to a far server).

### Home Wi-Fi

| quantity | value | source · method · region · date |
| --- | --- | --- |
| goodput | 40 · 218 · 468 Mbit/s (world), 135 · 387 · 618 (US) | Ookla tiles "fixed" (a phone on Wi-Fi or Ethernet), (M) · world, US · 2026 Q3 |
| idle RTT | 5 · 10 · 26 ms (world) | the same |
| RTT under load | 116 · 251 · 526 ms (world, download phase) | the same; Ookla's saturating test, a worst case for one flow |
| Wi-Fi as the bottleneck | "home wireless connectivity is still a performance bottleneck in many homes, particularly for users whose ISP access speeds exceed 100 Mbps; for those whose speeds exceed 800 Mbps, the wireless network is the bottleneck 100% of the time." | Sharma et al., arXiv 2311.05499v2 §1, <https://arxiv.org/pdf/2311.05499v2> · joint wired and Wi-Fi tests in ~50 homes · Chicago · Sep 2021 – Jun 2023 · read 2026-11-14 |
| loss | no distribution published for a phone on Wi-Fi | — |

**Measured here, once:** *home Wi-Fi, server wired* — base RTT ~2 ms (1.8–2.5), bottleneck ≥ ~600 Mbit/s (a lower
bound including the phone's receive path), a tail-drop queue that loses at 22 / 40 / 96 ms (p10 / p50 / p90), no
random loss (89 of 89 congestion events congestive). One phone, one access point, one evening, one series
(`dbts_b1-q8-g8`), the servers' rows only (`claude/link-calibration:docs/transport/transport-conclusions.md` §1 *A home
Wi-Fi link, measured*, 2026-11-12). **It is wireless at the phone, and a best case of the target**: the server sat on
the same router, a hop no cloud PACS has.

### Hospital or enterprise Wi-Fi

| quantity | value | source · method · region · date |
| --- | --- | --- |
| Wi-Fi hop latency | p50 ~3 ms, p90 ~20, p99 ~250 | Sui et al., MobiSys 2016 §3.1, as read 2026-10-13 ([`link-conditions.md`](link-conditions.md); the host timed out on 2026-11-14) · one campus, 47 k devices · China |
| goodput, loss | **no independent measurement found**; vendor case studies only, without distributions | [`link-conditions.md`](link-conditions.md) |
| the site's uplink | **no measurement found**; recommended ≥ 100 Mbit/s for a hospital with PACS | FCC OBI Technical Paper No. 5, 2010, as read 2026-10-13 |

The profile is **assumed** in full. Its one sourced trait is a long-tailed hop latency on a managed, shared network.

### Public Wi-Fi

| quantity | value | source · method · region · date |
| --- | --- | --- |
| goodput | "Mobile providers had a faster median download speed than Wi-Fi in most airports and more than twice as fast on average (219.24 Mbps, 101.39 Mbps)." | Ookla, *Cellular faster than Wi-Fi in US airports*, <https://www.ookla.com/articles/cellular-faster-than-wi-fi-in-us-airports>, published 2025-12-15, read 2026-11-14 · Speedtest user tests, "median download speed across the airport Wi-Fi (based on SSID …) … in the first half of 2025" · the 50 busiest US airports |
| the fastest of them | "a median download speed of 364.74 Mbps (also remarkable were the median upload speed of 426.04 Mbps and an 8 ms multi-server latency)", on Wi-Fi 6E | the same |
| RTT, loss, load | not published | — |

101 Mbit/s is an average of per-airport medians, not a distribution; airports are one kind of public Wi-Fi.

### 4G / LTE

| quantity | value | source · method · region · date |
| --- | --- | --- |
| goodput, all cellular generations | 18 · 103 · 309 Mbit/s (world), 29 · 212 · 625 (US) | Ookla tiles "mobile", (M) · 2026 Q3 · not LTE alone |
| one TCP stream, any access | country medians 27–85 Mbit/s, lower quartile 7–26 | M-Lab NDT, (M) · Jan–Mar 2024 |
| RTT, idle | "minimum, average and maximum RTT using LTE network are 27, 38, 51 ms, respectively. We observe that 90% of the average ping test measurements towards www.google.fi using LTE have a RTT time less than 100 ms." | Walelgne et al., IFIP Networking 2018 §IV-C, <https://acris.aalto.fi/ws/portalfiles/portal/21240189/ELEC_Walelgne_et_al_Factors_Affecting_IFIP_conf.pdf> · ping from subscribers' phones · one Finnish operator · Oct 2016 · read 2026-11-14 |
| loss | "Only 2.4% of them lost at least a single packet." (of LTE ping tests) | the same |
| RTT under load | 405 · 825 · 1 879 ms (world, all cellular); "4G RTT inflates drastically because of its deep in-network buffers" | Ookla tiles (M); Narayanan et al., WWW 2020 §4, <https://arxiv.org/pdf/1909.07532> · bulk TCP · Minneapolis, Chicago · 2019 · read 2026-11-14 |
| handovers | interruption 24–29 ms on average, sometimes > 100 ms; ~40 ms median over four networks | Gimenez et al., VTC 2016; Lauridsen et al., IEEE Commun. Mag. 2017, as read 2026-10-13 · drive tests · Denmark |

### 5G sub-6 GHz

| quantity | value | source · method · region · date |
| --- | --- | --- |
| goodput | **no independent distribution read for sub-6 alone.** PHY averages of 557–771 Mbit/s in a good channel, halved by a second active user (595 → 284) | Fezeu et al., SIGCOMM 2024, as read 2026-10-13 (the authors' host failed TLS verification on 2026-11-14) · PHY logs · EU and US operators |
| **target**, user experienced rate | "User experienced data rate is the 5% point of the cumulative distribution function (CDF) of the user throughput." "Downlink user experienced data rate is 100 Mbit/s." (Dense Urban – eMBB) | ITU-R M.2410-0 (11/2017) §4.3, <https://www.itu.int/dms_pub/itu-r/opb/rep/R-REP-M.2410-2017-PDF-E.pdf> · read 2026-11-14 · **a target**, a minimum requirement for IMT-2020 candidates |
| **target**, latency | "4 ms for eMBB" user plane, defined as "the one-way time … in unloaded conditions" | the same §4.7.1 |
| **target**, handover | "The minimum requirement for mobility interruption time is 0 ms." | the same §4.12 |
| loss, loaded RTT | not read for sub-6 | — |

The national regulators' 5G medians (Ofcom's *Mobile Matters*) were 403 to a scripted fetch, as in October, and are
not used; the ITU numbers are what a system must meet in a test environment, not what a phone sees.

### 5G mmWave

| quantity | value | source · method · region · date |
| --- | --- | --- |
| goodput | "the median 5G and 4G throughputs are 1467 and 167 Mbps, respectively. However, 5G throughput exhibits much higher variations than 4G despite the presence of LoS." | Narayanan et al., WWW 2020 §4, <https://arxiv.org/pdf/1909.07532> · 8 parallel TCP connections, stationary, line of sight · Minneapolis, Chicago · 2019 · read 2026-11-14 |
| RTT | the radio part "is around 28 ms for both 4G and 5G, accounting for around 50% of the end-to-end RTT" (to an east-coast server) | the same |
| loss | "low packet loss rates, with the 50%, 75%, and 99% percentiles being 0.01%, 0.1%, and 1.2%, respectively." | the same |
| RTT under load | "Bufferbloat in 5G is much less severe, likely due to the fast 5G speed that drains the buffer much faster than 4G." | the same |
| handovers | "Even under low mobility (e.g., walking), a smartphone may experience 30+ 4G/5G handoffs in less than 8 minutes." | the same §1 |

One operator's 2019 launch network, outdoors, line of sight: the best case of the best profile.

### What the profiles share, and what none of them gives

* **A median is of whom:** Ookla's are of user-initiated tests (people test new or failing links) to a near server;
  NDT's of one stream to an off-net server, the closer model of one session to a cloud PACS; the papers' of their own
  phones at their own sites. None is of a reader in a hospital.
* **Loss reaching the transport is low and rarely published**: the radio's link layer retransmits, so most loss
  surfaces as delay ([`link-conditions.md`](link-conditions.md) §What it means). Random against congestive is split
  only in the measured home row (all congestive).
* **Jitter** is published by no source above as a distribution; loaded RTT stands in for it.

---

## 2 · The regime per profile, derived

### The rule

A fill is bound by max(wire, decode) per frame. With *b* the bits a frame and *d* the effective decode time a frame
(the per-decoder time ÷ the decoders), the wire binds below the **crossover goodput** *b* ÷ *d* and the decode above
it. A series of *N* frames scales both sides by *N*, so the crossover does not depend on its length (D).

| stream | bytes a frame | *d* on the phone | crossover |
| --- | --- | --- | --- |
| the view, `dbts_b1` Q 8 G 8 | 464 KB (23.2 MB ÷ 50; [`../av1/payload-format.md`](../av1/payload-format.md) §Bytes: 0.2161 × 107 410 134 B) | ~45 ms (133–135 ms over three decoders, WebCodecs, software; [`../client/design.md`](../client/design.md) §Open *What bounds a fill on the phone*) | **~83 Mbit/s** (D) |
| the exact series, `dbts_b1` HTJ2K | 2.15 MB (107 410 134 B ÷ 50) | **unmeasured.** If the cloud's ratio holds (the view decodes in 1.24–1.74 HTJ2K frames, containers, 1×), 26–36 ms | **~470–660 Mbit/s** (D, on an unmeasured assumption) |

### Goodput is not nominal bandwidth

The tables above are mostly capacity (several connections to a near server). One session's goodput under
`cubic-restart` is lower by three effects:

* **Slow start, again after every silence.** QUIC "begins every connection in slow start with the congestion window
  set to an initial value. Endpoints SHOULD use an initial congestion window of ten times the maximum datagram size"
  (RFC 9002 §7.2, <https://www.rfc-editor.org/rfc/rfc9002.txt>, read 2026-11-14); quinn's is 12 000 B. `cubic-restart`
  re-enters slow start after a silence ([`transport-conclusions.md`](transport-conclusions.md) §3 *After a blink*),
  which RFC 9002 §7.8 allows: "A sender MAY implement alternative mechanisms to update its congestion window after
  periods of underutilization, such as those proposed for TCP in [RFC7661]." Reaching a BDP *B* takes
  log₂(*B* ÷ 12 000) round trips: 5 to 8 on the profiles above (D).
* **Loss, through Cubic's response.** RFC 9438 §5 (<https://www.rfc-editor.org/rfc/rfc9438.txt>, read 2026-11-14):
  "With a deterministic loss model where the number of packets between two successive packet losses is always _1/p_,
  CUBIC always operates with the concave window profile"; its average window, drawn there as a figure and transcribed
  here, is 1.054 × RTT^¾ ÷ *p*^¾ segments with *C* = 0.4 and β = 0.7 (§5, Figure 7 and §5.1), and in the Reno-friendly region CUBIC "achieves at least the same throughput as
  Reno" (§4.2), whose average window is √(1.5 ÷ *p*) by §4.3's Figure 3 with α = 1, β = 0.5. Taking the larger, one
  session of 1 200 B datagrams is bounded at (D):

  | loss *p* | RTT 10 ms | 30 ms | 60 ms | 100 ms |
  | --- | --- | --- | --- | --- |
  | 0.01 % | 118 Mbit/s | 39 | 20 | 18 |
  | 0.1 % | 37 | 12 | 6.2 | 3.7 |
  | 1 % | 12 | 3.9 | 2.0 | 1.2 |

  The bound is steady state; a fill is short against it. The view's 23.2 MB is ~19 300 datagrams, so at 0.01 % it
  meets ~2 losses and at 0.1 % ~19 (D): at the mmWave median loss a fill sees its first loss in slow start, then
  grows by Cubic's curve, and at LTE's 2.4 %-of-pings-lose-one it spends most of its life loss-bound. Random loss
  that the radio does not hide caps one Cubic session far below the profiles' capacities — the case where BBR filled
  in 0.04–0.76 of `cubic-restart`'s time ([`transport-conclusions.md`](transport-conclusions.md) §1, *Under 1–5 %
  loss*). How much random loss reaches the transport on each radio is the open fact (§1 *The deciding fact* there).
* **The queue.** A fill that fills a deep buffer runs at the bottleneck's rate but every round trip stretches to the
  loaded RTT, which is what an ask during it pays (below).

### Per profile and arm

Fill times for the 50-frame series (D): A = max(185.7 Mbit ÷ *G*, 2.25 s); B = max(859 Mbit ÷ *G*, 1.3–1.8 s, the
latter unmeasured); C2's wire alone is 1 045 Mbit ÷ *G*, measured, not summed.

| profile | goodput *G* a session might see | A (the view) | B (HTJ2K) | C1, the exact frame on request | unknown that decides |
| --- | --- | --- | --- | --- | --- |
| home Wi-Fi, measured | ≥ 600 Mbit/s, 2 ms | decode: 2.25 s, wire 0.31 (the run measured the wire at 0.5–1.0 s of a 2.4–3.3 s fill) | both near: wire 1.43 s, decode 1.3–1.8 unmeasured | ~0.04 s after a silence, + one HTJ2K decode | the phone's HTJ2K decode |
| home Wi-Fi, median | ~218 (p10 40) | decode at the median (2.25 s); wire at p10 (4.6 s) | wire: 3.9 s at the median | ~0.13 s at 10 ms; 0.23 s + RTT behind a fill | the loaded RTT a session builds |
| enterprise or hospital Wi-Fi | **unknown** | unknown side of 83 | wire unless > 470 | short hop, long tail (p99 ~250 ms a hop) | every number |
| public Wi-Fi | ~101 (an average of airport medians) | at the line: wire 1.84 s against decode 2.25 | wire: 8.5 s | the RTT, unpublished | its RTT and load |
| 4G / LTE, one far stream | 27–85 (NDT), lower quartile 7–26 | wire: 2.2–6.9 s, 7–27 at the quartile | wire: 10–32 s | 5–6 round trips of 38 ms, ~0.5 s; 1–2.8 s behind a fill | random loss reaching QUIC; the loaded RTT (0.8 s median) |
| 5G sub-6 | > 100 (a **target** for the 5th percentile), PHY 284–771 | decode | wire: 1.1–3.0 s at 284–771 | round trips of the path to the region | goodput per session, loss, loaded RTT: none read |
| 5G mmWave | ~1 467 (8 streams, line of sight) | decode: 2.25 s (wire 0.13) | decode if the ratio holds: 1.3–1.8 s, wire 0.59 | ~8 round trips of ~56 ms, 0.25–0.5 s | Cubic's loss bound at 0.01 % (~20 Mbit/s at 56 ms, D) may make it the wire after all |

So on the decode-bound profiles B, not A, is the faster fill **if** the phone decodes HTJ2K in 26–36 ms
effective; on every wire-bound one A wins by its bytes (0.22 of B's on this series, 0.07–0.10 on the others). C1
costs A's fill and then round trips; C2 costs both series' bytes. That one unmeasured number moves the arms' order on
half the profiles.

### An ask on demand is bound by the round trip

The exact frame after the fill ends: one round trip for the ask, then slow start from 12 000 B to the BDP (5–8 round
trips here), then the remainder at *G*; 2.15 MB is under two BDPs on every profile above 100 Mbit/s at 26 ms, so the
round trips are most of it (D). During a fill the ask waits behind what the server has written to quinn, up to the
browser's 6 MiB stream credit: 6 MiB ÷ *G* + one RTT, 2.8 s at 18 Mbit/s, 0.49 at 103, 0.08 at 600 (D;
[`link-conditions.md`](link-conditions.md) item 9). Then the single decoder's HTJ2K decode, unmeasured on the phone.

---

## 3 · What a study's size changes, and what it does not

Length scales wire and decode alike, so it does not move the crossover or which side binds. It changes:

* **what is fetched**: a multi-GB study at 100 Mbit/s of goodput is 80 s a GB on the wire (D), so the fill order and
  the asks matter more than the fill's total;
* **memory and the cache**: a `dbts_b1` frame is ~17 MB decoded ([`../client/evidence/cache-in-opfs.md`](../client/evidence/cache-in-opfs.md)),
  850 MB for its 50 frames (D); the byte budget and the cache, not the link, decide what stays;
* **exposure to the link's variability**: a fill of minutes meets handovers (30+ in 8 minutes on mmWave while
  walking), radio-state changes and other users (a second active user halved one's rate, Fezeu), which a 2–3 s fill
  mostly does not. The regime per frame holds; its time series varies.

---

## 4 · Emulating each profile, and where a phone is needed

`netem` forms, **assumed** from the sources above, for later simulation rows; none is fitted except the first. A rate
above what the host has been shown to carry is not run: the userspace relay was checked to 100 Mbit/s and the cloud
rig's 2 vCPUs never past ~58 Mbit ([`../rig-limits.md`](../rig-limits.md) §3); above that, a scaled form decides
queues and loss responses, never fill times.

| profile | `netem` on the server's egress (delay is one way) | from |
| --- | --- | --- |
| home Wi-Fi, measured | `delay 1ms rate 600mbit limit 2000` (40 ms of queue), no loss | the fit, §1 |
| home Wi-Fi, median | `delay 5ms rate 218mbit limit 4500` (~250 ms loaded), no loss | Ookla fixed (M) |
| enterprise Wi-Fi | `delay 2ms 10ms distribution pareto rate 100mbit limit 2000` | Sui's hop tail; the rate is a pick |
| public Wi-Fi | `delay 10ms rate 100mbit limit 2000` | Ookla airports; RTT and queue are picks |
| 4G / LTE | `delay 19ms rate 50mbit limit 3300 loss 0.1%`, and a 40 ms outage (`loss 100%`) every 30 s | Walelgne (38 ms), NDT (rate), Ookla loaded (0.8 s), Lauridsen (40 ms) |
| 5G sub-6 | `delay 13ms rate 300mbit limit 7500 loss 0.01%` | Fezeu (shared rate), the ITU target; loss a pick |
| 5G mmWave | `delay 28ms rate 1400mbit limit 6000 loss 0.01%`, dropping to `rate 167mbit` for 2 s every 16 s | Narayanan (rate, RTT, loss, handoffs) |

`limit` is in packets of 1 500 B (rate × queue ÷ 12 000 bits). netem's `loss` is independent; `loss gemodel` gives
bursts where a row needs them.

**Where the decode decides, a phone must be used**: the measured and median home Wi-Fi, 5G sub-6 and mmWave for the
view, and every profile above ~470 Mbit/s for HTJ2K. There the cloud's 4-core software decode is not the phone's and
no emulation answers. **Where the wire decides** (LTE, a far stream, the p10 of every profile, HTJ2K below ~470) an
emulated link on a cloud host decides the arms' order, within the host's ceiling. The first phone cell owed is the
HTJ2K decode per frame: it places B on every profile.

---

## Fixtures and limits

One series' bytes (`dbts_b1`, 50 frames, Q 8 G 8 for the view); one phone's decode (Chrome 157, WebCodecs software,
three decoders, one evening); one fitted link (home Wi-Fi, server on the same router). HTJ2K's phone decode is
unmeasured and assumed at the cloud's ratio; loss reaching the transport, jitter and loaded RTT per profile are not
published for phones; hospital Wi-Fi has no measurement. The other two volumes (`dbts_a1`, `dbts_c1`) have views at
0.07–0.10 of their exact bytes and smaller frames, so their crossovers sit lower; not derived here.

## Sources read 2026-11-14

* RFC 9002 (QUIC loss detection and congestion control) and RFC 9438 (CUBIC), rfc-editor.org text.
* ITU-R M.2410-0 (11/2017), *Minimum requirements related to technical performance for IMT-2020 radio interface(s)*.
* A. Narayanan et al., "A First Look at Commercial 5G Performance on Smartphones", WWW 2020 (arXiv 1909.07532).
* R. Sharma et al., "Measuring the Prevalence of WiFi Bottlenecks in Home Access Networks", arXiv 2311.05499v2.
* E. Walelgne et al., "Factors Affecting Performance of Web Flows in Cellular Networks", IFIP Networking 2018.
* Ookla, "Cellular faster than Wi-Fi in US airports", 2025-12-15.

Reused as read 2026-10-13 in [`link-conditions.md`](link-conditions.md) §Sources: the Ookla tiles and NDT summaries,
Sui (MobiSys 2016), Fezeu (SIGCOMM 2024), Gimenez (VTC 2016), Lauridsen (IEEE Commun. Mag. 2017), FCC OBI No. 5.
Not reached on 2026-11-14: Opensignal's reports and Ofcom's *Mobile Matters* (403), Sui's host (timeout), Fezeu's
host (TLS verification failed), Jiang et al.'s bufferbloat study (connection reset).
