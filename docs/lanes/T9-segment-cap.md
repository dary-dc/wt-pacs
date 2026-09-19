# T9 — Packets per byte: the segment cap on a paced link, and the packet size

**Status:** open · **Needs:** the cloud rig, T0's capture · **Size:** one rig day, one config line

## The packet size, first

The browser reads one datagram per system call and acknowledges in user space, so its receive
cost is per packet; that is what caps Chrome's downloads above ~500 Mbps on a desktop (Zhang et
al., WWW 2024), far above the target link, so here it is a small free lever rather than a
ceiling. quinn's MTU discovery stops at 1 452 bytes; Chromium accepts 1 472 (`kMaxIncomingPacketSize`),
the IPv4 Ethernet maximum, and Firefox reads the interface MTU with discovery off. **Rule:**
where T0's capture shows a browser's `max_udp_payload_size` at or above 1 472, raise
`MtuDiscoveryConfig::upper_bound` to 1 472 for IPv4 peers — 1.4 % fewer packets for the same
bytes, no other cost; never above what the peer advertises. The server already fills each
packet with one STREAM frame, since a frame is handed to quinn as one buffer.

## The segment cap

The patched quinn sends up to 45 datagrams per `sendmsg` at 1452 bytes instead of 10, worth
−16 to −21 % CPU per ask on loopback where the pipe is full
([`../transport/why-these-changes.md` §9](../transport/why-these-changes.md)). quinn's pacer
caps a burst at `window × 2 ms / RTT`, floor 10 packets, and ends a batch when tokens run
out, so on a 20 Mbps / 50 ms path the 45 should never form (§10 entry 3, derived from
source). Fastly settled on 10 per burst for the same reason the loopback tail showed. The
change now lives as `patches/quinn-0.11.11-mtu-gso.patch`; whether it earns its keep on the
target is the question.

## Decision rule

At 20 Mbit / 50 ms and 100 Mbit / 30 ms, six repeats interleaved: if CPU per ask between the
patch and the same patch clamped to 10 is within 5 %, the change is inert on the target.
Then it stays only if a LAN deployment is planned, else the patch, `patched/quinn` and
`scripts/patch_quinn.sh` are deleted and `[patch.crates-io]` with them. Either way the
upstream knob ([quinn-rs/quinn#2189](https://github.com/quinn-rs/quinn/issues/2189)) is the
shape that removes the mechanism.

## Steps

1. Build the seg10 arm: the same patch with `.clamp(1, 10)` in `max_transmit_segments`,
   built into its own target dir; the seg45 arm is the tree.
2. `lab/scripts/rig_cells.sh segs <out.tsv> seg45 <bin> -- seg10 <bin10>` at the two profiles
   (`RATE_MBIT`, `RTT_MS`), and once at `RATE_MBIT=1000 RTT_MS=1` as the LAN control where the
   45 must show.
3. `runtime_ab_pair.py` on each: CPU per ask, asks per second, p99, `rcvbuf_drops`.

## Report

Three rows in `why-these-changes.md` §9 under a "on a paced link" heading.

## Stop conditions

The LAN control not separating (the rig's two cores may not reach the CPU-bound regime; then
the cell is void and the loopback figure stands as the LAN number).
