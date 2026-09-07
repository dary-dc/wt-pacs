#!/usr/bin/env bash
# Explicit-parameter server-side netem for real-path campaigns. Runs ON the rig.
#
# Why this exists alongside cloud_netem.sh: that script takes named PROFILES (20|30|50|
# 60|90|150|180) whose delay and rate are baked in, and its rate comes from a $RATE env
# default of 10mbit. R6's cells need arbitrary (one-way delay, rate, loss) triples, and
# the runbook's documented `cloud_netem.sh 25 20 0.1` does not parse as a profile at all —
# it is read as PROFILE=25 (unknown), LOSS=20, MODEL=0.1 and exits non-zero. This script
# is that documented interface, actually implemented.
#
# Usage: cloud_netem_exact.sh off
#        cloud_netem_exact.sh <one_way_delay_ms> <rate_mbps> <loss_pct> [limit_pkts]
#
# Shaping is EGRESS-ONLY: it applies to server->client traffic. The client->server ask
# path is unshaped. This differs from lab/netsim, which applies delay, loss, rate and
# queue independently in BOTH directions — see docs/measurements/r6/real-path-notes.md.
#
# Port 22 is filtered into an unshaped band. Without that, shaping the default route with
# loss and a 20 Mbit cap makes the rig's own SSH unusable and there is no console.
set -euo pipefail

IFACE="${IFACE:-$(ip route show default | awk '{print $5}' | head -1)}"
TC="tc"
[[ $EUID -ne 0 ]] && TC="sudo -n tc"
[[ -n "$IFACE" ]] || { echo "could not detect IFACE" >&2; exit 1; }

# Restore whatever the box uses by default (here: fq, set by net.core.default_qdisc).
default_qdisc="$(sysctl -n net.core.default_qdisc 2>/dev/null || echo pfifo_fast)"

$TC qdisc del dev "$IFACE" root 2>/dev/null || true

if [[ "${1:-}" == "off" ]]; then
  if [[ "$default_qdisc" != "pfifo_fast" ]]; then
    $TC qdisc add dev "$IFACE" root "$default_qdisc" 2>/dev/null || true
  fi
  echo "netem off on $IFACE (root restored to ${default_qdisc})"
  $TC qdisc show dev "$IFACE"
  exit 0
fi

DELAY_MS="${1:?one-way delay ms}"
RATE_MBPS="${2:?rate Mbps}"
LOSS_PCT="${3:-0}"
# netsim's bottleneck is --queue-pkts 500 per direction; match it so the drop-tail depth
# is the same instrument. netem's own default limit is 1000.
LIMIT="${4:-500}"

NETEM=(netem limit "$LIMIT")
[[ "$DELAY_MS" != "0" ]] && NETEM+=(delay "${DELAY_MS}ms")
NETEM+=(rate "${RATE_MBPS}mbit")
case "$LOSS_PCT" in
  0|0.0|0.00) ;;
  *) NETEM+=(loss "${LOSS_PCT}%") ;;
esac

$TC qdisc add dev "$IFACE" root handle 1: prio bands 3 \
  priomap 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0
$TC qdisc add dev "$IFACE" parent 1:1 handle 10: "${NETEM[@]}"
$TC qdisc add dev "$IFACE" parent 1:2 handle 20: pfifo
$TC qdisc add dev "$IFACE" parent 1:3 handle 30: pfifo
$TC filter add dev "$IFACE" parent 1:0 protocol ip prio 1 u32 \
  match ip dport 22 0xffff flowid 1:2
$TC filter add dev "$IFACE" parent 1:0 protocol ip prio 1 u32 \
  match ip sport 22 0xffff flowid 1:2

echo "netem on $IFACE: delay=${DELAY_MS}ms rate=${RATE_MBPS}mbit loss=${LOSS_PCT}% limit=${LIMIT}p (ssh:22 bypassed)"
$TC qdisc show dev "$IFACE" | sed 's/^/  /'
