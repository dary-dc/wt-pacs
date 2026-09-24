# What this rig cannot measure

Every number in this repository was taken on one 8-core workstation over loopback
(`intel_pstate`/`powersave`, 15 GB RAM, NVMe with `read_ahead_kb=128`, btrfs on LUKS,
Linux 7.1.13), or in an agent container beside it. Eight limits bound what they can decide. Each is stated with the evidence that
established it and with what would lift it — written for an agent working somewhere else.

Two of them already have drivers under `lab/scripts/` aimed at the cloud rig in
[`cloud-rig-access.md`](cloud-rig-access.md), which exists because `sch_netem` loads on a VM but
not in an agent container.

## 1. The browser's receive path is the ceiling, not the wire

Measured 2026-09-11, sampling the browser's threads per run: Chromium's network-service IO thread
costs **~9.8 ms of CPU per MB received** — ~14 µs per 1 452-byte datagram, inferred from that rate
— which caps a fill near 100 MB/s on this box whatever the server does. A 61 MB study fills at
94.5 MB/s with that thread at a full core (107 % in its busiest 100 ms); a 4.4 MB study reaches
73.6 MB/s with it at 61 %, so something else holds the small study back first — start-up, loss
recovery, and the 5× higher frame count per MB are all candidates, **not separated**.

The consequence is that **no sender-side lever shortens a browser fill here**. Measured against
the default on one interleaved campaign: a 768 KB send window removed every dropped datagram and
the ~2 MB gap that follows the first burst, and changed the fill by less than a millisecond;
one stream per frame was 42 ms worse over 87 frames (0/8 rounds better); BBR was 8.5× slower.
On a lossy link, natively, that last one reverses (§3).

Chromium receives one datagram per system call, yields every 32 packets or 2 ms, builds ACKs in
user space, and ships with batched receive and GRO off; the rig's build (148) carries no flag to
turn them on. Published measurements agree on the shape: Chrome's HTTP/3 download reached
478 Mbps against ~900 Mbps over TCP on a 1 Gbps desktop, and 63 s against 30 s on a Pixel 5 over
5G (WWW '24).

**What lifts it:** a link slower than the receiver, so the wire binds before the receive path does
(§3). The native drivers in `lab/` avoid it entirely, at the cost of no longer measuring a browser.

## 2. On a fill, the finish is the decode queue, not transport

Measured 2026-09-11 on the browser rig, per frame across three decoders: **148.5 ms waiting for a
decoder** (worst 265), 10.0 ms decoding, 28.9 ms for the page to take the result. 87 frames need
~290 ms of decoding and arrive within ~70 ms of each other, so the queue sets the finish.

A transport change therefore shows in *when the last frame arrives* and is **masked in *when the
last frame is decoded***. Both columns must be reported, and a lever judged on the first is not
thereby judged on the second: opening the session from the page head brought all frames in 122 ms
sooner (6/6 rounds) while all-decoded moved 39 ms (5/6).

**What lifts it:** report the two columns separately, and do not price a transport lever on a
decode-bound total. Decoder width is not the answer — the target device (§7) cannot spend it.

## 3. Loopback is not a network, and its MTU favours TCP

Loopback's MTU is 65 536. A peer carrying its data over TCP gets ~64 KB segments where our QUIC
datagrams stop at 1 452 — 45× fewer trips through the receive path of §1 for the same bytes.
**Any QUIC-against-TCP comparison taken here is structurally against QUIC**; a real network gives
both ~1.5 KB packets. Loopback also has no loss, no reordering and no queueing delay, which is
precisely the regime the product targets.

Shaping the loopback interface needs root, which this box's agent context does not have.

**What lifts it:** the cloud rig. `lab/scripts/cloud_netem.sh` shapes rate, one-way delay and loss
on the server's egress, with an iid and a Gilbert-Elliott burst model;
`lab/scripts/e0_netem_validation.sh` checks the shaping did what it claims before a campaign reads
anything.

**Measured there, 2026-09-18 (lane L3):** `lab/scripts/l3_lossy_link.sh`, summarised by
`lab/scripts/l3_summary.py`. The native driver runs on the workstation, and the server runs on the rig
across the real WAN (~28 ms RTT, 27–58 Mbit unshaped, varying run to run). netem adds one-way delay,
20 Mbit, iid loss and a 500-packet queue, on the server's egress only. Each run is a 5.12 MB fill
(160 × 32 kB frames, wall time including connect) and 32 asks at depth 1. Three arms, interleaved,
n = 5 per cell, median [range] and rounds better than the default:

| delay · rate · loss | fill, default | 768 KB send window | BBR | ask p50, default | ask p50, BBR |
| --- | ---: | ---: | ---: | ---: | ---: |
| unshaped | 0.7 s [0.7–0.7] | tie, 1/5 | 0.8 s, 0/5 | 38.9 ms | 30.8, 5/5 |
| 20 ms · 20 Mbit · 0 % | 2.8 s [2.5–4.2] | 2.6, 3/5 | 2.5, 4/5 | 73.7 | 61.6, 5/5 |
| 20 ms · 20 Mbit · 1 % | 12.7 s [12.1–15.4] | 13.9, 2/5 | **2.4 [2.4–2.9], 5/5** | 105.3 | **61.7, 5/5** |
| 20 ms · 20 Mbit · 3 % | 24.3 s [23.2–28.3] | 23.6, 2/5 | **2.9 [2.4–3.0], 5/5** | 194.9 | **103.3, 5/5** |
| 60 ms · 20 Mbit · 1 % | 27.4 s [7.1–31.1] | 21.2, 3/5 | **3.0 [2.8–3.1], 5/5** | 185.8 | **101.9, 5/5** |

* **On a lossy link the congestion controller is the lever, and the send window is not.** At 1 %,
  cubic fills at 3.2 Mbit of a 20 Mbit link, close to the classic loss-limited rate (~2.4 Mbit at
  its 1.4 % and 49 ms); BBR fills at 16.7. The 768 KB window ties the default in every lossy cell,
  because cubic's congestion window never gets near it. Its one effect is at 0 %, where it caps
  slow start's overshoot of the queue (datagram loss 7.8 % → 0.8 %) for a fill that is 3/5 better,
  unresolved. Loopback's verdict, not taken, stands.
* **BBR's costs, measured.** It keeps the queue full: smoothed RTT 145–220 ms against cubic's 49 in
  the lossy cells. Its startup overflows that queue: 5–13 % of its datagrams are lost and resent,
  against 1.4–2.9 % for cubic. Unshaped, its fill is 0/5. In a browser on loopback it was 8.5×
  slower (§1). **So this is a lever to price in a browser on a shaped link, not one to take**: a
  browser's receive path (§1) and a phone's buffer depth are exactly what this cell does not model.
* **One ask under loss**, 32 kB, p50: cubic 105 ms at 1 % and 195 at 3 %, against a floor of ~61
  (round trip plus transfer). BBR: 62 and 103.
* **Where the host saturates:** unshaped, a 5 MB fill reaches 58 Mbit (a 32 MB fill reached 27; the
  WAN varies), with the server at ~20 % of one core and negligible steal. Every shaped cell runs at
  20 Mbit, below the path; nothing is claimed above ~27 Mbit.

Instrument notes, each of which would have produced a wrong number:

* **netem on the sending host drops whole GSO batches.** quinn hands the kernel up to 64 datagrams
  per send; netem sees each batch as one packet, so "1 %" was 1 % of batches (0.2 % by its own
  count, bursty by construction). Every arm here runs with `--segmentation-offload false`, a lab
  flag added for this. The server's own loss count then matches the configured rate: 1.41 %,
  2.87 %, 1.45 %.
* **Only UDP 4435 reaches the rig from outside**; 4436 and 4437 pass its host firewall, but no
  session arrives. The arms share one port, and the server restarts per run.
* `e0_netem_validation.sh` was not run: it compares the real path with a locally *simulated* RTT,
  not netem on the rig. Instead the shaping was checked directly: goodput caps at the netem rate,
  and the loss counts match.
* Not modelled: jitter (netem reorders), loss on the client → server path, a browser receiver, a
  phone's buffer.

**Partly lifted in a container, 2026-09-19 (N1).** `lab/scripts/link_impair.py` is a userspace
relay in front of both planes — the UDP session and the static host's TCP — with one model for
each: a one-way delay applied in each direction, a bottleneck rate draining a tail-drop queue,
iid or Gilbert–Elliott loss, and a blackout or a NAT rebind on a control port. No root, no
`netem`. `lab/scripts/link_impair_check.sh` reads every lever back against arithmetic rather than
against another emulator, and each lever was mutated to watch it fail.

| Lever | Asked | Read |
| --- | --- | --- |
| Floor | — | 0.40 ms of round trip, delivery quantised to 0.5 ms |
| One-way delay | 20 / 40 ms | 41.0 / 81.7 ms round trip |
| Rate | 10 000 kbit/s | 9 948, nothing dropped |
| Queue | 10 packets | 10 of a 500-packet burst |
| Loss, iid | 5 % each way | 3 597 of 4 000 delivered (3 600 expected) |
| Loss, GE 0.07/14 | ~0.5 % mean | 7 913 of 8 000 (7 920 expected) |
| Blackout, dropping | 600 ms | 59 of a 200-packet, 2 s stream gone |
| Blackout, holding | 600 ms | none gone, the first held packet 602 ms late; 40 of 60 gone when the queue is 20 |
| Jitter, reordering | ±5 ms | 9.7 ms of p90-p10 spread; 40 of 200 arrive out of order |
| Jitter, ordered | ±5 ms | the same spread, 9.8 ms; none out of order, none later than delay + jitter |
| Rebind | mid-stream | none lost; the session survives it (`rebind-probe`) |
| Swallow | 300 ms, armed idle | opens on the next server datagram, not on the command: 30 of a 10 ms-paced echo taken, 0 client→server — the server's next flight, wherever it falls (row 61) |

**The two counts it was made to check**, fitted over round trips of 40, 80 and 160 ms so that the
relay's own floor and the crypto fall out as the intercept:

* **A cold open reaches its first byte in 4.01 round trips + 17.7 ms** — the count
  [`proposal-session-open.md`](proposal-session-open.md) states, now measured, on the native
  client. Its attribution is corrected there: the session is ready at **3.00 round trips**, and
  opening the control stream costs nothing. *Since lever 2 (2026-09-23) it is one fewer:* the same
  fit read **2.99 round trips + 17.8 ms** to first byte and 1.99 + 12.0 ms to the session on
  2026-09-24, and the check that still wanted 4 failed until it was changed to want 3.
* **One 250 KB ask on a fresh session is 5.59 round trips + 12.5 ms** — S7's ~5 flights out of a
  12 KB initial window, on a link with no rate limit at all, so it is slow start and not the link.

**What it still cannot do.** It forwards datagram by datagram, so it destroys any batching the
kernel would have done: **nothing about GSO/GRO or per-packet CPU taken through it is
admissible.** The TCP plane is relayed *above* TCP, where a dropped chunk would be data gone
rather than a segment the peer retransmits, so that plane shapes only — no loss, no blackout, and
no TCP loss-recovery number; its handshake is completed locally by the kernel, so the relay
charges the setup round trip rather than observing it (`--tcp-no-handshake` turns that off), and
TLS is not modelled. It is one thread, so delays under ~1 ms decide nothing and a rate far above
the ones in the table has to be re-checked against the relay itself first. It carries one client
at a time on the UDP plane. Everything else on this list still holds: the MTU above is unchanged,
and the server still sees a loopback socket.

**Two of its models were not a single radio leg's, 2026-09-19 (N2).** Each now has a mode, and
the default is still the model the earlier numbers were taken on:

* **Jitter.** `--jitter-mode reorder` (the default) adds an independent wobble after the rate
  queue and delivers by time, so packets pass each other — that is a path with more than one leg
  (carrier aggregation across legs, bonding), not LTE, 5G or Wi-Fi, which deliver in sequence on
  one. `--jitter-mode ordered` clamps each direction's delivery to non-decreasing: the same
  wobble, nothing overtaken. What neither stands in for is the *shape* of real jitter — both draw
  it independently per packet, where a radio's comes from grants and retransmissions and is
  correlated over milliseconds — and neither is a scheduler.
* **A blackout.** `--blackout-mode drop` (the default) discards both directions, which is a path
  that throws the outage away. `--blackout-mode hold` freezes each direction's rate clock instead,
  so what arrives during the outage queues behind it, the queue limit decides what survives, and
  the rest leaves in order the moment it ends — a link layer that buffers. **Which one a radio
  does is unverified here**: no primary source was found for the discard timer that decides it,
  and the two give a transport very different sessions (`transport-conclusions.md` §3).

**Calibrated against `netem`, 2026-09-19** (`lab/scripts/n1_netem_calibration.sh`). The run was on
the cloud rig, with the server and `cold_open` on its own loopback. For each round and delay the
link was either this relay or `netem` on `lo`, the arms interleaved, 5 rounds, the same three round
trips and the same fit:

| phase | relay: round trips, fixed ms | `netem`: round trips, fixed ms |
| --- | --- | --- |
| session ready | 3.00 [2.98–3.00], 7.4 | 3.00 [3.00–3.00], 2.8 |
| first byte | 3.99 [3.97–3.99], 10.2 | 4.00 [4.00–4.00], 3.3 |
| 250 KB ask, fresh session | 5.43 [5.42–5.45], 19.1 | 5.44 [5.43–5.56], 8.9 |

**On delay, the two agree to 0.01 round trips in every phase**, and the container's own fit (4.01,
5.59) sits beside them. So **a round-trip count taken through the relay can be read on its own**.
The relay's fixed cost (5–10 ms here, on a burstable host) cannot, and nor can anything this run
did not shape: rate, queue depth, loss and blackouts were not calibrated. The lossy cells on the
rig itself are §3 above (L3).

## 4. The reader never misses

A fully evicted 61 MB study still reports `fill_hits=237 fill_misses=0`. On this NVMe the
one-frame look-ahead completes before the reader needs it, so eviction moves the read earlier
without ever blocking — eviction is real (residency 1.0 → 0 → 1.0, verified per run), it simply
has nothing to bite on. Page-cache eviction is not the lever; force a miss through the store's own
test levers.

So the design question the read path exists to answer cannot be priced here: faulting inline on
the async executor against probing with `RWF_NOWAIT` and escalating to a blocking pool
([`serving-cells-and-run-variance.md`](serving-cells-and-run-variance.md) §The other read path).
**A rig that cannot make the reader miss cannot price either design.**

**What lifts it:** slower storage, a study far past the 15 GB of RAM, or a reduced
`read_ahead_kb` — already recorded as moving miss rate 2–15× in
[`disk-access/NEXT.md`](disk-access/NEXT.md) #6. Drivers: `lab/scripts/e2_miss_cost_cloud.sh`,
`lab/scripts/read_path_ab.sh`.

**On the cloud rig it does** (2026-09-18, L7, `lab/scripts/l7_read_path.sh`). A 4 GB study on its
954 MB host misses 76–97 % of spread asks, and each is ~1 ms slower at p50 than warm, 6/6. The
fill still does not miss. That host's stolen CPU caps what it can price at a median:
[`disk-access/EVIDENCE.md`](disk-access/EVIDENCE.md) §A study past RAM.

## 5. Natively, the send path is already at its ceiling

Browser-free, this server and a reference implementation of the same protocol shape both land at
225–284 MB/s with **99 %+ of `serve_us` inside `send`**; `locate` and `prepare` are ~0. All three
arms sat inside one arm's own run-to-run range, so this rig cannot separate them. A server-side
change that does not touch `send` has nowhere to show.

**What lifts it:** a regime where `send` is not the ceiling — a shaped link (§3), several sessions
at once, or a study that makes the reader work (§4).

## 6. One box, and only one statistic survives it

Contention only ever makes a run slower, so the low decile measures the server and the median
measures how busy the box was. The same binary on the same cell measured 13 474 µs in one batch
and 25 083 µs in another — **1.86× apart with no code change**. Spread across batches: min 1.10×,
p10 1.05×, p25 1.28×, median 1.86×.

* **Interleave the arms.** Sequential before/after measured +8.1 % on code that was a tie.
* **Quote p10 or the whole distribution**, never one batch's median against another's.
* p10's stability was established on the 87-frame cell and **does not carry down**: a 10-frame
  cell's total read 270 µs in one batch and 339 µs in another, 26 % apart.
* Browser page-clock values drift ~300 ms between sessions, so only ratios taken inside one
  interleaved campaign hold.

`serve_us` is not a speed, and it is not the server's alone: it closes when the send buffer accepts
the bytes and awaits only on flow control, which is the peer's. The same server measured 147.7 µs
per frame under a native driver and 67.6 µs under a browser. **Compare wall time, and name the
client.**

## 7. Nothing here is the target device

The product targets mobile clients on lossy wireless links. Every measurement above is a desktop
over loopback. The per-datagram receive cost of §1 runs on slower cores there and is **not
measured**; neither is per-frame decode cost on a phone. No mobile trade-off — decoder choice,
decoder width, cache format — is settled by a number taken here.

**What lifts it:** a real device. Nothing in `lab/` addresses it.

## 8. A driven Chromium does not prerender — lifted 2026-09-19

**Corrected 2026-09-19.** This section first said headless Chromium never starts a Speculation
Rules prerender because it has no visible tab. The mechanism was wrong. The browser's own reason,
read from the DevTools `Preload` domain, is `PrerenderingDisabledByDevTools`, and headful under
`Xvfb` gives the same answer: any DevTools session, Playwright's included, disables prerendering.
Launched with no driver, Chromium 141 prerenders in this container, headless included, three runs
of three.

**What it answered (S20).** While `document.prerendering` the target page loads, fetches its
config, imports the transport module and *calls* the dial at 44–85 ms; the WebTransport session
and the worker's first message both land ~20 ms after activation, never before. A prerender from
the worklist can therefore hide the page's fetches and script — the 3.6 round trips before the
dial that [`../lab/page-open/README.md`](../lab/page-open/README.md) counts — and none of the
dial's 3.0, and nothing that boots in a worker. The probe and its numbers:
[`../lab/prerender/`](../lab/prerender/).
