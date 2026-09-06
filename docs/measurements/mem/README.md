# Server memory per concurrent viewer

**Question:** the deployment target is *"possibly thousands of simultaneous viewers"*. How
much server memory does one cost, and do the flow-control windows need bounding?

**Reproduce:** `lab/scripts/mem_per_connection.sh`, analysed by `lab/scripts/mem_analyse.py`.

| file | workload |
| ---- | -------- |
| `mem_light.tsv` | ordinary reading: fast client drain, depth 8, slow reader |
| `mem_stress.tsv` | flow-control stress: client drains at 2 Mbps, depth 32, fast reader |

---

## The answer: memory is not a constraint

Light workload, N = 1…50, three repeats, both window settings:

| | per connection | fixed baseline | fit |
| --- | -------------- | -------------- | --- |
| quinn defaults | **110 KB** | 1.2 MB | r² 0.980 |
| bounded windows | **114 KB** | 1.0 MB | r² 0.992 |

Extrapolated: **1 000 viewers ≈ 0.11 GB, 5 000 viewers ≈ 0.5 GB.** On any server that can
run the process at all, connection memory is a rounding error.

This is a **T2** result — one host, synthetic fixture, loopback — but the quantity being
measured is allocator behaviour rather than network behaviour, so it should travel better
than most numbers in this project.

---

## The measurement decision that mattered more than the result

**This reports `RssAnon`, not `RSS`.**

`FrameStore` mmaps the study file, so total RSS includes file-backed pages that arrive as
frames are touched. Measured here:

| clients | RssAnon | total RSS | of which file-backed |
| ------: | ------: | --------: | -------------------: |
| 1 | 0.9 MB | 13.5 MB | **12.6 MB** |
| 50 | 6.3 MB | 19.0 MB | **12.7 MB** |

The file-backed component is **flat across N** — it is the study, not the connections.
Reporting `RSS / N` would have claimed *~13 MB per connection at N = 1*, wrong by roughly
**80×**, and would have shown a spurious *decrease* with N as the fixed mapping was divided
across more connections.

Two further choices, for the same reason:

- **The per-connection figure is the slope, not the ratio.** The intercept is fixed server
  cost; dividing it into small-N rows inflates them.
- **Rows carry `connected`**, the number of clients still alive when memory was sampled.
  The analyser excludes and reports any row where that fell below N, rather than averaging
  a row that measured fewer connections than it claims.

---

## Flow-control windows: what this does and does not settle

`transport-conclusions.md` carries *"Flow-control windows — set them, for **memory** at
thousands of viewers, not for speed"* on arithmetic alone. This measurement engages it but
does not close it.

Under the **light** workload, bounded vs default is **+3.6 %** — inside noise, and the two
fits' intercepts differ by more than the effect.

**That is not evidence the knobs are pointless.** Flow-control windows are **ceilings, not
allocations**: a connection buffers only what is in flight, so a workload that never
approaches the ceiling cannot distinguish a high one from a low one. What they bound is the
worst case — a client that stops draining while the server keeps pushing — which is
precisely the case that matters at scale and precisely the case the light workload omits.

### The stress case, run

Client draining at 2 Mbps against a server pushing at line rate, depth 32, N = 2…16:

| | per connection | fit |
| --- | -------------- | --- |
| quinn defaults | **162 KB** | r² 0.9985 |
| bounded windows | **146 KB** | r² 0.9991 |

**The effect is real: bounded used less memory in 12 of 12 paired runs**, and the gap grows
with N (+4 KB at N=2, +472 KB at N=16), which is what a per-connection effect looks like.
A 12/12 sign run is p ≈ 0.0005.

**But the magnitude is ~16 KB per connection, and that is the finding.** Even with
*unbounded* windows, per-connection memory under stress was 162 KB — three orders below the
10 MB default `send_window` that the arithmetic worry is built on. The ceiling was never
close to binding.

The reason is that **the receiver's window bounds server buffering first**. A well-behaved
client advertises its own `stream_receive_window` (1.25 MB by default) and drains, so the
server never gets to fill a 10 MB send window no matter how large it is.

**What would actually reach the ceiling is a client that asks for a lot and then stops
reading entirely** — stalled, backgrounded, or hostile. This harness always reads, so it
cannot produce that case, and this measurement therefore does **not** rule it out.

### So: bound the windows, but for the right reason

- **Not** as a memory optimisation. Measured, it saves ~16 KB per connection, which is
  0.08 GB at 5 000 viewers against a total of 0.8 GB.
- **Yes** as a bound on the pathological case, which is unmeasured here and is the case the
  arithmetic was always about. `receive_window` unlimited is not a policy regardless of
  what a well-behaved client does.

Its status therefore moves from *"unmeasured"* to *"measured under two workloads, small in
both; the case that motivates it remains unmeasured because the harness cannot produce a
client that stops reading."*

---

## What this does not answer

- **Real frame sizes.** 64 KB uniform. Per-connection buffers scale with what is in flight,
  so 250 KB frames should raise the stress-case figure and leave the light-case figure
  roughly alone.
- **Real concurrency patterns.** All clients here start together and read the same trace.
- **Anything about CPU.** Server density per byte is measured on the loopback rig; see
  `transport-conclusions.md` §3.
- **The browser side.** This is server memory only. Client memory is bounded by the display
  cache, which is a client decision (`cache_frames`) and the largest single determinant of
  the latency figures elsewhere in this project.
