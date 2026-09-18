# What this rig cannot measure

Every number in this repository was taken on one 8-core workstation over loopback
(`intel_pstate`/`powersave`, 15 GB RAM, NVMe with `read_ahead_kb=128`, btrfs on LUKS,
Linux 7.1.13). Seven limits bound what it can decide. Each is stated with the evidence that
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
