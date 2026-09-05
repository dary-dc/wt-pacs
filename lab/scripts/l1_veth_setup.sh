#!/usr/bin/env bash
# L1 v3 S4 — shaped veth pair between root-ns servers and wt-cli harness.
# Idempotent. Run on the rig (needs sudo -n).
#
# Topology:
#   root ns: exact-server* on 10.77.0.1:{4435,4436,4437}  ·  veth-srv
#   wt-cli:  window-harness → https://10.77.0.1:PORT/      ·  veth-cli @ 10.77.0.2
set -euo pipefail

NS="${NS:-wt-cli}"
VETH_SRV="${VETH_SRV:-veth-srv}"
VETH_CLI="${VETH_CLI:-veth-cli}"
SRV_IP="${SRV_IP:-10.77.0.1}"
CLI_IP="${CLI_IP:-10.77.0.2}"
MTU="${MTU:-1500}"

if [[ $EUID -ne 0 ]]; then
  exec sudo -n "$0" "$@"
fi

ip netns add "$NS" 2>/dev/null || true

# Recreate the pair if either end is missing.
if ! ip link show "$VETH_SRV" &>/dev/null || ! ip netns exec "$NS" ip link show "$VETH_CLI" &>/dev/null; then
  ip link del "$VETH_SRV" 2>/dev/null || true
  ip netns exec "$NS" ip link del "$VETH_CLI" 2>/dev/null || true
  ip link add "$VETH_SRV" type veth peer name "$VETH_CLI"
  ip link set "$VETH_CLI" netns "$NS"
fi

ip addr replace "${SRV_IP}/24" dev "$VETH_SRV"
ip link set "$VETH_SRV" mtu "$MTU" up

ip netns exec "$NS" ip addr replace "${CLI_IP}/24" dev "$VETH_CLI"
ip netns exec "$NS" ip link set "$VETH_CLI" mtu "$MTU" up
ip netns exec "$NS" ip link set lo up

# Hard fail if MTU drifted (loopback-class MTUs void the loss model).
srv_mtu=$(cat /sys/class/net/"$VETH_SRV"/mtu)
cli_mtu=$(ip netns exec "$NS" cat /sys/class/net/"$VETH_CLI"/mtu)
if [[ "$srv_mtu" -ne "$MTU" || "$cli_mtu" -ne "$MTU" ]]; then
  echo "STOP: MTU want=$MTU srv=$srv_mtu cli=$cli_mtu" >&2
  exit 1
fi

echo "OK veth: $VETH_SRV=$SRV_IP mtu=$srv_mtu ↔ ns/$NS $VETH_CLI=$CLI_IP mtu=$cli_mtu"
