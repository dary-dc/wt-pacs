#!/usr/bin/env bash
# Server-side tc shaping for wt-pacs cloud measurements.
# Run ON the cloud box (root/sudo). SSH port bypass keeps the rig reachable.
#
# Usage: cloud_netem.sh {off|stats|20|30|50|60|90|150|180} [loss_pct] [limit_pkts]
#
# Legacy profiles target TOTAL RTT including ~30 ms base WAN path:
#   30  — 10 Mbps cap only (no added delay)
#   50  — +10 ms one-way delay (~+20 ms RTT)
#   90  — +30 ms one-way
#   180 — +75 ms one-way
#
# Campaign profiles 20/60/150 use one-way delay = N/2 ms (named RTT), rate 10mbit.
# Optional second arg: loss percent (e.g. 0.5). Default 0.
# Optional third arg: netem queue limit in packets. Default 1000 (netem's own default, which at
# 10 Mbit and 1.2 KB packets is ~1 s of queue — a shallower limit turns a burst into drops).
# `stats` prints the netem qdisc's sent/dropped counters (tc -s) for the campaign TSV.
# WAN RTT adds on top equally for every arm.
set -euo pipefail

PROFILE="${1:-}"
LOSS_PCT="${2:-0}"
LIMIT_PKTS="${3:-1000}"
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
usage: $0 {off|stats|20|30|50|60|90|150|180} [loss_pct] [limit_pkts]
  off            remove shaping
  stats          print netem sent/dropped counters
  30             rate ${RATE} only (legacy)
  50|90|180      legacy total-RTT targets
  20|60|150      rate ${RATE} + one-way delay = N/2 ms
  loss_pct       optional; default 0 (e.g. 0.5)
  limit_pkts     optional netem queue limit; default 1000
EOF
}

[[ -n "$PROFILE" && "$PROFILE" != "-h" && "$PROFILE" != "--help" ]] || {
  usage
  exit 1
}

# NEVER delete the qdisc here. The v4 campaign calls `stats` twice per run; a delete
# before `case` wiped rate/delay/loss after the path-RTT probe and zeroed every
# `netem_drops` cell (182 rows, 2026-09-07). Those rows are void.

apply_netem() {
  local delay_ms="${1:-0}"
  local loss="${2:-0}"
  $TC qdisc del dev "$IFACE" root 2>/dev/null || true
  $TC qdisc add dev "$IFACE" root handle 1: prio bands 3 \
    priomap 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0
  local netem_args=(rate "$RATE" limit "$LIMIT_PKTS")
  if [[ "$delay_ms" != "0" ]]; then
    netem_args+=(delay "${delay_ms}ms")
  fi
  if [[ "$loss" != "0" && "$loss" != "0.0" ]]; then
    netem_args+=(loss "${loss}%")
  fi
  $TC qdisc add dev "$IFACE" parent 1:1 handle 10: netem "${netem_args[@]}"
  $TC qdisc add dev "$IFACE" parent 1:2 handle 20: pfifo
  $TC qdisc add dev "$IFACE" parent 1:3 handle 30: pfifo
  $TC filter add dev "$IFACE" parent 1:0 protocol ip prio 1 u32 \
    match ip dport 22 0xffff flowid 1:2
  $TC filter add dev "$IFACE" parent 1:0 protocol ip prio 1 u32 \
    match ip sport 22 0xffff flowid 1:2
}

case "$PROFILE" in
  stats)
    $TC -s qdisc show dev "$IFACE" | awk '/netem/{f=1} f&&/Sent/{print; exit}'
    exit 0
    ;;
  off)
    $TC qdisc del dev "$IFACE" root 2>/dev/null || true
    echo "netem off on $IFACE"
    ;;
  30)
    apply_netem 0 "$LOSS_PCT"
    echo "netem on $IFACE: rate=$RATE loss=${LOSS_PCT}% (target RTT~30 ms base)"
    ;;
  50)
    apply_netem 10 "$LOSS_PCT"
    echo "netem on $IFACE: rate=$RATE delay 10ms loss=${LOSS_PCT}% (target RTT~50 ms)"
    ;;
  90)
    apply_netem 30 "$LOSS_PCT"
    echo "netem on $IFACE: rate=$RATE delay 30ms loss=${LOSS_PCT}% (target RTT~90 ms)"
    ;;
  180)
    apply_netem 75 "$LOSS_PCT"
    echo "netem on $IFACE: rate=$RATE delay 75ms loss=${LOSS_PCT}% (target RTT~180 ms)"
    ;;
  20|60|150)
    one_way=$((PROFILE / 2))
    apply_netem "$one_way" "$LOSS_PCT"
    echo "netem on $IFACE: rate=$RATE delay ${one_way}ms loss=${LOSS_PCT}% limit=${LIMIT_PKTS} (named RTT ${PROFILE} ms)"
    ;;
  *)
    echo "unknown profile: $PROFILE" >&2
    usage
    exit 1
    ;;
esac
