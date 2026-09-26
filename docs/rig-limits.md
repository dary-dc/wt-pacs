# What this rig cannot measure

Every number in this repository was taken on one of three hosts:

* **the workstation** — 8 cores (`intel_pstate`/`powersave`), 15 GB RAM, NVMe with
  `read_ahead_kb=128`, btrfs on LUKS, Linux 7.1.13, over loopback. It is the timing rig unless a
  section says otherwise;
* **an agent container** — 4 vCPU, no root. Memory, heap high-water marks and correctness are safe
  there; a millisecond taken there is marked as container-measured, and decides nothing alone
  unless its section says why it can (§1's browser campaign, §3's relay);
* **the cloud rig** (§9) — a 2-vCPU VM, where `sch_netem` loads, for shaped links.

Eight limits (§1–§8) bound what they can decide. Each is stated with the evidence that established
it and with what would lift it — written for an agent working somewhere else. §9 is the cloud rig
and how a campaign runs there; §10 is where the raw rows went.

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
user space, and ships with batched receive and GRO off; the workstation's build (148) carries no
flag to turn them on. Chromium 141 also advertises a `max_udp_payload_size` of 1 472, so no server setting
sends it a larger datagram (measured through a relay with the server's bound at 4 000 and 8 972:
none above 1 472 in 85 k). Published measurements agree on the shape: Chrome's HTTP/3 download
reached 478 Mbps against ~900 Mbps over TCP on a 1 Gbps desktop, and 63 s against 30 s on a
Pixel 5 over 5G (WWW '24).

**What lifts it:** a link slower than the receiver, so the wire binds before the receive path does
(§3). The native drivers in `lab/` avoid it entirely, at the cost of no longer measuring a browser.

### What a browser receives, with the browser on the wire (T12)

Measured 2026-09-19 in an agent container: 4 vCPU Xeon 2.8 GHz, headless Chromium 141, loopback,
`rmem_max` 4 MB. Fills of 800 frames at 250 KB and 32 KB; on-demand at depth 1 and 4, 250 KB,
320 asks. Six repeats, arms interleaved with the order reversed, paired against `shared` per
repeat. `lab/scripts/browser_receive.py` reads per-thread CPU from `/proc/*/task/*/schedstat`
around each run and drops from `Udp: RcvbufErrors`; `lab/scripts/browser_reads.py` reads what each
`read()` returns. The client is `client/transport-ts` on the main thread with the default reader
and no window. Every run delivered every frame, and the box spent 2.0–2.2 of its 4 cores, so it
did not saturate. The server arms were built from the transport branch's per-core-endpoint tree
(`8b903cd`), since parked: the browser's side of every number is independent of that, the
server's own CPU per MB is not.

**Where the cost sits** — CPU per MB received, `shared`, medians of six (ms / MB):

| cell | server | network-service IO thread | renderer main thread | renderer other | MB/s |
| --- | --: | --: | --: | --: | --: |
| fill, 250 KB | 3.54 | **6.59** | 2.51 | 1.24 | 151.6 |
| fill, 32 KB | 4.00 | **6.58** | 3.91 | 2.10 | 143.9 |
| on-demand, 250 KB, depth 1 | 2.53 | 6.68 | 3.26 | 1.29 | 114.0 |
| on-demand, 250 KB, depth 4 | 2.37 | 6.17 | 2.82 | 1.08 | 156.0 |

In every `shared` fill the network-service IO thread ran a full core for the whole fill (0.989–0.995
of the wall at 250 KB, 0.94–0.97 at 32 KB), and nothing else did. 6.6 ms per MB is ~9.5 µs per
datagram whatever the frame size: Chromium's cost per packet, on a different CPU from the 9.8 above.
The renderer's main thread — this repository's client, its reads and its one copy, plus Blink's
stream machinery — fits ~50 µs per frame plus 2.3 ms per MB: 37–41 % of a core at 250 KB, 46–65 %
at 32 KB.

**So no code in this repository raises what a browser receives per second on a fast link**: the
bound is in the network service, one process away from anything a page or a Worker runs. What the
client decides is the renderer's 2.5–3.9 ms per MB, which is what the page has left for decode and
paint. On the target link (2.5 MB/s) the network service costs 1.7 % of a core and none of this
binds; there the bound is bytes per frame
([`adr-resolution-fitting-for-large-frames.md`](adr-resolution-fitting-for-large-frames.md) §6) and
decode.

**Every fill overflows the browser's socket once, and the send window is the lever, not the
batch.** Chromium asks for a 1 MiB receive buffer; `SO_RCVBUF` reads 2 097 152 with `rmem_max` at
4 MB and 425 984 on a Linux-default host (`rmem_max` 212 992). Datagrams dropped per run, and the
paired change against `shared`:

| fill | `shared` | 768 KB send window | `rmem_max` 212 992 | 10-segment batch | `pool:4` | per-frame |
| --- | --: | --: | --: | --: | --: | --: |
| 250 KB (~138 k datagrams) | 1 348 | **0** (6/6) | 369 (−76 %, 6/6) | 1 405 (+0.6 %) | 1 206 (−8 %, 4/6) | 1 286 (+1 %) |
| 32 KB (~18 k datagrams) | 1 660 | **0** (6/6) | 338 (−79 %, 6/6) | 1 512 (−7 %, 4/6) | 1 230 (−20 %, 6/6) | 1 041 (−37 %, 5/6) |
| on-demand, either depth | 0 | 0 | — | 0 | — | 0 |

The count is the same in a 0.2 s fill as in a 1.4 s one, so it is one event, not a rate. Traced
with the socket's drop counter polled every 2 ms through three 250 KB fills, every drop lands in
one burst 68–97 ms into the fill — 1 190–1 330 datagrams in ~25 ms, at most ~120 more in the
second after. The sender's window outgrows the socket buffer once the receive thread, already at
a full core, falls behind; the buffer overflows and Cubic backs off. A smaller buffer loses
*fewer*, because the overflow comes at a smaller window; a 768 KB send window never lets the bytes
in flight reach the buffer. The 45-segment batch is not the cause: 10 segments drop the same.
Throughput does not follow the drops — the 768 KB window is +4.7 % and +0.3 % (3/6 each), a tie.
On the target link 768 KB is five times the bandwidth-delay product and never binds, but at depth
4 it cost the server +17.8 % CPU per MB (6/6). **Recorded as the drop lever for a fast-link
deployment, not adopted.** Nor is a client-host `rmem_max`: the Linux-default buffer costs no
resolved throughput (−5.9 %, 3/6). The workstation saw the same event earlier: 403–559 drops per 3.6 MB
fill from this server and from another stack alike, quinn's `lost_packets` matching the kernel's
count one for one, and the 768 KB window removing them in 4/4 without moving the ask or the page
clock (n = 4, interleaved).

**Send shapes, paired against `shared`:**

| arm | fill 250 KB, MB/s | fill 32 KB, MB/s | on-demand d1, per ask | on-demand d4, per ask | network service ms/MB | renderer main ms/MB |
| --- | --: | --: | --: | --: | --: | --: |
| per-frame | **−26.0 % (6/6)** | **−62.2 % (6/6)** | **+31.9 % (6/6)** | **+35.3 % (6/6)** | +35 % at 250 KB, +177 % at 32 KB (6/6) | +35 % / +159 % (6/6) |
| `pool:2` | −1.0 % (4/6) | +14.7 % (4/6) | — | — | tie | +9 % (6/6) at 250 KB |
| `pool:4` | +4.4 % (3/6) | +5.1 % (5/6) | — | — | tie | +20 % (6/6) at 250 KB, +11 % (4/6) at 32 KB |
| 768 KB send window | +4.7 % (3/6) | +0.3 % (3/6) | +0.7 % | +0.3 % | tie | tie |
| 10-segment batch | +1.2 % (2/6) | +5.4 % (4/6) | **−2.6 % (6/6)** | −3.8 % (4/6) | tie; −3.4 % (5/6) at d4 | tie |
| `rmem_max` 212 992 | −5.9 % (3/6) | −3.0 % (3/6) | — | — | +7.5 % (3/6) | +6 % (4/6) |

The rule, fixed before the run, was +10 % MB/s at 5/6 with neither thread's CPU per MB up by more
than 5 % and no more drops. **No arm clears it, so `shared` and quinn's windows stay the defaults.**
What is established: **a stream per frame costs a browser receiver a quarter of its throughput at
250 KB and three fifths at 32 KB, and a third more latency at depth 1** — the network service pays
per stream what it pays per packet, and the renderer opens a reader per stream; the 42 ms over 87
frames above is the same finding. A pool of 2–4 is a throughput tie that costs the renderer 9–20 %
more CPU per MB. The 10-segment batch ties everywhere but a 2.6 % (6/6) shorter ask at depth 1,
too small to move a default from loopback. Under loss the stream shapes have their own case,
which is not this one ([`adr-stream-shape.md`](adr-stream-shape.md)). On the unified tree the
45-segment cap is a build-time opt-in, so `shared` sends quinn's stock 10-segment batch unless
built with the patch.

**How the browser hands a frame to the page**, 80 frames on one shared stream: with the default
reader a 250 KB frame arrives in 4.9–5.3 `read()`s of 39–47 KB median, 55–73 KB at p90 and up to
256 KB — the data pipe coalesces whatever has landed, so **a 32 KB frame arrives in 0.6–0.8
reads**, one read often carrying two frames. A BYOB reader asking for the whole frame
(`read(view, { min })`, which Chromium 141 honours) takes exactly 2 reads per frame at either size:
fewer at 250 KB, three times more at 32 KB, and the wall time is a tie at both. So BYOB's per-frame
read shape is right for large frames and wrong for small ones; the coalescing the default reader
already does is what a BYOB path has to keep.

What remains for a fast-link browser is 20 bytes per packet (`MtuDiscoveryConfig::upper_bound(1472)`,
1.4 % fewer datagrams) and the send window against the one overflow. **The workstation repeats the
fill cells on its own CPU before either is acted on.**

## 2. On a fill, the finish is the decode queue, not transport

Measured 2026-09-11 in the workstation's browser, per frame across three decoders: **148.5 ms waiting for a
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

**What lifts it:** the cloud rig (§9). `lab/scripts/cloud_netem.sh` shapes rate, one-way delay and
loss on the server's egress, with an iid and a Gilbert-Elliott burst model;
`lab/scripts/e0_netem_validation.sh` compares the real path with an emulated one of the same RTT
and rate ([`adr-client-window-depth.md`](adr-client-window-depth.md) §E0).

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
  *Priced 2026-09-24 (CC1):* in Chromium BBR fills 12–19× faster under 1–3 % loss, and pays for it
  with ~45 % of its datagrams dropped at a 120 ms queue or 294 ms of standing queue at a 900 ms one;
  the default stays Cubic — `transport/transport-conclusions.md` §1.
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
  [`ARCHITECTURE.md`](ARCHITECTURE.md) states for the session open, now measured, on the native
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
at a time on the UDP plane, forwarding to whichever client it heard from last. So a dial made while
the previous connection still sends can have its server's first flight delivered to the old port,
and pays a handshake probe timeout of ~1 s. Dial in sequence only once the last connection is
silent (RS1, 2026-09-24). Everything else on this list still holds: the MTU above is unchanged,
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
  and the two give a transport very different sessions (`transport/transport-conclusions.md` §3).

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

So the design question the read path exists to answer cannot be priced here from a natural miss:
a major fault taken inline on the async executor thread (mmap) against a probe with `RWF_NOWAIT`
that escalates to a blocking pool ([`disk-access/adr.md`](disk-access/adr.md)). On hardware where
a major fault costs milliseconds the first should lose badly, but this box never produces one.
**A rig that cannot make the reader miss cannot price either design.**

**What lifts it:** slower storage, a study far past the 15 GB of RAM, or a reduced
`read_ahead_kb` — already recorded as moving miss rate 2–15× ([`disk-access/adr.md`](disk-access/adr.md)
§8). Drivers: `lab/scripts/e2_miss_cost_cloud.sh`, `lab/scripts/read_path_ab.sh`.

**On the cloud rig it does** (2026-09-18, L7, `lab/scripts/l7_read_path.sh`). A 4 GB study on its
954 MB host misses 76–97 % of spread asks, and each is ~1 ms slower at p50 than warm, 6/6 with
disjoint ranges. The fill still does not miss: 1 % cold, as warm. That host's stolen CPU caps what
it can price at a median — every cell, warm included, has a p99 of 60–100 ms
([`disk-access/adr.md`](disk-access/adr.md)).

## 5. Natively, the send path is already at its ceiling

Browser-free, with native drivers on both sides (connect, ask, drain, end, no decode) on a 61.18 MB
study of 237 frames of ~259 KB, evicted before every run: this server and another stack serving
the same protocol shape both land at 225–284 MB/s with **99 %+ of `serve_us` inside `send`**;
`locate` and `prepare` are ~0. Cold, n = 5 per arm, all three arms sat inside one arm's own
run-to-run range, so the workstation could not separate them. A server-side change that does not touch
`send` has nowhere to show.

**Warm, n = 20, with a 3 s settle gap after each run, fill separates.** On the 61 MB study this
server fills **6.2 % faster** than the other stack (median paired Δ, 95 % CI −12.3 … −2.2 %,
17/20 pairs) and spends **10.9 % less server CPU** (−13.8 … −3.6 %, 16/20). On-demand at depth 1
ties (+0.9 %, 8/20). A 3.6 MB study stays undecided: its 25–50 ms runs move 22–33 % with their
place in the pair. Cold was not re-run at n = 20. Each side drives its server with its own native
client, so this compares server plus protocol stack.

**What lifts it:** a regime where `send` is not the ceiling — a shaped link (§3), several sessions
at once, or a study that makes the reader work (§4).

## 6. One box, and only one statistic survives it

Contention only ever makes a run slower, so the low decile measures the server and the median
measures how busy the box was. Measured 2026-09-10 on the 87-frame fill (~41.3 KB frames, 3.59 MB,
page-cached: `miss_rate=0.0` in all 240 runs): the same binary on the same cell measured 13 474 µs
in one batch and 25 083 µs in another — **1.86× apart with no code change**. Spread of each
statistic across four batches: min 1.10×, **p10 1.05×**, p25 1.28×, median 1.86×.

* **Interleave the arms.** Sequential before/after measured +8.1 % on code that was a tie, and a
  median from one batch against a median from another produced a false 30 %-against-43 %
  "improvement".
* **Quote p10 or the whole distribution**, never one batch's median against another's. The
  percentiles are *across runs*: each run reports one `totals.serve_us`. `median / p10` = 1.84×
  inside a cell is run-to-run spread and says nothing about a single run. Browser-driven runs are
  tighter (1.23×), so they need fewer repeats.
* p10's stability was established on the 87-frame cell and **does not carry down**: a 10-frame
  cell's total read 270 µs in one batch and 339 µs in another, 26 % apart.
* **Leave the box idle between runs.** Back to back, the second run of a pair ran up to 60 %
  slower. A cell whose order effect exceeds 10 % is not read.
* **Report the median with its range and the rounds better out of n**, never a bare median. A
  clean sweep with disjoint ranges is a result; 4/6 or 5/8 is unresolved, and is reported so.
* Browser page-clock values drift ~300 ms between sessions, so only ratios taken inside one
  interleaved campaign hold.

**`serve_us` is not a speed, and it is not the server's alone.** It covers the read plus
`write_all` into the `SendStream`, which returns when the send buffer accepts the bytes and awaits
only on flow control — the peer's. At depth 1 the serve spans are a ninth of the session wall
(p10 322 against 2 982 µs), because the frame goes out while the client waits; in a fill the pipe
is always full and they are 0.94 of it (`serve_total ≤ wall` in 80/80 runs). On one interleaved
depth ladder `serve_us` p50 climbs 15.0 → 156.5 µs from depth 1 to 87 while wall per frame falls
276.6 → 221.1 µs. And the driver moves it: the same server measured **147.7 µs per frame under a
native driver and 67.6 µs under a browser** on the same fill (p10), because the 3.59 MB study fits
the send window a browser advertises — inferred from the two numbers and the source, not isolated.
A 61 MB fill the server completes in 184 ms natively was credited 677 ms of `serve_us` under the
browser, which sat inside `send` while the page decoded. **Compare wall time, and name the client.**

To re-run the cells: `server_ab --mode fill --asks 87` and `server_ab --mode on-demand --depth 1
--asks 10` against `exact-server --stream-mode shared` built with `--features telemetry`
(`WTPACS_TELEMETRY=1`), one server and one session per run; in a browser,
`/harness/?autorun=1&stream_mode=shared&frames=87&cell=fill` (or `&cell=ondemand&d=1&n=10`) on
`server/dev-server.py`, after `server/scripts/gen_dev_cert.sh` — Chromium refuses a dev certificate
older than ~14 days. Read `summary.totals.serve_us` from each run's JSON and take the percentile
across runs.

**Instrument traps**, each of which produced a wrong answer here before it was caught:

* **A baseline of your own making.** LTO first measured −17.8 % against a build the lane had
  rebuilt with a newer, slower compiler; against the pinned toolchain it is worth nothing. Record
  the toolchain of anything rebuilt.
* **A background process moving the ground.** Check the running process's flags before and after
  each arm, and keep a control that is *expected* to fail, so a rig that cannot observe the failure
  is caught rather than believed.
* **The clock floor.** `performance.now()` is 5 µs under cross-origin isolation, so a one-tick
  difference is not a finding; each context has its own `timeOrigin`, and only
  `timeOrigin + now()` compares across threads.
* **Twenty-four samples are not a tail.** A p99 read 415 ms at 24 connects and 1 335 ms at 200.
* **A ratio at one delay is not a round-trip count.** Fit the milestone against two or three round
  trips; the slope is the count and the fixed costs fall into the intercept.
* **A closed-loop probe loses at most one packet per outage**, then waits on its own timeout.
  Anything measuring loss or a blackout is open loop.
* **A relay that reads one datagram per wakeup drops bursts**, and the loss looks like the model's.
  Drain the socket to `EWOULDBLOCK` and raise `SO_RCVBUF`.

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

**Nor does every build resolve like a browser** (2026-09-26). Playwright's headless shell never
turns on Chromium's own DNS client: it asks the system for A and AAAA and never for an HTTPS record.
Full Chromium does, and asks for one on every `https://` host and port — unless a proxy is set, when
it resolves nothing. A lab lane about names runs the full build with `no_proxy` covering them
([`../lab/page-open/README.md`](../lab/page-open/README.md) §The static plane).

## 9. The cloud rig: two cores, and a shaped link

It exists because `sch_netem` loads on a VM and not in an agent container.

### The host

2 vCPU (EPYC 7551), **burstable**: ~2.6 s of CPU stolen over a 2.1 s fill, so its tails are the
hypervisor's and nothing past a median is claimed from it. 954 MB RAM, Ubuntu 24.04. The block
volume is throttled: ~50 MB/s sequential, random 256 KiB reads at 1.3–4.9 ms p50 at depth 1
(page cache bypassed), p99 up to 219 ms at depth 4. **Only UDP 4435 reaches it from outside**
(4436 and 4437 pass the host firewall, but no session arrives); a long-lived field server holds
4437 and must stay off any shaped path. The WAN from the workstation is ~28 ms RTT and 27–58 Mbit,
varying run to run.

It **cannot build** and has no `git`: binaries are built on the workstation and copied, the
campaign tree is copied, and the dev certificate and fixtures (both gitignored) are generated on
the rig (`server/scripts/gen_dev_cert.sh`, `lab/scripts/gen_tf_fixtures.sh`).

### Who can reach it

**Not a cloud agent.** That environment has no key, no `ssh` binary, and its outbound traffic goes
through an HTTPS proxy that does not open port 22 (2026-09-15). A campaign on the rig is run from
the workstation, by a local agent or the owner, and comes back as commits.

The scripts read the key from `SSH_KEY` (`lab/scripts/cloud_common.sh`). There are two keys, by
role — one for the human and local runs, one for an agent — so the agent's can be revoked without
touching human access. **Never hand the human key to an agent environment.** An exposed key is
rotated on exposure, not on evidence of use:

1. Establish scope by testing which hosts and accounts accept it, not by assuming.
2. Mint the replacement and verify it works — including `sudo` — before removing anything, so
   there is no lockout window.
3. Remove the old public key from **every** account on every host, and any `authorized_keys`
   backup beside it. **Removing it from one account is not revocation**: in the first rotation the
   same key was also installed for two other accounts, both with root, and still authenticated.
   `ssh-keygen -lf` over `/root/.ssh/authorized_keys` and `/home/*/.ssh/authorized_keys` lists
   what each account accepts.
4. Prove denial per account: the old key must get `Permission denied` from each.
5. Delete the exposed secret from wherever it was pasted.

### Running a campaign there

* **One campaign at a time.** A second `tc qdisc replace` silently corrupts the first, and the
  host is two cores.
* **Run cells as `sudo unshare --net -- lab/scripts/…`.** The rig sets
  `kernel.apparmor_restrict_unprivileged_userns=1`, so the unprivileged
  `unshare --user --map-root-user --net` form of `lab/scripts/verify_netns_netem.sh` fails on
  `/proc/self/uid_map`; prove shaping with `sudo unshare --net -- tc qdisc replace dev lo root
  netem delay 20ms` and check the host's own `lo` stayed `noqueue`.
* **Prove the shaping before reading a number through it**: goodput caps at the netem rate and the
  server's loss count matches the configured rate (§3's instrument notes).
* **Pre-flight off the rig.** `lab/scripts/stream_shape_preflight.sh` runs a cell end to end on
  unshaped loopback (marked `UNSHAPED`, which the pooler refuses) and checks every void check fires
  on data built to trip it. Three of the five faults of the 2026-09-15 campaign would have surfaced
  there instead of on the rig.
* **A VOID cell is a design error, never a cell to re-run with more repeats** — raising repeats on
  it manufactures a result. The first stream-shape campaign found six such faults, every one in
  the cell rather than the rig or the arms: the client pacer left at its default (`window-harness
  --read-bps` is 2 Mbit/s unless set to 0, which is required whenever `tc` shapes), a reader
  stepping faster than the link delivers, a cold page cache pooled with warm repeats, a step
  interval taken from the link's label rather than its measured rate, a void check on a misread
  field, and an estimator that flattered the arm that missed most. One claim was published and
  retracted within the hour (a 3.5× throughput gap that was one 4-second sample), and a prediction
  called falsified at six repeats was un-falsified at eighteen.
* **`on_time_rate` and `late_*` are closed-reader metrics**: under `--reader-mode open` they are
  structurally zero, and `censored_frac` is the open reader's distress signal.
* **Pull between cells.** A cell run on a superseded script is rig time spent reproducing a known
  fault.
* **A CPU-bound claim needs a LAN control.** A cell at 1 000 Mbit / 1 ms must show the effect the
  campaign is about; if it does not, the two cores never reached the CPU-bound regime, the cell is
  void, and the loopback figure stands.

### What comes back

Raw rows and an execution log, in their own commit, **with no interpretation in the same commit**:
the commit the binaries were built from and the arms' binary names; `uname -r`, core count and the
`tc qdisc show` line the cell actually installed; every deviation and retry; the pooler's or
`lab/scripts/runtime_ab_pair.py`'s output verbatim, VOID included. Whether an arm passed is
decided against a rule written before the run. The reading goes into the document that owns the
subject.

## 10. Rows that left this tree

`docs/measurements/` was removed on 2026-09-26; every raw row quoted above is in the history before
that commit. One earlier campaign lives only on a tag:

* **N6, WASM against TypeScript** (2026-09-06, tag `archive/n6-wasm-vs-ts-2026-09`, report
  `docs/client-runtime-comparison-2026-09-06.md` there). Still citable: the "extra full-frame copy"
  mechanism is **not confirmed** — the WASM `deliver` penalty is a fixed per-frame boundary cost,
  not byte-proportional; under the same batch timeout WASM delivered 80/80 where TypeScript lost
  29/80, the constant armed at a different point; and a first load of the WASM client is ≈ 30× the
  bytes of the TypeScript one. **Stale:** `deliver_us` +25 to +58 µs per frame was measured before
  the WASM receive path gained typed reads, cached JS keys and a right-sized `RecvBuf`; a new
  comparison is a new campaign.
