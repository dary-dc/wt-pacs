# Transport optimisation — conclusions

What this lane decided. Product source is the chunked send path, `--stream-mode`
default `shared`, `--prefault true`, Cubic default, windows at quinn defaults.

The full campaign write-up (method, reviews, TSVs, reproduce commands) is on tag
`archive/transport-lab-2026-09` at this same path:

```bash
git show archive/transport-lab-2026-09:docs/transport/transport-conclusions.md
```

---

## The answer

| decision | verdict |
| -------- | ------- |
| **Congestion controller** | **Two opposite answers, depending on which kind of loss the link has.** Congestive → **Cubic**. Radio/exogenous → **BBR**. Both directions large and separated. **Default to Cubic** until the mix is measured |
| **Stream shape** | **One shared stream — the binary defaults to it.** In simulation, per-frame is 3.5× worse at 64 KB and 8.5× worse at 250 KB. On a real path the 64 KB cell is noise-dominated; the 250 KB cell separates: per-frame is **5.76× worse**, 3/3, and the absolute penalty matches the simulator to 1.6 %. No cell on either rig separates in per-frame's favour |
| **Fixed-N pool** | Untested. R6 makes it less promising: retransmit-deferral cost grows with N, and the winning endpoint is N = 1 |
| **Initial congestion window** | Leave at quinn's default — ≤ 7 %, ranges overlapping |
| **GSO segment cap 10 → 32** | Density, not latency: +17 % throughput / −21 % CPU/byte on loopback at n = 1; **not confirmed on real hardware** (−1.0 % / +8.1 %, overlapping). **Not applied.** The cap is `quinn`'s `MAX_TRANSMIT_SEGMENTS`, not a server flag |
| **Chunked send path** | Keep. −6…−14 % CPU/byte, and it is what contains a stalled client (below). The only send path in `server/` |
| **Flow-control windows** | Hygiene on this send path. A client that asks for 25 MB and stops reading costs **180 kB**. Left at quinn defaults |

Rejected arms (`copy` / `split`, `--ask-priority`, MTU / GSO / socket knobs) are not in
`server/`. `--stream-mode per-frame` stays a product flag.

---

## 1 · Controller: two answers, which applies is measurable

Every flip in this work happened because a campaign sat in one loss regime and the result
was read as general. The two regimes were run side by side, each verified by queue-drop
counters.

**Congestive** (queue overflow is the only loss) — Cubic wins, and the margin is at high
RTT. At 600 ms / 8 Mbps: Cubic 941 ms vs BBR 1535 ms (BBR is n = 2; Cubic's worst repeat
still beats BBR's best). BBR also drops 30–100× more packets at the bottleneck.

**Exogenous** (1 % radio loss, queue never drops) — BBR wins by roughly half at both RTTs
(−48 % at 50 ms / 20 Mbps; −44 % at 600 ms / 8 Mbps).

5G, satellite and WiFi have both kinds. The diagnostic is: is loss correlated with
queueing delay? RTT rising before loss → congestive → Cubic; loss with RTT flat → radio →
BBR.

**Default Cubic** until that mix is measured: it is the incumbent; it is the safer error
(63 % worse if wrong, against 48 % the other way); and BBRv1's queue-drop excess is
inflicted on other traffic sharing the link.

That neighbour cost is measured. Two flows, one shared 5 Mbps bottleneck, Oracle rig:

| bottleneck buffer | our flow | competing TCP Cubic | our share |
| --- | --- | --- | --- |
| shallow, ≈48 ms | QUIC BBR | 0.03 Mbps | 99.4 % |
| shallow, ≈48 ms | QUIC Cubic | 1.46 Mbps | 70.0 % |
| deep, ≈1.2 s | QUIC BBR | 2.12 Mbps | 55.1 % |
| deep, ≈1.2 s | QUIC Cubic | 1.07 Mbps | 76.8 % |

The same TCP flow takes 4.5 Mbps alone against the shallow bottleneck — BBR starves it
150×. In a shallow buffer (an access link) BBR takes essentially everything. Cubic is not
innocent (70–77 % from a flow that can take 90 % alone). BBR's 48 % latency win in the
radio regime still stands; the Cubic default is a case about people who are not our users.

---

## 2 · One shared stream

The textbook argument (per-frame confines loss to one frame) was pre-registered as H4 and
lost. quinn's `retransmit()` re-queues with `push_pending` — behind every already-queued
stream, regardless of fairness. With one stream, recovery goes out ahead of newer data on
that stream. With per-frame, the lost stream goes to the back of the queue and waits
behind other frames' full backlogs.

| | shared | per-frame + FIFO | ratio |
| --- | --- | --- | --- |
| netsim, 64 KB | 182.2 ms | 637.1 ms | 3.5× |
| netsim, 250 KB | 372.7 ms | 3159.5 ms | 8.5× |
| real path, 64 KB | — | — | not a result (realisation noise 4.32×) |
| **real path, 250 KB** | **594.7 ms** | **3426.2 ms** | **5.76×** |

The mechanism predicts an *absolute* penalty (wait behind D−1 whole frames). That penalty
reproduced across rigs: 2787 ms on netsim vs 2832 ms on the real path, **1.6 % apart**.

X3L on the Oracle rig was the deciding cell, pre-registered before it ran: if `shared`
separates with the stranding gate passing, flip the default. It did (3/3, 10.8–29.0 MB
stranded, zero censoring). The binary defaults to `shared`. `per-frame` remains a product
flag.

`send_fairness(true)` is worse than FIFO in every cell it was tried — a scheduling
penalty, not a HOL finding. The flag is gone from the product crate.

A closed-loop reader cannot produce head-of-line blocking (stranded bytes: 0.00 MB). No
stream-shape result from `--reader-mode closed` is admissible. The harness default is
still `closed`; campaign cells that ask this question use `open`.

---

## 3 · Density, send path, windows

Measured on loopback, never through the path simulator (which forwards datagram-by-datagram
and destroys GSO batching).

| item | effect |
| ---- | ------ |
| GSO cap 10 → 32 | +17.2 % / −20.9 % CPU/byte at 250 KB, n = 1; real-hardware re-run −1.0 % / +8.1 %, overlapping. Not applied |
| Chunked send path | −6…−14 % CPU/byte at every rate. Only path in `server/` |
| Head + first window, one `write_all` | First application write carries payload. Localhost ask→complete: 32 KB tie (+0.9 %, 3/8); 250 KB **−4.0 % p50, 8/8**. Real-path first-byte **not measured**. §3a |
| Per-frame prefault hop, warm cache | costs 10 % throughput, 14–34 % CPU/byte |
| `aws-lc-rs`, ACK frequency, socket buffers, initial MTU | ≤ 3 % or nil |

**The GSO cap is not a server flag.** `MAX_TRANSMIT_SEGMENTS` is a compile-time constant
in quinn. The lab numbers were taken against a patched crate *outside this tree*. Never
derive the cap from `max_gso_segments()`: the binding limit is 65 527 bytes; exceeding it
returns `EINVAL` and `quinn-udp` disables offload permanently for that socket.

**A stalled client does not approach the 10 MB `send_window`.** `window-harness --mode stall`
asks 400 frames (25 MB) then stops reading. On chunked + shared the server holds **180 kB**.
On the old `copy` + per-frame path the same client cost **6.8 MB**. Chunked is a memory
property, not only a CPU one. Windows stay at quinn defaults.

### 3a · Headed first window, this host

T2-local (4 vCPU KVM, localhost, no shaping). `server_ab` on-demand depth 1, warm,
shared stream, arms interleaved, order reversed each repeat, n = 8. Metric is
ask→envelope-complete — not first payload byte. A real-path first-byte figure is
**not measured**.

| cell | before p50 | after p50 | paired Δ | signs |
| ---- | ---------: | --------: | -------: | ----- |
| 32 KB × 80 | 70 µs | 70 µs | **+0.9 %** | 3/8 faster |
| 250 KB × 40 | 344 µs | 321 µs | **−4.0 %** | 8/8 faster |

32 KB is a tie (the frame is one window; two writes vs one stays inside run-to-run).
250 KB drops one `write_all` (five → four) and the paired median is −4.0 %, every
repeat the same sign. That is not the 28.5 % disk-access bar; it is the sign of
one fewer wakeup on a frame that already spans several windows. The extra copy of
the first 64 KiB did not show up as a 32 KB regression.

---

## 4 · Larger levers, still above this layer

On a real-looking link a third to a half of steps wait on the network. These still
dominate the absolute millisecond figures:

1. **Progressive delivery** — a truncated HTJ2K prefix is a viewable image.
2. **Cache size and eviction** — a 64-frame cap on a 500-frame series costs +65 % offered
   load for +2.8 pp of misses.
3. **Ask window depth** — [`adr-client-window-depth.md`](../adr-client-window-depth.md).

---

## 5 · Confidence (compact)

T2 throughout — n = 3 except where a row says otherwise. One arm is n = 2: BBR in the
congestive 600 ms cell.

| conclusion | strength |
| ---------- | -------- |
| Controller depends on loss regime | Strong for the ordering; magnitude of the 600 ms cell is n = 2 for BBR |
| Which regime the deployment mix is in | Unknown — needs client telemetry |
| Keep shared stream | Strong, and on real hardware at 250 KB (5.76×, 3/3) |
| Per-frame is worse because of retransmit deferral | Strong — absolute penalty reproduced to 1.6 % across rigs |
| GSO cap worth 17 % | Weak — loopback, n = 1, fixture-dependent; real path overlapping |
| Windows never approached on chunked | Moderate — 48 rows, T2 loopback, N ≤ 16 |

What would overturn the shipped defaults: a cell where per-frame + FIFO separates in its
favour (none found), or client telemetry showing the loss mix is overwhelmingly radio
(which would reopen the Cubic default, not the stream default).
