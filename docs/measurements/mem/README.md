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

`mem_stress.tsv` is that case: the client drains at 2 Mbps against a server pushing at line
rate with depth 32, so bytes accumulate in the send buffer and `send_window` becomes the
thing that bounds them.

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
