#!/usr/bin/env bash
# L1 v3 — netem on the S4 veth pair (not ens3).
# Forward path (veth-srv → client) carries delay + rate + loss.
# Return path (veth-cli → server) carries delay + rate only.
#
# usage: l1_veth_netem.sh {off|RTT_ms} [loss_pct] [loss_model]
#   loss_model: iid (default) | gemodel   (C5; GE_P/GE_R, defaults 0.07 / 14)
set -euo pipefail

PROFILE="${1:-}"
LOSS_PCT="${2:-0}"
LOSS_MODEL="${3:-iid}"
GE_P="${GE_P:-0.07}"
GE_R="${GE_R:-14}"
NS="${NS:-wt-cli}"
VETH_SRV="${VETH_SRV:-veth-srv}"
VETH_CLI="${VETH_CLI:-veth-cli}"
RATE="${RATE:-10mbit}"

if [[ $EUID -ne 0 ]]; then
  exec sudo -n env GE_P="$GE_P" GE_R="$GE_R" NS="$NS" VETH_SRV="$VETH_SRV" \
    VETH_CLI="$VETH_CLI" RATE="$RATE" "$0" "$@"
fi

[[ -n "$PROFILE" ]] || {
  echo "usage: $0 {off|RTT_ms} [loss_pct] [loss_model]" >&2
  exit 1
}

clear_qdisc() {
  local dev=$1
  tc qdisc del dev "$dev" root 2>/dev/null || true
}

loss_args_for() {
  local loss=$1 model=$2
  LOSS_ARGS=()
  case "$model" in
    iid|"")
      if [[ "$loss" != "0" && "$loss" != "0.0" ]]; then
        LOSS_ARGS=(loss "${loss}%")
      fi
      ;;
    gemodel)
      LOSS_ARGS=(loss gemodel "${GE_P}%" "${GE_R}%")
      ;;
    *)
      echo "unknown loss_model: $model (want iid|gemodel)" >&2
      exit 1
      ;;
  esac
}

case "$PROFILE" in
  off)
    clear_qdisc "$VETH_SRV"
    ip netns exec "$NS" tc qdisc del dev "$VETH_CLI" root 2>/dev/null || true
    echo "netem off on $VETH_SRV / ns/$NS/$VETH_CLI"
    ;;
  *)
    if ! [[ "$PROFILE" =~ ^[0-9]+$ ]]; then
      echo "unknown profile: $PROFILE" >&2
      exit 1
    fi
    one_way=$((PROFILE / 2))
    loss_args_for "$LOSS_PCT" "$LOSS_MODEL"
    clear_qdisc "$VETH_SRV"
    tc qdisc replace dev "$VETH_SRV" root netem delay "${one_way}ms" rate "$RATE" "${LOSS_ARGS[@]}"
    # Return path: delay + rate only (no loss), matching the work order.
    ip netns exec "$NS" tc qdisc replace dev "$VETH_CLI" root \
      netem delay "${one_way}ms" rate "$RATE"
    echo "netem veth: RTT≈${PROFILE}ms delay=${one_way}ms rate=$RATE loss=${LOSS_PCT}% model=$LOSS_MODEL"
    ;;
esac

echo "--- $VETH_SRV ---"
tc qdisc show dev "$VETH_SRV" || true
echo "--- ns/$NS $VETH_CLI ---"
ip netns exec "$NS" tc qdisc show dev "$VETH_CLI" || true
