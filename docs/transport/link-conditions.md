# Link conditions, measured by others

*Queue row 162, LINKREAL, 2026-10-13. Research only: nothing here was timed on this repository's rig. The numbers are
other people's measurements, read from pinned copies, plus two summaries of open datasets run here
([`../../lab/link-conditions/`](../../lab/link-conditions/README.md)).*

**The question.** The target's 5–50 Mbit/s and 30–150 ms ([`transport-conclusions.md`](transport-conclusions.md), The
target; [`../native/quic.md`](../native/quic.md) §7) were set as an assumption. What do real links measure?

**The answer, short.** The band is the **slow tail**, not the typical link. A phone on cellular measures a median of
~100 Mbit/s down (p10 18, p90 309) to a nearby test server, and a phone on Wi-Fi ~220 (p10 40); one TCP stream to an
off-net server, which is closer to one session to a cloud PACS, measures 27–85 Mbit/s at the country median and 7–26
at the lower quartile. Idle round trips to a nearby server are 16–55 ms on cellular (p10–p90) and 5–26 on Wi-Fi; to a
cloud region add the path: a wired minimum under 10 ms where the country has a region, 10–40 ms in most others. **Under load the round trip is not 30–150 ms but
0.7–0.8 s at the median on cellular (p90 1.8–2.3 s) and 0.2–0.3 s on Wi-Fi** — bufferbloat dominates what a saturating
fill sees. Residual loss is mostly ≤ 0.1 %, with tails near 1 %; the 1–5 % cells measured here are rare tails, not
the common case. **The band is replaced** (§What it means).

**How a number is sourced.** Each carries its source at its point of use; (D) marks arithmetic on sourced numbers, (M)
a summary computed here from an open dataset by the named script. Every fetch is pinned by SHA-256 in
[`SHA256SUMS`](../../lab/link-conditions/SHA256SUMS), its URL in [`sources.tsv`](../../lab/link-conditions/sources.tsv).

---

## Link profiles

Down/up are the client's download and upload. p10 · p50 · p90 unless marked; "Q25–Q75" is a quartile range.

| link | rate down | rate up | idle RTT | RTT under load | loss | variation | source, where, when |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **Cellular, phone** (all generations) | 18 · 103 · 309 Mbit/s (world); 29 · 212 · 625 (US); 19 · 115 · 342 (Europe) | 4.3 · 19 · 43 (world); 2.2 · 19 · 61 (US) | 17 · 26 · 52 ms (world); 17 · 27 · 55 (US) | down phase 405 · 825 · 1 879 ms (world); 432 · 745 · 1 765 (US); 354 · 742 · 1 801 (Europe) | — | 11 % of tests in tiles under 20 Mbit/s, 28 % under 50 (world); 7 % and 16 % (US) | Ookla open tiles, 2026 Q3 (M) |
| **Wi-Fi or wired, phone** (Ookla's "fixed") | 40 · 218 · 468 (world); 135 · 387 · 618 (US); 63 · 265 · 474 (Europe) | 20 · 116 · 303 (world) | 5 · 10 · 26 ms (world) | down phase 116 · 251 · 526 ms (world); 80 · 205 · 486 (US) | — | 4.5 % of tests in tiles under 20 Mbit/s, 12 % under 50 (world) | Ookla open tiles, 2026 Q3 (M) |
| **One TCP stream, any access** (NDT) | country medians 27 (IN) · 38 (BR) · 46 (DE) · 53 (ES) · 54 (GB) · 85 (US); Q25 7–26, Q75 73–207 | medians 7.6–43 | min-RTT medians 11.5 (GB) – 32 (IN) ms | — | — | — | M-Lab NDT, 2024-01-01 to 03-26 (M) |
| **5G mmWave, stationary** (Verizon, Minneapolis and Chicago) | median 1 467 Mbit/s on 5G and 167 on 4G at 8 TCP streams, line of sight | ≤ ~60 Mbit/s | ~56 ms to an east-coast server, first hop ~28 ms, 4G alike | 4G inflates "drastically" under a bulk transfer, 5G much less | p50 0.01 %, p75 0.1 %, p99 1.2 % | 30+ 4G/5G handoffs in under 8 minutes while walking | Narayanan et al., WWW 2020, §4–5 and Table 2, 2019 |
| **5G mid-band, PHY** (EU and US operators) | average 557–771 Mbit/s PHY in good channel (CQI ≥ 12, Spain); theoretical 1 213–1 352 | "well below 120 Mbit/s" PHY | PHY user-plane 2.1–6.9 ms | — | — | a second active user halves one's rate (595 → 284 Mbit/s): the cell's resource blocks are split | Fezeu et al., SIGCOMM 2024, §3, §4.1–4.3, §5 |
| **LTE, ping** (one Finnish ISP, ~25 k subscribers) | — | — | min/avg/max 27 / 38 / 51 ms; 90 % of tests < 100 ms | — | 2.4 % of LTE ping tests (5–9 echoes) lost ≥ 1; HSPA+ > 50 % | — | Walelgne et al., IFIP Networking 2018, §IV-C, Oct 2016 |
| **LTE, handover** (drive tests, Denmark) | — | — | — | — | — | interruption 24–29 ms average, occasionally > 100 ms (Gimenez); ~40 ms median over four networks (Lauridsen) | Gimenez et al., VTC Spring 2016, abstract; Lauridsen et al., IEEE Commun. Mag. 2017, abstract |
| **Enterprise Wi-Fi, one hop** (a campus, 47 k devices) | — | — | Wi-Fi hop p50 ~3 ms, p90 ~20, p99 ~250 | — | — | long-tailed; 5 GHz 35 % lower than 2.4 GHz | Sui et al., MobiSys 2016, §3.1 |
| **Home Wi-Fi vs. the access link** (~50 Chicago homes) | 200–400 Mbit/s tier: 156 Mbit/s on Wi-Fi against 266 on the access link (means) | — | — | — | — | Wi-Fi the bottleneck ~100 % of the time above 800 Mbit/s | Sharma et al., arXiv 2311.05499v2, §4, Sep 2021 – Jun 2023 |
| **Fixed broadband, router** (US, volunteer whiteboxes) | (tiers) | (tiers) | ISP medians 7–34 ms: fiber 7–14, cable 12–24, DSL 23–34 | "significantly higher" than idle, most for DSL; values in Chart 7 only | ≥ 1 % peak-period loss for 0–4 % of DSL, 1–4 % of cable, 0–3 % of fiber subscribers | — | FCC MBA 13th report, §2.D–E, Sep–Oct 2022 |
| **Phone to the nearest cloud region** | — | — | wired probes, minimum RTT: < 10 ms in 45 countries (those with a region), 10–20 in 21, 20–40 in 49, 40–100 in 53; on Wi-Fi or cellular the last mile alone is ~20–25 ms median, 40–50 % of the total | — | — | Wi-Fi and cellular last miles alike | Corneo et al., WWW 2021, §4.1 and Fig. 5; Dang, Mohan et al., IMC 2021, §1 and §5 |
| **Hospital site uplink** | **no measurement found.** Recommended ≥ 100 Mbit/s for a hospital with PACS; in 2010 > 80 % of the FCC Rural Health Care Program's institutions bought T1s (1.5 Mbit/s) | — | — | — | — | — | FCC OBI Technical Paper No. 5, 2010, Exhibit C and p. 10 |
| **Hospital Wi-Fi** | **no independent measurement found**; vendor case studies only, without distributions | | | | | | — |

**What the open datasets are, and their bias.**
* **Ookla open tiles** (2026 Q3, CC BY-NC-SA 4.0): app tests from GPS-located phones, averaged per ~610 m tile;
  "mobile" is a cellular connection, "fixed" a phone on Wi-Fi or Ethernet, so the second row is mostly **a phone on
  Wi-Fi** (the dataset's README, "Layers"). The summary is the test-weighted percentile of tile means
  ([`ookla_tiles.py`](../../lab/link-conditions/ookla_tiles.py)), **narrower than the per-test spread**, which the
  dataset does not publish. Biases: tests are user-initiated (people test new or failing links), multi-connection to a
  nearby, often on-net server, so they read capacity, not one flow to a distant one; the loaded latency is Ookla's
  saturating test, a worst case for one flow; regions are latitude/longitude boxes; Ookla trimmed the regions it
  publishes on 2026-04-16 (the README's change log), so quarters before and after are not like for like.
* **M-Lab NDT** (CC0): one TCP stream to an M-Lab server off the access network, from many integrations; it mixes
  fixed and mobile access. The statistics API's 2024 series stops on 2024-03-26 and has no loss; the summary is the
  median over days of each day's quartiles ([`mlab_stats.py`](../../lab/link-conditions/mlab_stats.py)). Bias: one
  stream reads lower than multi-stream tests, which is the direction of one session.
* The regulators' reports (FCC MBA; Ofcom's home broadband reports were 403 to a scripted fetch and are not used)
  measure at the router, so they exclude Wi-Fi, and report idle latency by ISP, not distributions.

*Ookla attribution (its licence):* Speedtest® by Ookla® Global Fixed and Mobile Network Performance Maps was accessed
on 13 October 2026 from AWS. Based on wt-pacs's analysis of Speedtest® by Ookla® Global Fixed and Mobile Network
Performance Maps for 2026 Q3. Ookla trademarks used under license and reprinted with permission.

---

## What it means for the band

**Replaced, not confirmed or widened.** Corrected in place in [`transport-conclusions.md`](transport-conclusions.md),
The target.

* **Rate: the assumed 5–50 Mbit/s is the slow tail.** 28 % of cellular tests worldwide sit in tiles under 50 Mbit/s
  and 11 % under 20 (16 % and 7 % in the US); on Wi-Fi 12 % and 4.5 %. One stream to an off-net server lands lower:
  NDT's lower quartile is 7–26 Mbit/s and its median 27–85 by country. A session's rate is therefore **5 Mbit/s to
  ~600 Mbit/s, with a typical phone at ~100 on cellular and ~200 on Wi-Fi to a near server, and 27–85 on one stream
  to a far one**.
* **Round trip: two regimes, not one range.** Idle, 16–55 ms (p10–p90) to a near server on cellular and 5–26 on Wi-Fi,
  plus the path to the region (a wired minimum under 10 ms in-country, 10–100 ms elsewhere). **Under a saturating transfer,
  0.7–0.8 s median and ~2 s at p90 on cellular, 0.2–0.3 s on Wi-Fi.** The assumed 30–150 ms is the idle regime; a fill
  that fills the queue sees the loaded one unless its controller keeps the queue short.
* **Loss: low, with tails.** 5G stationary p50 0.01 %, p99 1.2 %; 2.4 % of LTE ping tests lost any echo; ≥ 1 % peak
  loss for 0–4 % of US fixed subscribers. Bursts are mobility's: a handover interrupts 24–50 ms, sometimes > 100 ms.
  **No large dataset publishes loss distributions for phones**; the radio's link layer retransmits, so loss surfaces
  as delay.
* **Uplink, which ingest and the hospital→PACS link use** ([`../av1/queue.md`](../av1/queue.md) row 154): cellular
  uplink medians are ~19 Mbit/s; a hospital site's uplink has no measurement at all.

## Verdicts that rest on the band

Listed, not re-run. Each was measured or derived inside 5–50 Mbit/s and 30–150 ms (or 20 Mbit/s and 30–80 ms).

1. **The target's framing** ([`transport-conclusions.md`](transport-conclusions.md), The target): "bytes and round
   trips outweigh anything the server does per frame" at 20 Mbit/s. At the measured median (~100 Mbit/s) a 250 KB
   frame is 20 ms on the wire, not 100 (D), so per-frame server cost and CPU per byte weigh 5× more than assumed.
2. **The congestion controller** (§1 there: `cubic-restart` default, BBR opt-in): cells at 5/20/50 Mbit/s and the
   phone profiles, whose loss rates and buffer depths were picks; the 1–5 % loss cells are the measured tail. The
   loaded-latency rows above say the queue a controller builds is the dominant RTT on real phones, which is BBR's
   price in §1.
3. **The initial congestion window** (§3 there): first-ask cells at 30–80 ms; at ~100 Mbit/s a 250 KB ask is
   window-bound for more of its life (D: BDP at 26 ms is 325 KB).
4. **Flow-control windows** (quinn's defaults; [`../native/quic.md`](../native/quic.md) §7: "no candidate is
   flow-control-bound at 5–50 Mbit/s"): quinn's 1.25 MB stream window caps one stream at 1.25 MB ÷ RTT, so at the
   cellular median of 103 Mbit/s it binds above 97 ms, and at the p90 of 309 above 32 ms (D). The loaded RTTs above
   are far past both.
5. **The 768 KB send window** ([`../rig-limits.md`](../rig-limits.md): "five times the bandwidth-delay product and
   never binds" on the target link): at 103 Mbit/s it binds above ~60 ms (768 KB × 8 ÷ 103 Mbit/s, D).
6. **The GSO segment cap** (§4–5 there): its throughput gain was "where the pipe is full", which the measured rates
   make the common case rather than the exception.
7. **AV1 against HTJ2K by total time** ([`../av1/README.md`](../av1/README.md) §Total time, §Where AV1 fills first):
   AV1 fills first below 11–56 Mbit/s on DBT and 1–7 on FFDM. At the measured medians most sessions are above every
   crossover, which strengthens the verdict that ingest keeps HTJ2K; the cellular p10 (18–29) and NDT's lower
   quartile (7–26) are where AV1's side lies.
8. **Asks first** ([`../ARCHITECTURE.md`](../ARCHITECTURE.md): 0.30–0.77 of the sequential fill "on 5–50 Mbit"),
   **the bases' playable times** ([`../av1/README.md`](../av1/README.md) §Preview: "0.01–0.5 s on 5–50 Mbit/s,
   decode-bound"), and **the tail-loss copy's criteria** (transport-conclusions §5 *A frame's tail sent twice*: "the
   target's loss mix is unknown").

What is still open: phone loss distributions, a hospital's uplink, a hospital's Wi-Fi, and the RTT from a phone to
the cloud region a deployment would actually use. Each needs a field measurement, not a source.

## Sources

Read 2026-10-13; SHA-256 of each fetch in [`SHA256SUMS`](../../lab/link-conditions/SHA256SUMS).

* Ookla, Speedtest Global Fixed and Mobile Network Performance Maps, 2026 Q3 parquet tiles (`ookla-open-data` on AWS),
  and its README at `teamookla/ookla-open-data` `71a1575a`.
* M-Lab, NDT daily statistics, `statistics.measurementlab.net/v0/<continent>/<country>/2024/histogram_daily_stats.json`.
* FCC, *Thirteenth Measuring Broadband America Fixed Broadband Report*, 2023 (data Sep–Oct 2022).
* FCC, *OBI Technical Paper No. 5: Health Care Broadband in America*, 2010.
* A. Narayanan et al., "A First Look at Commercial 5G Performance on Smartphones", WWW 2020 (arXiv 1909.07532).
* R. A. K. Fezeu et al., "Unveiling the 5G Mid-Band Landscape", SIGCOMM 2024.
* E. Walelgne et al., "Factors Affecting Performance of Web Flows in Cellular Networks", IFIP Networking 2018.
* L. C. Gimenez et al., "Mobility Performance in Slow and High Speed LTE Real Scenarios", VTC Spring 2016.
* M. Lauridsen et al., "From LTE to 5G for Connected Mobility", IEEE Communications Magazine 2017 (the authors' copy).
* K. Sui et al., "Characterizing and Improving WiFi Latency in Large-Scale Operational Networks", MobiSys 2016.
* R. Sharma et al., "Measuring the Prevalence of WiFi Bottlenecks in Home Access Networks", arXiv 2311.05499v2.
* L. Corneo et al., "Surrounded by the Clouds: A Comprehensive Cloud Reachability Study", WWW 2021.
* T. K. Dang, N. Mohan et al., "Cloudy with a Chance of Short RTTs: Analyzing Cloud Connectivity in the Internet",
  IMC 2021 (the authors' copy).

Not used: Huang et al., "An In-depth Study of LTE", SIGCOMM 2013 (the authors' host failed TLS verification), and
Ofcom's home broadband reports (403); both are named so a later reader can add them.
