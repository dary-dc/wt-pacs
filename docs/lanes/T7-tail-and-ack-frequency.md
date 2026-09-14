# T7 — The depth-1 tail, and whether Chrome lets the server shorten it

**Status:** open, small · **Needs:** this VM and a stable Chromium · **Size:** half a day

## Question

A lost last datagram at depth 1 waits quinn's probe timeout, `srtt + 4·rttvar` plus the
peer's `max_ack_delay` (25 ms). Priced for the target it is about half a round trip plus
25 ms per lost tail and under a millisecond per frame at 1 % loss
([`../transport/NEXT.md`](../transport/NEXT.md) item 7). The 25 ms is the part a server could
remove: the ACK-frequency extension lets the sender ask its peer for a smaller `max_ack_delay`,
and although the IETF draft expired, Chromium's quiche and Google's servers deploy the
mechanism regardless. Whether a given Chrome advertises `min_ack_delay` decides whether quinn
can use it; quinn implements the draft-07 codepoint and counts the frames it sends.

## Decision rule

If Chrome advertises `min_ack_delay`: set `TransportConfig::ack_frequency_config` with a
requested `max_ack_delay` of 5 ms, and apply it if the depth-1 tail cell's p99 falls by 50 %
or more with CPU per ask not worse (fewer ACKs should make it better). If Chrome does not
advertise it, close the item: the tail is the arithmetic above and depth ≥ 2 is its answer.

## Steps

1. **Does Chrome advertise it.** T0's transport-parameter capture answers it directly
   (`min_ack_delay` present or not, per browser). Independently: log
   `connection.stats().frame_tx.ack_frequency` at session end (the `session reads` line in
   `pipeline.rs` is where a session's end is already reported) with `ack_frequency_config`
   set; run `lab/scripts/browser_getstats.py` or any browser cell. A count above zero means
   the extension negotiated. Chromium 141 here and 148 on the browser rig; the flag may differ
   by build. The browser pays for every ACK it sends, so a negotiated lower ACK rate is also
   the only lever on that side of its receive cost.
2. **The cell.** `runtime_ab.sh` on the drop-prone loopback cell (250 KB, depth 1, four
   sessions, the client socket at its 212 KB default), tree against tree with the config, six
   repeats: p99 and `rcvbuf_drops`. The native driver is a quinn peer and always negotiates,
   so this prices the mechanism; step 1 says whether a browser gets it.
3. **The trailing packet.** Only if step 1 says no: read `quinn-proto`'s packet builder for
   where a datagram queued after `write_all_chunks` lands. If DATAGRAM frames are written
   before STREAM frames in the next packet, it lands at the front of the batch and the idea
   is dead; if it can be placed after the tail, prototype and run the same cell.

## Report

The negotiated yes/no per Chromium version in `docs/CLIENTS.md`; the cell in
`why-these-changes.md` §10 entry 2.

## Stop conditions

None; the item is small either way.
