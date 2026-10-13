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

Each was measured or derived inside 5–50 Mbit/s and 30–150 ms (or 20 Mbit/s and 30–80 ms). *Re-derived 2026-10-13 (queue
row BANDRECHECK), theory only:* each item now ends on **holds**, **flips** or **open** at the profiles above —
cellular 18 · 103 · 309 Mbit/s (p10 · p50 · p90, world), Wi-Fi 218 at the median, one far stream 27–85, idle RTT 17–52
ms plus 0–100 ms to the region, loaded RTT 0.4–1.9 s on cellular and 0.1–0.5 on Wi-Fi. (D) marks arithmetic on
sourced numbers. The measurements that would decide are §Re-measured, proposed.

1. **The target's framing** ([`transport-conclusions.md`](transport-conclusions.md), The target): "bytes and round
   trips outweigh anything the server does per frame" at 20 Mbit/s. At the measured median (~100 Mbit/s) a 250 KB
   frame is 20 ms on the wire, not 100 (D), so per-frame server cost and CPU per byte weigh 5× more than assumed.
   **Flips.** One core sends ~400 MB/s of fills at 2.0–3.1 ms of CPU a MB (transport-conclusions §4 *Many fills at
   once*), so a fill at 103 Mbit/s costs 2.6–4.0 % of a core and a core carries ~31 at once, ~10 at 309, against ~160
   at 20 (D). And the client: at 100 Mbit/s and 1× HTJ2K's fill of a 12-bit DBT volume still ran at 94 Mbit/s, the wire
   the clock, but AV1's fill of `dbts_b4` at 4× ran at 36 (§Where AV1 fills first, whole volumes, in
   [`../av1/README.md`](../av1/README.md)): on a slow CPU AV1's decoders, not bytes and round trips, are the fill's
   clock below the median link. HTJ2K at 4× was not timed above 50 Mbit/s. The framing that follows: **CPU per byte on the server and decode rate on the client rank
   with bytes**, which raises items 6 and 7. Decided by FASTCLOCK.
2. **The congestion controller** (§1 there: `cubic-restart` default, BBR opt-in): cells at 5/20/50 Mbit/s and the
   phone profiles, whose loss rates and buffer depths were picks; the 1–5 % loss cells are the measured tail. The
   loaded-latency rows above say the queue a controller builds is the dominant RTT on real phones, which is BBR's
   price in §1.
   **Holds; one reason against BBR does not.** At the measured median loss (≤ 0.1 %) the profile cell closest to it,
   LTE-good (0.01 %, 500 ms FIFO), is a tie, BBR 0.97× Cubic's fill (§1 *Link profiles close to a phone*); BBR's
   1.3–7.3× wins sit at 0.3–1 % loss, the measured tail. Its "price is the queue" holds only behind a shallow FIFO: in
   the deep FIFOs the loaded RTTs imply (0.75 s at 103 Mbit/s is ~9.7 MB of buffer, D) Cubic fills the buffer too —
   360 ms of standing queue against BBR's 382 on LTE-good, 0.6–0.7 s each on LTE-loaded (same table). Its neighbour
   cost behind a shallow FIFO (94–99 % share) stands. What would move the default is still the loss mix, which only the
   field pilot of §1 *The deciding fact* gives; no new protocol.
3. **The initial congestion window** (§3 there): first-ask cells at 30–80 ms; at ~100 Mbit/s a 250 KB ask is
   window-bound for more of its life (D: BDP at 26 ms is 325 KB).
   **Holds for the default; open for the 32-packet window.** The first-ask cells ran on a link with **no rate
   limit** (§3 *The first ask on an idle session*), which is the regime the measured rates put an ask in: at 103
   Mbit/s and 26–72 ms the BDP is 335–927 KB (D), so a 250 KB ask is slow start from its first byte to its last, as
   there. The push at session open still warms every fill-opened session, so the default stands. For an ask-only
   session, and after every new client address, the 32-packet window's −28 to −33 % (≈ 1.6 of 5.8 round trips)
   carries over unchanged; its one losing cell was a 10-packet queue at 10 Mbit/s, 12 ms of buffer. A 38 400-byte
   burst is under 3 ms at 103 Mbit/s (D), and the loaded RTTs imply buffers of hundreds of ms on both cellular and
   Wi-Fi, so that cell is far from the measured common case — but no measured buffer distribution says how far. The
   evidence now leans toward the wider window, and the call stays the owner's; decided by IWDEEP.
4. **Flow-control windows** (quinn's defaults; [`../native/quic.md`](../native/quic.md) §7: "no candidate is
   flow-control-bound at 5–50 Mbit/s"): quinn's 1.25 MB stream window caps one stream at 1.25 MB ÷ RTT, so at the
   cellular median of 103 Mbit/s it binds above 97 ms, and at the p90 of 309 above 32 ms (D). The loaded RTTs above
   are far past both.
   **Holds for Chromium; flips for a quinn client; open for Firefox.** The window that binds a fill is the
   *receiver's*, so a browser's, not quinn's. Chromium 141 opens every QUIC session, WebTransport's included, with a
   6 MiB stream and 15 MiB session window (`net/quic/quic_context.cc:22–23`, applied at `:89–91`; the WebTransport
   client calls `InitializeQuicConfig`, `dedicated_web_transport_http3_client.cc:619`): it binds one stream above
   489 ms at 103 Mbit/s and 163 ms at 309 (D), past every idle RTT measured. Under load it binds, but there it costs
   nothing: a window still above the idle BDP keeps the link full, and it caps the queue the fill builds at
   6 MiB ÷ rate − the idle RTT (0.44 s at 103 Mbit/s and 46 ms, D) — less than the loaded medians. quinn's 1.25 MB,
   the native client's default and every rig client's (`lab/window-harness`), binds at the idle RTTs of a far region
   at the median rate and of any region at the p90: it would cap a native fill at 1.25 MB ÷ RTT, 100 Mbit/s at 100
   ms. The change: the native client opens with Chromium's 6 MiB (memory only while its reader lags). Firefox's
   windows were not read. Two cautions for the rig: a quinn rig client above 1.25 MB ÷ RTT measures its own window,
   not the server; and the window caps what an ask waits behind (item 9).
5. **The 768 KB send window** ([`../rig-limits.md`](../rig-limits.md): "five times the bandwidth-delay product and
   never binds" on the target link): at 103 Mbit/s it binds above ~60 ms (768 KB × 8 ÷ 103 Mbit/s, D).
   **Holds: not adopted, and now could not be.** It binds above 20 ms at 309 Mbit/s and 28 at Wi-Fi's 218 (D), inside
   the idle RTTs, so as a fixed window it would cost fills; "the drop lever for a fast-link deployment" is withdrawn.
   The overflow it removed was the browser's socket at loopback rates; whether a phone's receive path overflows at
   100–300 Mbit/s is unmeasured ([`../rig-limits.md`](../rig-limits.md) §1, §7). A send window that follows the
   congestion window instead of a constant is item 9's lever, not this one.
6. **The GSO segment cap** (§4–5 there): its throughput gain was "where the pipe is full", which the measured rates
   make the common case rather than the exception.
   **Holds; its weight rises.** One phone session does not fill a core even at 309 Mbit/s (~10 % of the ~400 MB/s a
   core sends, D), so the "+10 to +30 % throughput" stays a loopback number; the −16 to −21 % CPU per ask is what
   reaches the target, as ×1.19–1.27 the fills a core carries (D) — at the measured rates the binding constraint from
   ~31 sessions a core on. The tail it carried at depth 1 was the rig client's receive queue (§5 *Why a drop takes the
   tail*) and does not depend on the rate. Ship 24 or 45 stays the owner's call; FASTCLOCK prices it.
7. **AV1 against HTJ2K by total time** ([`../av1/README.md`](../av1/README.md) §Total time, §Where AV1 fills first):
   AV1 fills first below 11–56 Mbit/s on DBT and 1–7 on FFDM. At the measured medians most sessions are above every
   crossover, which strengthens the verdict that ingest keeps HTJ2K; the cellular p10 (18–29) and NDT's lower
   quartile (7–26) are where AV1's side lies.
   **Holds for ingest; flips for `dbts_b4`.** On whole DBT volumes of the ≈ 0.95 class AV1 is ahead up to 100 Mbit/s
   at both CPU speeds but by 1.5–5.3 % (one cell 1.2 % behind), short of the round's bar of ≥ 5 % on every phone link
   in both engines at both speeds (§Where AV1 fills first, whole volumes); FFDM and the synthesized 2D views were
   HTJ2K's at every link above 5 Mbit/s and fall further behind as the decode becomes the
   clock (item 1). So ingest keeps HTJ2K. The owner's open choice — serve a series AV1 codes a fifth smaller
   (`dbts_b4`, 0.755–0.778 of HTJ2K's time on 10–20 Mbit/s and `lte-good`) as AV1 — was priced on links now known to
   be the slow tail. Its measured cost, 1.97× in Chromium at 4× on 100 Mbit/s and 1.71× in Firefox at 4× on 50,
   sits at the cellular median; its predicted crossover at 4× is 37–38 Mbit/s, under which 11–28 % of cellular tests
   lie (tiles under 20 and 50, D), and 140–151 at 1×, between the cellular and Wi-Fi medians. From a win on every
   phone link it becomes a trade-off on most; decided by B4FAST.
8. **Asks first** ([`../ARCHITECTURE.md`](../ARCHITECTURE.md): 0.30–0.77 of the sequential fill "on 5–50 Mbit"),
   **the bases' playable times** ([`../av1/README.md`](../av1/README.md) §Preview: "0.01–0.5 s on 5–50 Mbit/s,
   decode-bound"), and **the tail-loss copy's criteria** (transport-conclusions §5 *A frame's tail sent twice*: "the
   target's loss mix is unknown").
   **All three hold.** *Asks first:* asked frames come at c + k·b/R + t against the sequential fill's c + (N/2)·b/R
   to the middle; a faster link shrinks both, and once the decoders are the clock the asked frames still decode
   first. The ratio drifts toward 1 and the absolute gain shrinks; its cost, two round trips, is 1.3–2.9 % of a 6.24 s
   100 Mbit/s DBT fill at 40–92 ms (D), against +0.4–4 % measured. *Bases:* decode-bound already at 5 Mbit/s, so no
   faster link moves them. *Tail copy:* loss of ≥ 1 % is the measured tail (5G p99 1.2 %; 0–4 % of US fixed
   subscribers at peak), not "a real share", and the radio retransmits, so loss surfaces as delay; criterion (1)
   still fails.
9. **What an ask waits behind its own fill** (new; row 162's loaded RTT, read for the product). An ask ends the fill
   and is served next, behind what of the fill is already written to quinn ([`../WIRE.md`](../WIRE.md) §An ask during
   a fill). quinn accepts a write while `min(peer credit left, send_window − buffered)` is positive, `buffered` being
   written and not yet acknowledged (quinn-proto 0.11.18 `connection/streams/state.rs:832–836`); the planner writes
   the next frame as soon as one is accepted. So the bytes ahead of an ask are the smallest of the receiver's stream
   window, the 10 MB send window and the fill's remainder — **in Chromium 6 MiB**, whatever the link's queue — and the
   ask waits
   **W ≈ 6 MiB ÷ R + one RTT**: 2.8 s at 18 Mbit/s, 0.49 at 103, 0.23 at Wi-Fi's 218, 0.16 at 309; 0.6–1.9 s at
   NDT's far-stream medians (D), against ~1.3 round trips, 0.06–0.12 s at 46–92 ms, for an ask on an idle warm
   session (transport-conclusions §3 *The first ask on an idle session*). Loopback agrees in shape: the
   rig's quinn client, 1.25 MB of credit, left 4–5 frames of 250 KB (~1.1 MB) ahead of each ask (WIRE.md).
   * **What sits in the queue and what in quinn.** Of those bytes, a congestion window's worth is in flight and the
     rest waits unsent in quinn. Cubic's window behind a deep FIFO is rate × (RTT + queue), 5.1–10 MB at 103 Mbit/s
     with 0.36–0.75 s of queue (D), at or past the credit; behind a short or managed queue (CoDel: 4.7 ms, §1 *Link
     profiles*) it is about one BDP, 0.3–0.9 MB (D), and **5.1–5.7 MiB of the 6 MiB ahead never needed to be written
     yet** (D).
   * **The lever, net in theory: a send window that follows the congestion window.** Before each frame the planner
     sets `send_window = cwnd + M` (quinn 0.11.11 `Connection::set_send_window`, `stats().path.cwnd`; the server
     reaches quinn through `quic_connection()`), with M two of the series' largest frames so the pacer never waits on
     the reader. The bytes ahead become min(credit, cwnd + M): W falls to (cwnd + M) ÷ R + RTT, ~0.1 s at 103 Mbit/s with
     250 KB frames behind a short queue, and is unchanged where the queue is deep (the credit binds there already)
     (D). The fill is untouched
     in theory — what is in flight is unchanged, and what waits in quinn never left sooner for waiting there — and a
     session holds cwnd + M instead of up to 6–10 MB, below the 3.7–4.8 MB measured per filling session. Server code
     only, no wire change.
   * **What cuts the queue itself, and costs.** A deep FIFO's own queue (0.36–0.75 s) is what Cubic builds and
     only a controller or a managed queue shortens: BBR stood 382 ms in the same FIFO, so it is no answer; a cap on
     bytes in flight at k × the estimated BDP is a controller change, the trade-offs of §1 *The ways out*. Pacing
     spreads the same bytes and removes none. An ask on its own stream at a higher priority would skip the unsent
     part too but is a wire change, structural, and buys nothing the send window does not.
   Decided by ASKAHEAD.

What is still open: phone loss distributions, a hospital's uplink, a hospital's Wi-Fi, the RTT from a phone to
the cloud region a deployment would actually use, and buffer depths, which items 3 and 9 turn on. Each needs a field
measurement, not a source.

## Re-measured, proposed

Protocols for the items that flip or are open, each for a session given only the protocol and its rule. Rates and
RTTs are the profiles above; every cell goes through `lab/scripts/link_impair.py` at a rate it is first shown to
sustain (its ceiling measured first, nothing claimed past it); arms interleaved by `lab/scripts/order.py`, every
frame checked against the encoder's input, each arm's full settings printed and equal but for the lever.

* **ASKAHEAD (item 9) — does a send window that follows the congestion window shorten an ask during a fill, at no
  cost to the fill?** Arms: today; `send_window = cwnd + M` set before each frame, M = 2 × the largest frame. Cells:
  18, 103 and 309 Mbit/s; idle RTT 46 and 92 ms; FIFO 20 ms, 360 ms and 800 ms, and CoDel 5:100; Chromium 141 through
  the product's client (6 MiB credit), the 10-bit DBT volume, an ask for a frame the fill has not reached at 50 % of
  it. Measure ask → last byte, the fill's issue → last frame, server RSS per session. ≥ 10 rounds Williams-ordered.
  *Predictions:* today's ask ≈ 6 MiB ÷ R + RTT in every cell (2.8 / 0.49 / 0.16 s plus the RTT); the arm ≈
  (cwnd + M) ÷ R + RTT, cwnd read from the server's stats — at 46 ms behind 20 ms ~0.6 / 0.2 / 0.14 s at
  18 / 103 / 309 Mbit/s (D, M ≈ 1.1 MB on this volume) — and within ±10 % of today behind 360 and 800 ms; fill time within its spread everywhere;
  RSS per session lower. *Rule:* adopt as the default if the ask improves ≥ 20 % in every short-queue cell and no
  cell's fill or ask is worse beyond its spread; a fill worse anywhere makes it a trade-off for the owner.
* **IWDEEP (item 3) — is the 32-packet initial window net behind the buffers phones have?** Arms: quinn's 12 000
  bytes; 38 400. Cells: 18, 103, 309 Mbit/s; idle RTT 46 and 92 ms; FIFO 10 packets (the old losing depth), 20 ms, 360 ms. A fresh ask-only
  session asks one 250 KB and one 50 KB frame; a control session opens with the push. *Predictions:* −25 to −33 % at
  103 and 309 behind 20 and 360 ms, −10 to −20 % at 18 Mbit/s (more of the ask is rate-bound); a loss only behind
  10 packets, at every rate (a ~26-datagram burst exceeds it); the push-opened control a tie. *Rule:* the default if
  no cell but the 10-packet ones is worse beyond its spread and those are disclosed as the shallow-buffer price; otherwise it stays
  the owner's call with these numbers.
* **FASTCLOCK (items 1, 6) — above what rate is each codec's fill the decoders', not the wire's?** Arms: HTJ2K and
  AV1 (the optimized payload), Chromium 141 and Firefox, 1× and 4× CPU. Cells: 50, 103, 218 Mbit/s at 46 ms, the
  10-bit DBT volume and a four-view FFDM exam. Measure the fill's time and the decode left after the last byte, and
  the server's CPU a MB with and without the GSO cap of 24 at 103 Mbit/s and 32 sessions. *Predictions:* HTJ2K at 1×
  wire-bound through 103, decode-bound at 4× from ≤ 103; AV1 decode-bound at 4× from 50; the GSO cap −16 to −21 % CPU
  a MB with no fill worse. *Rule:* nothing adopted from the fill cells (they rank levers, not decide them); the GSO
  cap of 24 becomes the build default if its CPU saving holds and no fill or ask is worse beyond its spread.
* **B4FAST (item 7) — what does serving `dbts_b4` as AV1 cost across the measured distribution?** The crossover
  protocol ([`../av1/crossover-protocol.md`](../av1/crossover-protocol.md)) on the whole volume, both codecs, at 18,
  103, 218 and 309 Mbit/s and 46 ms, Chromium and Firefox, 1× and 4×. *Predictions:* AV1 ≤ 0.85 at 18 at both speeds;
  at 103 ≤ 1.0 at 1× and 1.8–2.0 at 4×; > 1.0 at 218 and 309 at 4×. *Rule:* a per-series AV1 choice is net only if
  AV1 is ≤ 1.0 + its spread in every cell; otherwise the cells, weighted by the share of tests in each band (Ookla
  tiles, §Link profiles), go to the owner as a trade-off.
* **The native client's window (item 4)** needs no rig: when the native client is built, it opens with a 6 MiB stream
  window; its cost is memory only while its reader lags, which its own row measures.

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

Row BANDRECHECK read code, not data: Chromium `141.0.7390.37` `net/quic/quic_context.cc` (SHA-256 of the file
`fe93bc18…`) and `net/quic/dedicated_web_transport_http3_client.cc` (`50c0821a…`) from chromium.googlesource.com;
quinn-proto 0.11.18 and quinn 0.11.11 as `scripts/patch_crate.sh` pins them (crates.io, `a9746dbd…`, `0c1a41e4…`).

Not used: Huang et al., "An In-depth Study of LTE", SIGCOMM 2013 (the authors' host failed TLS verification), and
Ofcom's home broadband reports (403); both are named so a later reader can add them.
