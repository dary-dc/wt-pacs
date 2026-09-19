# T12 — What a browser can receive: where the cost sits, and which send shapes move it

**Status:** measured 2026-09-19 on this VM (§Result); the rule changed no default · **Needs:**
headless Chromium on a link faster than the browser (this VM qualifies; the rig does too) ·
**Size:** one afternoon, one browser campaign

## Question

On the target link (20 Mbps) the wire binds and nothing below it matters. On a fast link the
browser binds: the rig measured Chromium's network-service thread at ~10 ms of CPU per MB
received, which caps a fill near 100 MB/s whatever the server does (`docs/rig-limits.md` §1 on
the `docs/rig-limits` branch), and the owner's reading is that "the client has more than what it
can receive". Three things about that bound were never measured with a browser on the wire:

1. **Where the browser's cost sits** — the network service (Chromium's QUIC, untouchable from
   this repository), the renderer's main thread (our client's reads and copies), or the kernel
   (datagrams dropped at the client socket).
2. **Whether the server's send shape drops datagrams at the browser's socket**, and what a drop
   costs the fill. The 45-segment GSO batch (`why-these-changes.md` §9, §10 entry 3) was priced
   against a native client; Chromium asks for a 1 MiB socket buffer and a default Linux host
   clamps that to `rmem_max` = 212 992.
3. **Which server-side shapes move what a browser receives per second**, and at what CPU per
   MB on each side: the stream count (`shared`, `pool:k`, `per-frame`), the send window, the
   segment cap.

The session-in-a-Worker, BYOB and pushed-fill work is `claude/serene-rubin-wakfg7`'s
(`docs/proposal-downloader.md` there) and is not repeated here; this lane reads only what the
server sends and what the unchanged TypeScript client, on the main thread with the default
reader, receives.

## Decision rule

Fixed before the run. Arms interleaved, order reversed every repeat, six repeats, paired against
`shared` per repeat: paired median and sign count, as `lab/scripts/runtime_ab_pair.py` reports.

- **An arm is a candidate default for a fast link** only if it raises the browser's MB/s by
  ≥ 10 % (5/6 paired) with neither renderer-main nor network-service CPU per MB up by more than
  5 %, and no more dropped datagrams. Otherwise the default stays and the arm is recorded.
- **The ceiling is named by the thread nearest a full core** during a fill. If it is the network
  service, no client-code lever raises throughput here and the row says so; if it is the renderer
  main thread, the client's reads are the lever and T5's BYOB and Worker work is where it goes.
- **`rmem_max` is a deployment line, not a default**: if the Linux-default socket buffer drops
  datagrams and costs ≥ 10 % of MB/s, `docs/disk-access/DEPLOYMENT.md` gets the sysctl for the
  client host and nothing in the server changes.
- **Latency is quoted from the on-demand cell and throughput from the fill cell**, never both
  from one.

## Arms and cells

| arm | server |
| --- | --- |
| `shared` | the product default: one uni, GSO cap 65 527 / MTU (45 at 1 452) |
| `pool2`, `pool4` | `--stream-mode pool:2`, `pool:4` |
| `perframe` | `--stream-mode per-frame` |
| `sw768k` | `--send-window-bytes 786432`, the rig's drop remover |
| `seg10` | the same source with the patch's cap clamped to 10, quinn's stock batch |
| `rmem212k` | `shared` with the client host at `net.core.rmem_max` = 212 992 (Linux default) |

Cells: `fill` at 250 KB and 32 KB, 800 frames (`FRAMES=800 lab/scripts/gen_tf_fixtures.sh` into
a scratch `OUT_ROOT`, so a run is long enough for per-thread CPU to resolve); `ondemand` at depth
1 and 4, 250 KB, 320 asks. Driver: `lab/scripts/browser_receive.py` — per-thread CPU from
`/proc/*/task/*/schedstat` around each run for the server and every Chromium process, and
`Udp: RcvbufErrors` from `/proc/net/snmp`. Reads per frame and bytes per read for the renderer,
default reader against BYOB, from `lab/scripts/browser_reads.py`.

## Report

Per cell and arm: MB/s, drops per run, CPU ms per MB for server, network service (main and IO
thread), renderer main thread; heap peak. Raw rows under `docs/measurements/t12-browser-receive/`,
the reading below, the conclusion in `transport/NEXT.md` row 14 and `CLIENTS.md`.

## Stop conditions

A run with `failed > 0` or `delivered < asked` voids its cell. The host saturating — the CPU
across all threads above 3.5 of this VM's 4 cores during a fill — means the box, not the
browser, binds, and no throughput number past it is claimed.

## Result — 2026-09-19, this VM

4 vCPU Xeon 2.8 GHz, headless Chromium 141, loopback, `rmem_max` 4 MB; host, arms and rows in
[`../measurements/t12-browser-receive/`](../measurements/t12-browser-receive/). Fills of 800
frames, six repeats, arms interleaved and reversed, paired against `shared`; `*.pair.txt` is the
pairing verbatim. Every run delivered every frame; no cell was void. The server arms were built
from `8b903cd`, the per-core-endpoint server that `58f2974` parked the same day: the browser
side of every number below is independent of the server's runtime shape, the server's own CPU
per MB is not, and it is quoted for that tree.

### 1 · The ceiling is Chromium's network-service thread, and it is the same at both sizes

CPU per MB received, `shared`, medians of six (ms / MB):

| cell | server | network service IO thread | renderer main thread | renderer other | MB/s |
| --- | --: | --: | --: | --: | --: |
| fill, 250 KB | 3.54 | **6.59** | 2.51 | 1.24 | 151.6 |
| fill, 32 KB | 4.00 | **6.58** | 3.91 | 2.10 | 143.9 |
| on-demand, 250 KB, depth 1 | 2.53 | 6.68 | 3.26 | 1.29 | 114.0 |
| on-demand, 250 KB, depth 4 | 2.37 | 6.17 | 2.82 | 1.08 | 156.0 |

In every `shared` fill the network-service IO thread's CPU was 0.989–0.995 of the wall time at
250 KB and 0.94–0.97 at 32 KB: it ran a full core for the whole fill, and nothing else did (the
box as a whole spent 2.0–2.2 of its 4 cores, under the stop condition). 6.6 ms per MB is ~9.5 µs
per 1 452-byte datagram, and it does not move with frame size or cell — it is Chromium's cost per
packet (the rig read 9.8 ms per MB on its own CPU, `rig-limits.md` §1). The renderer's main
thread — this repository's client, its reads and its one copy, plus Blink's stream machinery —
spent 2.5 ms per MB at 250 KB and 3.9 at 32 KB, a fit of ~50 µs per frame plus 2.3 ms per MB:
37–41 % of a core at 250 KB, 46–65 % at 32 KB.

**So no code in this repository raises what a browser receives per second on a fast link**: the
bound is in the network service, one process away from anything a page or a Worker runs. What the
client's code decides is the renderer's 2.5–3.9 ms per MB, which is what the page has left for
decode and paint; moving it off the main thread is the other branch's Worker. On the target link
(2.5 MB/s) the network service's cost is 1.7 % of a core and none of this binds; there the
viewer's bound is bytes per frame ([`T4`](T4-bytes-per-frame.md)) and its own decode.

### 2 · Every fill overflows the browser's socket once; the send window is the lever, not the batch

Chromium asks for a 1 MiB receive buffer and the kernel gives it (`SO_RCVBUF` reads 2 097 152 with
`rmem_max` at 4 MB; on a Linux-default host, 425 984). Datagrams dropped at that socket per run,
and the paired deltas:

| fill | `shared` | `sw768k` | `rmem212k` | `seg10` | `pool4` | `perframe` |
| --- | --: | --: | --: | --: | --: | --: |
| 250 KB (~138 k datagrams) | 1 348 | **0** (6/6) | 369 (−76 %, 6/6) | 1 405 (+0.6 %) | 1 206 (−8 %, 4/6) | 1 286 (+1 %) |
| 32 KB (~18 k datagrams) | 1 660 | **0** (6/6) | 338 (−79 %, 6/6) | 1 512 (−7 %, 4/6) | 1 230 (−20 %, 6/6) | 1 041 (−37 %, 5/6) |
| on-demand, either depth | 0 | 0 | — | 0 | — | 0 |

The count is the same size in a 0.2 s fill as in a 1.4 s one, so it is one event, not a rate.
The mechanism is inferred from the counts, not traced: slow start overshoots the socket buffer
once, the receive thread (already at a full core) cannot drain it, and Cubic backs off — the
same overshoot the client branch describes from the sender's side (`improvements/2026-09-18.md`
S8 there). On that reading a smaller buffer loses *fewer* datagrams because the overflow arrives
at a smaller window, and a 768 KB send window never lets the bytes in flight reach the buffer, so
nothing is ever dropped. The 45-segment batch is not the cause: `seg10` drops the same. Throughput did not follow the drops — `sw768k` is +4.7 % (3/6) and +0.3 % (3/6), a tie, as
the rig found — because the loss is one event in a fill that the receive thread bounds anyway.
On the target link 768 KB is five times the bandwidth-delay product and never binds, so the window
is harmless there; at depth 4 it cost the server +17.8 % CPU per MB (6/6), so it is not a free
default either. **Recorded as the drop lever for a fast-link deployment, not adopted.**

### 3 · Send shapes, paired against `shared`

| arm | fill 250 KB, MB/s | fill 32 KB, MB/s | on-demand d1, µs per ask | on-demand d4, µs per ask | network-service ms/MB | renderer-main ms/MB |
| --- | --: | --: | --: | --: | --: | --: |
| `perframe` | **−26.0 % (6/6)** | **−62.2 % (6/6)** | **+31.9 % (6/6 worse)** | **+35.3 % (6/6 worse)** | +35 % at 250 KB, +177 % at 32 KB (6/6) | +35 % / +159 % (6/6) |
| `pool2` | −1.0 % (4/6 lower) | +14.7 % (4/6 higher) | — | — | tie | +9 % (6/6) at 250 KB |
| `pool4` | +4.4 % (3/6) | +5.1 % (5/6) | — | — | tie | +20 % (6/6) at 250 KB, +11 % (4/6) at 32 KB |
| `sw768k` | +4.7 % (3/6) | +0.3 % (3/6) | +0.7 % | +0.3 % | tie | tie |
| `seg10` | +1.2 % (2/6) | +5.4 % (4/6) | **−2.6 % (6/6)** | −3.8 % (4/6) | tie; −3.4 % (5/6) at d4 | tie |
| `rmem212k` | −5.9 % (3/6) | −3.0 % (3/6) | — | — | +7.5 % (3/6) | +6 % (4/6) |

**No arm clears the rule** (+10 % MB/s at 5/6 with no CPU cost), so `shared` and quinn's windows
stay the defaults. What is established: **a stream per frame costs a browser receiver a quarter of
its throughput at 250 KB and three fifths at 32 KB, and a third more latency at depth 1** — the
network service pays per stream what it pays per packet, and the renderer opens a reader per
stream; the rig's 42 ms over 87 frames was the same finding. A pool of 2–4 is a throughput tie
that costs the renderer 9–20 % more CPU per MB. The 10-segment batch is a tie everywhere except a
2.6 % (6/6) shorter ask at depth 1, too small to move a default from loopback and consistent with
§10's depth-1 reading. `pool:k` and `per-frame` keep their case under loss (T3); it is not here.

### 4 · How the browser hands a frame to the page

`lab/scripts/browser_reads.py`, 80 frames on one shared stream: with the default reader a 250 KB
frame arrives in 4.9–5.3 `read()`s of 39–47 KB median, 55–73 KB at p90 and up to 256 KB — the
data pipe coalesces whatever has landed, so a **32 KB frame arrives in 0.6–0.8 reads**, one read
often carrying two frames. A BYOB reader asking for the whole frame (`read(view, { min })`,
which Chromium 141 honours) takes exactly 2 reads per frame at either size: fewer at 250 KB, three
times more at 32 KB, and the wall time is a tie at both. So BYOB's per-frame read shape is right
for large frames and wrong for small ones; the coalescing the default reader already does is what
a BYOB path has to keep. This is the client branch's BYOB lane's to use, not a change here.

## What this closes, and what it leaves

`transport/NEXT.md` row 14 is answered for this host: the browser's receive ceiling is Chromium's
per-datagram cost, measured, and the only server-side shapes that touch it are the ones that make
it worse. The two levers that remain for a fast-link browser are 20 bytes per packet
(`MtuDiscoveryConfig::upper_bound(1472)`, 1.4 % fewer datagrams, T9's packet-size line) and the
send window against the one overflow. On the target link the row stays closed by arithmetic. The
rig repeats the fill cells on its own CPU before any of the fast-link lines is acted on.
