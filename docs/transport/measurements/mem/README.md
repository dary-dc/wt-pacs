# Server memory per concurrent viewer

**Question:** the deployment target is *"possibly thousands of simultaneous viewers"*. How
much server memory does one cost, and do the flow-control windows need bounding?

**Reproduce:** `lab/transport/scripts/mem_per_connection.sh`, analysed by `lab/transport/scripts/mem_analyse.py`.
The pathological case is `lab/transport/scripts/stall_client_campaign.sh` + `lab/transport/scripts/stall_analyse.py`,
gated by `lab/transport/scripts/e0_stall_validate.sh`.

| file | workload |
| ---- | -------- |
| `mem_light.tsv` | ordinary reading: fast client drain, depth 8, slow reader |
| `mem_stress.tsv` | flow-control stress: client drains at 2 Mbps, depth 32, fast reader |
| `stall_client.tsv` | **the pathological case**: asks 400 frames, then stops reading — [`stall-client.md`](stall-client.md) |

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
cannot produce that case.

### The pathological case, now measured — and it does not reach the ceiling

`window-harness --mode stall` produces it. Full results:
[`stall-client.md`](stall-client.md); data: [`stall_client.tsv`](stall_client.tsv), 48 rows,
0 VOID, gated by `lab/transport/scripts/e0_stall_validate.sh`.

| workload | server per connection |
| --- | --- |
| ordinary reading | 110 KB |
| slow reader, 2 Mbps drain | 162 KB |
| **stops reading entirely, shared stream** | **180 KB** |
| stops reading entirely, per-frame | 370 KB |

**A client that stops reading costs the server 11 % more than one that reads slowly** — not
the 10 MB `send_window` the arithmetic was about, but 55× below it. The reason is that the
withheld bytes queue at the *other* end: the same client holds **2.20 MB**, twelve times
what the server does, because a stalled client's stack still ACKs and the server frees what
is acknowledged. What the server retains is connection bookkeeping, not queued payload,
which is why bounding the payload windows barely moves it (1.09× shared, 1.62× per-frame).

### But that is the **chunked** send path, and the send path is the real variable

Those figures are `--send-path chunked`, which queues refcounted slices of the study mmap
rather than per-connection copies. On the other two paths the same stalled client costs far
more ([`stall_send_path.tsv`](stall_send_path.tsv); total RSS corroborates `RssAnon`, so
this is a real saving and not a blind spot in the metric):

| send path | shared | per-frame |
| --- | --- | --- |
| **chunked** | **198 kB** | **375 kB** |
| copy | 1 299 kB | **6 990 kB (6.8 MB)** |
| split | 1 292 kB | 6 807 kB |

**`copy` + per-frame reaches 68 % of the 10 MB ceiling.** The arithmetic worry was well
founded for the send path the project used to ship; the chunked default is what removed it.
`RssAnon` was checked against total RSS *within* each arm first — they agree to within 1 %
everywhere, so the chunked figure is not a file-backed blind spot.

### So: bound the windows — conditionally

- **Not** as a memory optimisation. Measured, it saves ~16 KB per reading connection and
  14 KB per stalled one — 0.07–0.08 GB at 5 000 viewers against a total near 0.9 GB.
- **On `chunked` + shared, hygiene only.** The pathological case does not get within 55× of
  the ceiling, so the knob is not what is protecting you — the send path is.
- **On `copy`/`split` + per-frame, yes, and for the original reason.** 6.8 MB per stalled
  connection, ~34 GB at 5 000 of them, is exactly what `send_window` exists to cap.

Its status therefore moves from *"the case that motivates it remains unmeasured"* to
**"measured; the ceiling is approached only on the copy/split send paths, and the chunked
default is what keeps it 55× away"**.

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
  the latency figures elsewhere in this project. The one place client memory *is* measured
  is [`stall-client.md`](stall-client.md), where it turns out to be where the pathological
  case actually lands.
