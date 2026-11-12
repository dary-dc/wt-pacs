state: done
started: 2026-11-12T09:01Z
heartbeat: 2026-11-12T10:05Z
outputs: claude/hostnet-theory 8a1f0f59 (docs/transport/network-mode.md; pointers in deploy/README.md and docs/lines/codecs.md Open 7); no PR (the row names none)
## Resume
Done. Nothing owed by this row. The check in network-mode.md §6 goes to the next phone round's protocol amendment,
written by a session that will not run it.
## Result
Theory only, nothing measured in a forwarded mode (the run's rows are host mode; one phone, one home link).
* Host (measured): a dbts_b1-q8-g8 fill is ~16 600 datagrams, sent 22.0 per sendmsg (cubic-restart) / 13.4 (bbr), GSO.
* Rootless publish (pasta, sourced): tap without vnet header, one read() per frame, sendmmsg without UDP_SEGMENT:
  ~16 600 host-stack walks a fill instead of 750-1 200, two extra copies, one thread per container. Cost unpublished.
* Controller (sourced/derived): tun orphans the skb and drops at a 500-frame ring (726 kB) when pasta lags, so
  host-side drops read as path loss and Cubic cuts (run's windows 10.2 MB median, 23.5 MB max); pasta zeroes TOS
  both ways, so quinn turns ECN off; its delay enters rtt/min_rtt. Rootful bridge keeps GSO, ECN, backpressure.
* Telemetry: path rows cannot separate pasta's share; tap tx_dropped must be read per load. Source IP kept by pasta.
* Isolation (podman's warning quoted): loopback and abstract sockets exposed; --bind must replace PUBLISH_ADDR.
* Proposal: host networking for server and exact via an override file, default unchanged until §6's check (arms
  interleaved, client off-host since a local client takes pasta's splice bypass, tap drops, pasta CPU, host idle).
Owner decision: whether deploy/ moves the series servers to host networking, after that check.
