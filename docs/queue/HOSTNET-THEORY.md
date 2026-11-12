state: started
started: 2026-11-12T09:01Z
heartbeat: 2026-11-12T09:40Z
outputs: claude/hostnet-theory (theory, docs)
## Resume
Sources gathered (pasta man page and source at passt 7380393, podman-run docs, kernel tun.c/veth.c/netdev_features.h,
nf_conntrack sysctls, quinn-udp 0.5.15, quinn-proto 0.11.13). Branch claude/hostnet-theory from claude/demo-fixes-2
(fe? see git log). Writing docs/transport/network-mode.md, a pointer in deploy/README.md, docs/lines/codecs.md Open.
Key findings: pasta has no IFF_VNET_HDR, reads the tap one frame per read(), sends with sendmmsg without UDP_SEGMENT
(run: 13-22 datagrams per sendmsg in host mode, ~16.6k datagrams a fill); tun_net_xmit orphans the skb and drops at a
500-frame ring (host-side loss the controller reads as congestion); pasta writes tos=0 toward the tap and sets no
IP_TOS outbound, so ECN is off through it; podman: pasta keeps source IP; host mode: podman's warning quote.
Continue: write the doc from these, push, draft nothing (theory, docs; no PR base in the row).
## Result
