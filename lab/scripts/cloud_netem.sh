#!/usr/bin/env bash
# Server-side tc shaping for wt-pacs cloud measurements.
# Run ON the cloud box (root/sudo). SSH port bypass keeps the rig reachable.
#
# Usage: cloud_netem.sh {off|30|50|90|180}
#
# Profiles target TOTAL RTT including ~30 ms base WAN path:
#   30  — 10 Mbps cap only (no added delay)
#   50  — +10 ms one-way delay (~+20 ms RTT)
#   90  — +30 ms one-way
#   180 — +75 ms one-way
set -euo pipefail

PROFILE="${1:-}"
IFACE="${IFACE:-$(ip route show default | awk '{print $5}' | head -1)}"
RATE="${RATE:-10mbit}"

TC="tc"
if [[ $EUID -ne 0 ]]; then
  TC="sudo -n tc"
fi

if [[ -z "$IFACE" ]]; then
  echo "could not detect IFACE" >&2
  exit 1
fi

usage() {
  cat >&2 <<EOF
usage: $0 {off|30|50|90|180}
  off   remove shaping
  30    rate ${RATE} only
  50|90|180  rate ${RATE} + added one-way delay
EOF
}

[[ -n "$PROFILE" && "$PROFILE" != "-h" && "$PROFILE" != "--help" ]] || {
  usage
  exit 1
}

$TC qdisc del dev "$IFACE" root 2>/dev/null || true

apply_netem() {
  local delay_ms="${1:-0}"
  $TC qdisc add dev "$IFACE" root handle 1: prio bands 3 \
    priomap 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0
  if [[ "$delay_ms" == "0" ]]; then
    $TC qdisc add dev "$IFACE" parent 1:1 handle 10: netem rate "$RATE"
  else
    $TC qdisc add dev "$IFACE" parent 1:1 handle 10: netem delay "${delay_ms}ms" rate "$RATE"
  fi
  $TC qdisc add dev "$IFACE" parent 1:2 handle 20: pfifo
  $TC qdisc add dev "$IFACE" parent 1:3 handle 30: pfifo
  $TC filter add dev "$IFACE" parent 1:0 protocol ip prio 1 u32 \
    match ip dport 22 0xffff flowid 1:2
  $TC filter add dev "$IFACE" parent 1:0 protocol ip prio 1 u32 \
    match ip sport 22 0xffff flowid 1:2
}

case "$PROFILE" in
  off)
    echo "netem off on $IFACE"
    ;;
  30)
    apply_netem 0
    echo "netem on $IFACE: rate=$RATE (target RTT~30 ms base)"
    ;;
  50)
    apply_netem 10
    echo "netem on $IFACE: rate=$RATE delay 10ms (target RTT~50 ms)"
    ;;
  90)
    apply_netem 30
    echo "netem on $IFACE: rate=$RATE delay 30ms (target RTT~90 ms)"
    ;;
  180)
    apply_netem 75
    echo "netem on $IFACE: rate=$RATE delay 75ms (target RTT~180 ms)"
    ;;
  *)
    echo "unknown profile: $PROFILE" >&2
    usage
    exit 1
    ;;
esac
