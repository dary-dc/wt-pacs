# An ask that arrives during a fill

Cloud lane L16. A viewer filling its cache in the background still has to paint what the user asks
for now. The lane asked how long that ask waits while the fill keeps sending, and whether giving its
stream a higher priority would shorten the wait.

**It does not wait for the fill, because the fill stops.** The ask does not overtake a running fill;
it replaces one. That is a decision the server already makes, in the planner, before anything
reaches the wire — so the priority question the lane was written around does not arise.

## Why there is nothing to prioritise

`server/src/transport/planner.rs` — while a fill is running, any ask in hand ends it:

```rust
if let Some((frame, to)) = self.fill {
    if self.in_hand.is_empty() { /* … serve the next fill frame … */ }
    self.fill = None;          // an ask is waiting: the fill is discarded, not paused
    self.count_this_fill = false;
```

`self.fill = None` is unconditional and there is no saved position, so the fill does not resume
either. Two tests already state it: `a_data_request_during_a_fill_ends_it_and_is_served_next` on the
planner, and `request_frame_during_fill_switches_to_on_demand` on the wire, whose failure message is
"fill kept reciting after the mode switch".

So the two never share the connection, at equal priority or any other. A stream priority orders
streams that are competing to send; here the fill's stream has stopped being fed.

## What the ask actually costs

`lab/window-harness/src/bin/ask_during_fill.rs`, browser-free, against `exact-server` in its default
shared mode over a synthetic 200-frame series of 250 KB frames. Each round is a fresh session: start
the fill, count frames, send `RequestFrame` for a frame the fill has not reached, and stop the clock
on the last byte of that frame. Nine rounds per position, the three positions interleaved and their
order rotated each round.

| ask arrives at | n | ask → last byte (ms) | frames still in flight | fill frames delivered after |
| --- | ---: | ---: | ---: | ---: |
| 10 % of the fill | 9 | **2.79** [1.69 … 5.33] | 5 | 6 |
| 50 % of the fill | 9 | **3.40** [3.09 … 4.93] | 5 | 6 |
| 90 % of the fill | 9 | **2.82** [1.65 … 4.66] | 4 | 5 |

**Where in the fill the ask lands makes no difference** — the three medians sit inside each other's
ranges, and all 27 rounds fall between 1.65 and 5.33 ms. That is the point: the ask waits behind the
**four or five frames already in flight**, about 1.1 MB, and not behind any part of the fill still
to come. A fill of 200 frames and a fill of 20 cost it the same.

**What the fill pays is not latency, it is the rest of itself.** Across all 27 rounds the server
delivered between 3 and 8 more frames after the ask — the ones already in flight — and then nothing.
At 10 % that discards 180 frames of stated intent; the client has to ask again for the remainder.
That is the real price of an ask during a fill, and it is a protocol cost rather than a delay.

## The branch that set priorities

`feat/set-priority-per-frame` (`f85f8a6`, 11 lines) calls `uni.set_priority(i32::MAX - ask_seq)` so
the earliest-asked stream transmits first. **It does not bear on this case**, for two reasons that
are worth keeping separate:

* it sits in the arm of `write_payload` that opens a uni stream per frame, so it never executes in
  `shared` mode, which is the default and the mode a fill runs in; and
* even in per-frame mode it would order frames *within* a fill against each other, which is not the
  question — the fill is already gone by the time the asked frame is written.

Its mechanism is still the right lever if the fill ever becomes something an ask runs beside. It is
not one today. Note also that `--ask-priority` is already a rejected arm of this lane (`README.md`).

## What this does not settle

* **Loopback is CPU-bound where a real link is congestion-bound.** The four-or-five frames in flight
  are what this host's send window holds; on a link with a large bandwidth-delay product the window
  holds more, and the ask waits behind more of it. The number to carry is therefore *"the ask waits
  for the send window to drain"*, not "3 ms". The regime that would change the answer is one whose
  window holds a large multiple of a frame — a long fat link, or a much smaller frame.
* **Nothing here is a tie that needs breaking**, so the usual caution about loopback ties does not
  apply: the finding is structural and visible in the planner, and the measurement only prices it.
* **Container-measured**, default `shared` mode, one client, no shaping. The frames are synthetic
  incompressible 250 KB blocks, so the wire carries what the study says it does.
* **Cancellation is not the same thing** and is not measured here: this is the server dropping a
  fill because an ask arrived, not a client calling `endStream()`.
