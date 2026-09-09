#!/usr/bin/env bash
# Shared Oracle São Paulo rig lock — L1 / L2 round-robin.
# Source after cloud_common.sh. Requires SSH / REMOTE / SSH_KEY.
#
# Usage:
#   RIG_LOCK_HOLDER=L2
#   source lab/scripts/rig_lock.sh
#   rig_lock_acquire   # exit 75 if held by another lane
#   ... shape / measure ...
#   rig_lock_release
set -euo pipefail

RIG_LOCK_PATH="${RIG_LOCK_PATH:-/tmp/wt-pacs-rig.lock}"
RIG_LOCK_HOLDER="${RIG_LOCK_HOLDER:?set RIG_LOCK_HOLDER to L1 or L2}"

rig_lock_acquire() {
  "${SSH[@]}" "bash -s" "$RIG_LOCK_HOLDER" "$RIG_LOCK_PATH" <<'REMOTE'
set -euo pipefail
HOLDER=$1
LOCK=$2
if [[ -f "$LOCK" ]]; then
  cur=$(cat "$LOCK" 2>/dev/null || true)
  if [[ -n "$cur" && "$cur" != "$HOLDER" ]]; then
    echo "rig locked by '$cur' — $HOLDER waits (round-robin)" >&2
    exit 75
  fi
fi
# Foreign netem without our lock: another agent shaping without the lock file.
if sudo -n tc qdisc show 2>/dev/null | grep -q netem; then
  if [[ ! -f "$LOCK" ]] || [[ "$(cat "$LOCK" 2>/dev/null || true)" != "$HOLDER" ]]; then
    echo "netem already active and lock not held by $HOLDER — waiting" >&2
    exit 75
  fi
fi
echo "$HOLDER" > "$LOCK"
echo "rig acquired by $HOLDER"
REMOTE
}

rig_lock_release() {
  "${SSH[@]}" "bash -s" "$RIG_LOCK_HOLDER" "$RIG_LOCK_PATH" <<'REMOTE'
set -euo pipefail
HOLDER=$1
LOCK=$2
if [[ -f "$LOCK" ]] && [[ "$(cat "$LOCK" 2>/dev/null || true)" == "$HOLDER" ]]; then
  rm -f "$LOCK"
  echo "rig released by $HOLDER"
fi
REMOTE
}
