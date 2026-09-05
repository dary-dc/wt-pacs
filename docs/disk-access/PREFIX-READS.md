# Rung delivery breaks the fast path — and the layout fixes it · 2026-09-05

[`adr.md`](adr.md) rests on one number: the `RWF_NOWAIT` fast path misses **6 of 320** asks
on a cold sequential pass, and **0 of 320** warm. That is not a property of the flag. It is a
property of *reading frames whole, in order*, which is what lets kernel read-ahead run in
front of the loop.

[`adr-resolution-fitting-for-large-frames.md`](../adr-resolution-fitting-for-large-frames.md)
changes that. Fitting a frame to the viewport means sending the **prefix** of a progressive
HTJ2K codestream — the rung that fits — and skipping the rest. Reads stop sweeping the file
and start striding it.

**Measured: under prefix reads the fast path misses 319 of 320. Storing the rung
contiguously puts it back to 3 of 320.**

Raw: [`v7_prefix_layout.tsv`](v7_prefix_layout.tsv) · [`v7_payload_sizes.tsv`](v7_payload_sizes.tsv)

```bash
# Fixtures: today's layout, a rung stripe, and the same stripe inside a full-size file.
./lab/scripts/gen_live_cell_fixture.sh                                        # 320 × 250 KB
NAME=frames_16k_rung BYTES=16384 FRAMES=320  ./lab/scripts/gen_live_cell_fixture.sh
NAME=frames_16k_big  BYTES=16384 FRAMES=5120 ./lab/scripts/gen_live_cell_fixture.sh

# A: prefix reads out of whole frames (--prefix strides the file)
./target/release/disk-access-bench --study lab/fixtures/frames_250k_live/frames_250k_live.sbnd \
  --arm pread-nowait-chunked --arm uring-nowait-hybrid --arm pread-blocking-pooled \
  --temp cold --temp warm --trace forward --repeats 9 --runtime multi --prefix 16384

# C: the same 320 rungs adjacent, inside an 84 MB file (trace = first 320 frames)
./target/release/disk-access-bench --study lab/fixtures/frames_16k_big/frames_16k_big.sbnd \
  --arm pread-nowait-chunked --arm uring-nowait-hybrid --arm pread-blocking-pooled \
  --temp cold --temp warm --trace-file lab/traces/stripe320.json --repeats 9 --runtime multi
```

---

## The cell

Every row delivers the **same 5.24 MB** — 320 frames × a 16 KB rung — and differs only in
where those bytes sit in the file. 9 repeats, product runtime, median.

| Layout | What it models |
| --- | --- |
| `frame_major_prefix` | Today's SBND. Frames whole and contiguous; serve the first 16 KB of each 250 KB frame, skip 234 KB, repeat |
| `rung_major_stripe` | The same 320 rungs stored **next to each other**, as a 5.24 MB stripe inside an 84 MB file — so file size is controlled, only adjacency changes |

## Cold

| Layout | Arm | Hops / 320 | p50 | CPU / ask | gap_max |
| --- | --- | ---: | ---: | ---: | ---: |
| frame_major_prefix | `pread_nowait_chunked` | **319** | 93 443 ns | 124 840 ns | 141 µs |
| frame_major_prefix | `uring_nowait_hybrid` | 319 | 95 400 ns | 158 243 ns | 173 µs |
| frame_major_prefix | `pread_blocking_pooled` | 320 | 106 179 ns | 169 872 ns | 128 µs |
| **rung_major_stripe** | **`pread_nowait_chunked`** | **3** | **3 456 ns** | **19 815 ns** | 118 µs |
| rung_major_stripe | `uring_nowait_hybrid` | 3 | 3 373 ns | 20 927 ns | 184 µs |
| rung_major_stripe | `pread_blocking_pooled` | 320 | 31 713 ns | 56 560 ns | 99 µs |

**27× the per-ask latency and 6× the CPU, for the same bytes delivered, decided by adjacency
alone.**

## Warm

| Layout | Arm | Hops / 320 | p50 | CPU / ask |
| --- | --- | ---: | ---: | ---: |
| frame_major_prefix | `pread_nowait_chunked` | 0 | 2 459 ns | 7 815 ns |
| rung_major_stripe | `pread_nowait_chunked` | 0 | 3 201 ns | 8 794 ns |

Layout is a **cold-path** property: once the pages are resident, striding costs nothing. A
deployment whose working set fits in RAM never sees this. A tens-of-GB study on cloud storage
is the opposite of that deployment.

## What this says

1. **The ADR's decision is unchanged; its headline number is conditional.** `RWF_NOWAIT`
   streaming is still the right read path — it is the best arm in *both* layouts, cold and
   warm. What collapses under striding is not the arm, it is the hit rate the arm was
   advertised on. Under rung delivery on a cold study, the accepted path degrades to its own
   escape hatch — one pool round trip per ask — which is exactly what
   [`adr.md`](adr.md) says it does, and it is now the common case rather than the reverse-trace
   worst case.
2. **io_uring still does not help.** In both layouts the hybrid tracks the accepted path
   within noise (3 373 vs 3 456 ns cold striped; 95 400 vs 93 443 ns cold strided). A 99%
   miss rate was the condition [`RERUN.md`](RERUN.md) §Cell 6 named for revisiting the ring,
   and here it is — with no advantage. The reason is structural: the session loop sends one
   frame to completion before reading the next ask
   ([`adr-reject-server-ordering.md`](../adr-reject-server-ordering.md)), so queue depth is 1
   per session however many misses there are. io_uring's advantage needs depth to spend.
3. **The lever is the packer, not the read path.** Nothing in `server/` can recover
   read-ahead once the bytes are 234 KB apart. `pack-study` can, by writing rungs in stripes.

## What a rung-major SBND would cost

Not free, and the shape matters:

* **`pack-study` must know the rung boundaries** — the byte offsets of each resolution level
  in each codestream. That is HTJ2K parsing at pack time, and an SBND index that carries
  per-rung offsets instead of one offset per frame.
* **A progressive codestream is a prefix, but stripes are not.** Rung 3 needs rungs 0–3.
  Frame-major serves that as one contiguous read; rung-major serves it as four reads in four
  stripes. The layout wins for *"serve one rung across a stack"* and loses for *"serve every
  rung of one frame"*. Which one dominates is a delivery-design question, not a disk one —
  and with the client caching every increment it has (OPFS/IndexedDB), asking for one
  increment at a time is the natural shape, and it is the shape stripes favour.
* **Dynamic cut points do not survive.** A device that wants an arbitrary byte prefix cannot
  have one; it gets the smallest stored rung that covers its need. That is what
  [`adr-resolution-fitting-for-large-frames.md`](../adr-resolution-fitting-for-large-frames.md)
  already decided ("deliver the rung that fits"), so it costs nothing extra here — but it
  does mean rung boundaries must be chosen at pack time, not per request.

## The wire side of the same change

Smaller payloads also change what a delivered byte costs on the connection. Same host,
`wire_send_bench`, 5 interleaved rounds, whole-frame reads warm so only the payload size
varies ([`v7_payload_sizes.tsv`](v7_payload_sizes.tsv)):

| Payload | CPU / ask | CPU / delivered MB | Datagrams / ask |
| ---: | ---: | ---: | ---: |
| 250 008 B | 1 006 µs | 4 025 µs | 178.9 |
| 65 544 B | 264 µs | 4 023 µs | 47.1 |
| 16 392 B | 79 µs | 4 809 µs | 12.0 |
| 4 104 B | 26 µs | **6 246 µs** | 3.1 |

Cost per byte is flat down to ~64 KB and then climbs: at 4 KB a delivered byte costs **55%
more CPU** than at 250 KB, because the per-ask fixed cost (stream open, header, finish, the
task that awaits the ack) stops being a rounding error. Rung sizes for a 2.99 MB frame run
~10–210 KB, so realistic rungs sit in the flat region — the cliff is a reason not to go
below ~16 KB, not a reason to avoid rungs.

Stream mode moves with it. Against one shared stream instead of one per frame, paired by
round:

| Payload | shared vs per-frame CPU | same sign |
| ---: | ---: | ---: |
| 250 008 B | +8.7% | 5/5 (per-frame wins) |
| 65 544 B | +10.6% | 4/5 (per-frame wins) |
| 16 392 B | +7.3% | 3/5 — **not resolvable** |
| 4 104 B | **−20.6%** | 5/5 (shared wins) |

Per-frame streams — [`stream-mode-decision-report.md`](../stream-mode-decision-report.md)'s
choice — stay right at every realistic rung size. The crossover is below 16 KB, and it is
recorded here only so that a future move to very small increments re-opens that decision
rather than inheriting it.

## Limitations

* **Cold here is guest-cold, not device-cold.** Hop counts are exact — they are page-cache
  misses in the guest, and the cell aborts unless residency starts below 0.1%. The
  *latencies* are flattered by the hypervisor's own cache, so read 93 µs vs 3.5 µs as
  "two orders of magnitude apart in a direction the mechanism predicts", not as a figure to
  quote for cloud storage. On a network volume each of those 319 misses costs a real round
  trip and the gap widens, not narrows.
* **One rung, one stripe.** The striped fixture holds a single rung's bytes. It does not
  model competition between stripes, nor a reader moving between rungs.
* **16 KB rung.** Real rung sizes for a 2.99 MB tomosynthesis frame run ~10 KB (rung 0) to
  ~210 KB (rung 2). The mechanism is adjacency, not size, but the numbers are for 16 KB.
* **The payload sweep varies size, not layout.** It reads whole frames from a warm study, so
  it prices the connection, not the disk. The two halves are independent and were measured
  separately on purpose.
* Every caveat in [`RERUN.md`](RERUN.md) §Limitations still applies, in particular:
  order-control any *new* cold claim before believing it. This one rests on an exact count,
  which is why it is quotable.
