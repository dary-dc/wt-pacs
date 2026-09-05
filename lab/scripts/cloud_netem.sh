#!/usr/bin/env bash
# Server-side tc shaping for wt-pacs cloud measurements.
# Run ON the cloud box (root/sudo). SSH port bypass keeps the rig reachable.
#
# Usage: cloud_netem.sh {off|20|30|50|60|90|150|180}
#
# Legacy profiles target TOTAL RTT including ~30 ms base WAN path:
#   30  — 10 Mbps cap only (no added delay)
#   50  — +10 ms one-way delay (~+20 ms RTT)
#   90  — +30 ms one-way
#   180 — +75 ms one-way
#
# Campaign profiles 20/60/150 use one-way delay = N/2 ms (named RTT), rate 10mbit.
# WAN RTT adds on top equally for every arm.
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
usage: $0 {off|20|30|50|60|90|150|180} [loss_pct] [loss_model]
  off            remove shaping
  30             rate ${RATE} only (legacy)
  50|90|180      legacy total-RTT targets
  20|60|150      rate ${RATE} + one-way delay = N/2 ms
  loss_pct       optional netem loss percent (default 0)
  loss_model     iid (default) | gemodel
                 gemodel uses GE_P/GE_R (defaults 0.07 / 14 → ~0.5% mean, burst ≈7)
EOF
}

[[ -n "$PROFILE" && "$PROFILE" != "-h" && "$PROFILE" != "--help" ]] || {
  usage
  exit 1
}

$TC qdisc del dev "$IFACE" root 2>/dev/null || true

# Optional second arg: loss percent (e.g. 0.5, 2). Default 0.
LOSS_PCT="${2:-0}"
# Optional third arg: loss model (C5). iid | gemodel
LOSS_MODEL="${3:-iid}"
GE_P="${GE_P:-0.07}"
GE_R="${GE_R:-14}"

loss_args_for() {
  local loss="$1"
  local model="$2"
  LOSS_ARGS=()
  case "$model" in
    iid|"")
      if [[ "$loss" != "0" && "$loss" != "0.0" ]]; then
        LOSS_ARGS=(loss "${loss}%")
      fi
      ;;
    gemodel)
      # Mean loss ≈ p/(p+r); with defaults 0.07/(0.07+14) ≈ 0.5%, mean burst 1/r ≈ 7 packets.
      LOSS_ARGS=(loss gemodel "${GE_P}%" "${GE_R}%")
      ;;
    *)
      echo "unknown loss_model: $model (want iid|gemodel)" >&2
      exit 1
      ;;
  esac
}

apply_netem() {
  local delay_ms="${1:-0}"
  local loss="${2:-0}"
  local model="${3:-iid}"
  loss_args_for "$loss" "$model"
  $TC qdisc add dev "$IFACE" root handle 1: prio bands 3 \
    priomap 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0
  if [[ "$delay_ms" == "0" ]]; then
    $TC qdisc add dev "$IFACE" parent 1:1 handle 10: netem rate "$RATE" "${LOSS_ARGS[@]}"
  else
    $TC qdisc add dev "$IFACE" parent 1:1 handle 10: netem delay "${delay_ms}ms" rate "$RATE" "${LOSS_ARGS[@]}"
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
    apply_netem 0 "$LOSS_PCT" "$LOSS_MODEL"
    echo "netem on $IFACE: rate=$RATE loss=${LOSS_PCT}% model=$LOSS_MODEL (no added delay)"
    ;;
  50)
    apply_netem 10 "$LOSS_PCT" "$LOSS_MODEL"
    echo "netem on $IFACE: rate=$RATE delay 10ms loss=${LOSS_PCT}% model=$LOSS_MODEL"
    ;;
  90)
    apply_netem 30 "$LOSS_PCT" "$LOSS_MODEL"
    echo "netem on $IFACE: rate=$RATE delay 30ms loss=${LOSS_PCT}% model=$LOSS_MODEL"
    ;;
  180)
    apply_netem 75 "$LOSS_PCT" "$LOSS_MODEL"
    echo "netem on $IFACE: rate=$RATE delay 75ms loss=${LOSS_PCT}% model=$LOSS_MODEL"
    ;;
  20|60|150)
    one_way=$((PROFILE / 2))
    apply_netem "$one_way" "$LOSS_PCT" "$LOSS_MODEL"
    echo "netem on $IFACE: rate=$RATE delay ${one_way}ms loss=${LOSS_PCT}% model=$LOSS_MODEL (named RTT ${PROFILE} ms)"
    ;;
  *)
    echo "unknown profile: $PROFILE" >&2
    usage
    exit 1
    ;;
esac
