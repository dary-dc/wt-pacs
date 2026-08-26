#!/usr/bin/env bash
# Verify unshare + netem on lo works without host sudo (§0b local path).
# Safe to run alongside E1/E3 agents — read-only probe.
set -euo pipefail

if unshare --user --map-root-user --net -- bash -c '
  tc qdisc replace dev lo root netem delay 20ms &&
  tc qdisc show dev lo | grep -q netem &&
  tc qdisc del dev lo root
'; then
  echo "OK: unshare --user --map-root-user --net can netem lo"
  exit 0
fi

echo "FAIL: unshare netem probe failed" >&2
echo "Try: sudo tc qdisc replace dev lo root netem delay 20ms" >&2
exit 1
