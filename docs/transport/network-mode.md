# The series server's network mode

**Status:** theory and a proposal for `deploy/`, 2026-11-12 (row HOSTNET-THEORY). Nothing here was measured in a
forwarded mode: the phone run of 2026-11-11 ran every timed load with `--network host`, and its prod-like check, four
loads through rootless podman's publish, was not run (`claude/phone-rows:docs/phone-rows/README.md` §Where the run
departed). Every claim is labelled **sourced** (a quote or a line of source, §Sources), **derived** (reasoned from
sourced facts, not observed) or **measured** (the run's rows, host mode only).

## The question

`deploy/compose.yml` publishes the server's UDP 4433 (and the exact server's 4434) with `ports:`. Under podman, who
carries a datagram from the NIC to the server's socket depends on how the container runs:

| mode | the datagram's path | who forwards |
| --- | --- | --- |
| **host** (`--network host`) | NIC → host stack → the server's socket | nobody: the container shares the host's namespace |
| **rootless publish** (`-p`, podman 5's default network) | NIC → host stack → pasta's socket → pasta (userspace) → a tap device → the container's stack → the server's socket | pasta, one process per container |
| **rootful publish** (`-p`, netavark bridge) | NIC → host stack, nftables DNAT, conntrack → bridge → veth → the container's stack → the server's socket | the kernel |

Podman documents pasta as "the default for rootless containers" and the bridge as "the default for rootful
containers" (podman-run, `--network`). A rootless bridge network forwards through `rootlessport` instead, a userspace
proxy; it is not the default and is left out except where it changes the telemetry (§3).

## 1 · Per-packet cost

**Host** (*measured*, the run's server logs, `datagrams_tx` and `sendmsg` of every session that sent over 10 000
packets): a fill of `dbts_b1-q8-g8` (23.2 MB) is about 16 600 datagrams; the server sent them 22.0 to a `sendmsg`
under `cubic-restart` (25 sessions, 15.6–23.0 per session) and 13.4 under `bbr` (29 sessions, 8.9–20.8; `bbr` paces).
That is quinn's UDP segmentation offload: one call and one socket buffer carry up to that many datagrams, and the host
stack walks one GSO packet per call (quinn-udp: `UDP_SEGMENT`; quinn-proto: `enable_segmentation_offload: true` by
default).

**Rootless publish** (*sourced*, then *derived*). pasta opens its tap with `IFF_TAP | IFF_NO_PI` and no
`IFF_VNET_HDR` (passt `tap.c`), so the tap carries no offload metadata and the container's kernel must split each
GSO packet into datagrams before the tap takes them. pasta then reads the tap one frame per `read()` (`tap.c`,
`tap_pasta_input`) and sends each datagram on its host socket with `sendmmsg` (`udp.c`) and no `UDP_SEGMENT`: every
datagram is its own packet through the host's stack. Per fill, then, about 16 600 tap reads, two copies of each
datagram (into pasta, back into the kernel; 46 MB a fill), and 16 600 host-stack walks where host mode has 750–1 200.
pasta is one thread (its README lists multithreading as not done), so every session of one container shares one
core for that work. At the run's wire times (0.5–1.0 s a fill, median, Wi-Fi and tether) one fill is 17 000–33 000
datagrams a second through it. pasta's own figures are for TCP ("4 to 50 times IPv4 TCP throughput … (UDP and IPv6
hard to compare)"); a per-datagram cost for UDP is not published, and none is assumed here. Traffic between two
local endpoints takes pasta's splice bypass instead ("this bypass only applies to local connections and traffic"), so
a check whose client sits on the server's own host does not exercise this path at all (§6).

**Rootful publish** (*sourced*, then *derived*). Kernel only, no copy. veth advertises `NETIF_F_GSO_SOFTWARE`, which
includes `NETIF_F_GSO_UDP_L4` (`veth.c`, `netdev_features.h`), so a GSO packet crosses veth and the bridge whole and
is split at the NIC or in software just before it; DNAT and conntrack run once per GSO packet, not per datagram. The
added cost is one bridge, one veth hop and one conntrack lookup per call; it is not measured here.

## 2 · What the congestion controller sees

The controller sees only what reaches quinn: acknowledgements, losses and their timing. A forwarder changes all three.

* **Losses that are the host's, not the path's** (*sourced*, then *derived*). In host mode a full socket buffer makes
  `sendmsg` wait: quinn is held back, nothing is lost. The tap does not hold the sender back: `tun_net_xmit` orphans
  each packet ("we might hang on to it for indefinite time") and, when its ring of `TUN_READQ_SIZE` (500) frames is
  full, drops it as `SKB_DROP_REASON_FULL_RING` and counts it in the tap's `tx_dropped` (`tun.c`, `if_tun.h`). 500
  frames are 726 kB of datagrams; `cubic-restart`'s window in the run was 10.2 MB in the median path row and up to
  23.5 MB (`bbr`'s up to 5.0 MB; *measured*, `cwnd`), so a burst larger than the ring arriving while pasta is behind is dropped at the host. quinn counts that as a lost packet and, under Cubic,
  as a congestion event: the window is cut for a queue that is not on the path. The server cannot tell the two apart.
  Rootful mode has no such ring: veth does not orphan the packet (no `skb_orphan` in `veth.c`), so the socket's
  accounting holds back the sender as in host mode (*derived* from the source, not observed).
* **Delay that is the host's** (*derived*). Every round trip through pasta includes its wait to be scheduled and its
  queue, in both directions (the data out, the acknowledgement in). It enters `rtt`, `min_rtt` and therefore BBR's
  model of the path and the queue-growth rule `lab/phone/losses.py` uses to call a loss congestive
  (q ≥ max(4 ms, min_rtt/8)). The run's minimum round trips were 2.2–18.7 ms (*measured*, host mode); a scheduling
  delay of a millisecond is a large fraction of the smallest. Not measured.
* **No ECN** (*sourced*). pasta writes `tos = 0` in every IPv4 header it builds toward the container (`tap.c`,
  `tap_push_ip4h`) and sets no `IP_TOS` on what it sends out (no `IP_TOS` in `udp.c`): ECN codepoints do not cross it in
  either direction. quinn starts every path sending ECT(0) and stops at the first acknowledgement that does not count
  it ("any ack that doesn't acknowledge it disables it", quinn-proto `on_ack_received`), so through pasta the server
  never reads a CE mark. Nothing on the run's home link is known to mark, so today this costs nothing measured; it
  closes the L4S and ECN path that `transport-conclusions.md` §1 *Beyond Cubic and BBR* names as a classifier input.
  Host and rootful modes carry the codepoints (the kernel forwards the IP header; quinn-udp sets `IP_TOS` per send and
  reads it with `IP_RECVTOS`).
* **The path MTU** (*sourced*, then *derived*). quinn probes with `IP_PMTUDISC_PROBE` (never fragment) up to 1 452
  bytes of UDP payload (quinn-udp; quinn-proto's `upper_bound: 1452`). pasta's tap has an MTU of 65 520 by default
  (passt(1), `-m`), its host socket sets no `IP_MTU_DISCOVER` (none in `udp.c`) and so takes the system's default,
  and it relays ICMP "fragmentation needed" back into the container (`udp.c`). On a path of at least 1 480 bytes
  (the run's: `current_mtu` 1452) nothing differs. On a narrower one (a tunnel), the host socket may fragment what
  quinn meant to be dropped, so a probe passes as two fragments and every full datagram afterwards rides as two:
  one lost fragment loses both. Not observed; a VPN path would show it.

## 3 · What the per-session telemetry sees

The path rows (`WTPACS_PATH_TELEMETRY`), the loss trace (`WTPACS_LOSS_TRACE`) and the session line in the log
(`rtt_us`, `cwnd`, `lost`, `congestion_events`, `datagrams_tx`, `sendmsg`) are read from quinn's statistics inside the
container. In every mode they are the server's view; through pasta that view includes pasta (§2), and nothing in them
says how much.

* **Losses and congestion events** include the tap's drops. The drops themselves are in the tap's `tx_dropped` in the
  container's network namespace, which the server does not read: a run in that mode must read it per load.
* **`datagrams_tx` and `sendmsg`** count the server's socket, so they show the same batching through pasta as in host
  mode; pasta's per-datagram sends are invisible to them.
* **The peer's address**: kept through pasta ("Port forwarding preserves the original source IP address", podman-run)
  and through rootful DNAT (*derived*: DNAT rewrites the destination only); rewritten for UDP through `rootlessport`
  ("UDP, loopback, and same-host connections typically still see a rewritten source address"). The server records
  no peer address today (no `remote_address` in `server/src`), so no current row depends on it.
* **Idle mappings** cannot cut a live session (*derived*): both conntrack and pasta drop an idle UDP mapping after
  `nf_conntrack_udp_timeout_stream`, 120 s by default (kernel docs; pasta reads the same sysctls, `udp.c`), and the
  server's own idle timeout ends a silent session well before that (`docs/adr/transport-idle-sessions.md`).

## 4 · The isolation given up by host networking

* Podman's own warning (*sourced*): host mode "gives the container full access to abstract Unix domain sockets and to
  TCP/UDP sockets bound to localhost". The server could reach any local service the host has on loopback.
* The server binds `[::]` (dual-stack) unless `--bind` names an address (`server/src/transport/server.rs`). In host
  mode `PUBLISH_ADDR` no longer limits where it listens: `--bind` must carry it, or the host's firewall must.
* Ports are the host's: the server and the exact server cannot both use 4433 inside, as the compose file has them;
  the exact one takes `--port 4434`, and a port already taken on the host refuses the start.
* What stays (*derived*): the user namespace (rootless), the seccomp profile (`deploy/seccomp-uring.json`), the
  read-only `/studies` mount and the limits are not network settings and do not change. The run used exactly this:
  rootless, `--network host`, the production seccomp profile (`claude/phone-rows:docs/phone-rows/run-env.sh`).

## 5 · Proposal for `deploy/`

Host networking for the `server` and `exact` services, rootless; `web` stays published (nginx is not on the data
path, `deploy/README.md`). Kept switchable: an override file beside `compose.yml`, with `network_mode: host`, no
`ports:`, `--bind "$PUBLISH_ADDR"` on both and `--port 4434` on `exact`; the default stays the published form until
the check of §6 decides. Why host, from §1–§3: it is the only mode in which the controller and the telemetry see the
path and nothing else, and it is the mode every timed phone load was measured in. Its price is §4, which `--bind` and
a host firewall bound. Rootful publish is the alternative if host networking is refused: kernel-only, GSO intact, ECN
and backpressure kept (*derived*), at the cost of running the container rootful. Rootless publish through pasta is the
one this theory argues against for the data path: host-side drops read as congestion, no ECN, a per-datagram userspace
hop on one thread. Its measured cost is the open part.

## 6 · What the prod-like check would decide

The check the run planned (`docs/devices.md` §7, *A prod-like check, not counted*: four loads, A B B A, rootless
publish, `cubic-restart`, Wi-Fi) reports and decides nothing. To decide §5 it needs, written by a session that will
not run it:

* **Arms** interleaved load by load: host and rootless publish, the same image, the same server process settings;
  rootful publish as a third arm only on a host where root is allowed (the run's laptop has none).
* **A client off the server's host**, over a non-loopback address (§1: a local client takes pasta's splice bypass).
* **Readings per load**: the fill time (beacon); the server's lost packets and congestion events (path rows); the
  tap's `tx_dropped` before and after (in the container's namespace); pasta's CPU time (`/proc/<pid>/stat` before and
  after); the host's idle, to say where it saturates and claim nothing past it.
* **What it decides**: any tap drop in a counted load shows host-side loss read as congestion, and settles §5 for host
  networking on its own; with none, the fill times decide whether pasta's hop costs anything at a phone's rates, and
  the default stays published if it does not. One phone and one home link limit either answer to that link.

## Sources

Fetched 2026-11-12.

* passt(1) and pasta, man page (passt.top, `passt.1`) and source at commit `7380393` (passt.top/passt): `tap.c`
  (`IFF_TAP | IFF_NO_PI`; `tap_pasta_input`'s `read()`; `tap_push_ip4h`'s `tos = 0`), `udp.c` (`recvmmsg`/`sendmmsg`;
  ICMP "fragmentation needed" relayed; conntrack timeouts read from `/proc/sys/net/netfilter/`), README (*Performance*;
  multithreading not done).
* podman-run(1), docs.podman.io, `--network` (`host`, `bridge`, `pasta`) and `--publish`.
* Linux: `drivers/net/tun.c` (`tun_setup`, `tun_net_xmit`), `include/uapi/linux/if_tun.h` (`TUN_READQ_SIZE 500`),
  `drivers/net/veth.c` (`VETH_FEATURES`), `include/linux/netdev_features.h` (`NETIF_F_GSO_SOFTWARE`),
  Documentation/networking/segmentation-offloads.rst, Documentation/networking/nf_conntrack-sysctl.rst.
* quinn-udp 0.5.15 `src/unix.rs` (`IP_PMTUDISC_PROBE`, `IP_RECVTOS`, `IP_TOS`, `UDP_SEGMENT`), the version in
  `Cargo.lock`; quinn-proto at tag 0.11.13 (`Cargo.lock` has 0.11.18; the lines quoted were not re-read at 0.11.18):
  `config/transport.rs` defaults, `connection/mod.rs` ECN handling.
* The run's rows: `claude/phone-rows` `4e492c92`, `docs/phone-rows/raw/servers/srv-44{33,43}.log` session lines,
  `*-path.jsonl`.
