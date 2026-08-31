#!/usr/bin/env bash
# Wait until Oracle SP rig is idle (no foreign harness sessions), then run L1 v2.
# Round-robin: do not start while another lane is opening sessions.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
export SSH_KEY="${SSH_KEY:-$HOME/.ssh/id_ed25519_rig_agent}"
source "$ROOT/lab/scripts/cloud_common.sh"

IDLE_SECS="${IDLE_SECS:-300}"   # no new sessions for this long
POLL_SECS="${POLL_SECS:-30}"
LOG="${LOG:-$ROOT/.local/r2/l1v2/WAIT.log}"
mkdir -p "$(dirname "$LOG")"
exec > >(tee -a "$LOG") 2>&1

echo "=== L1 wait-for-rig $(date -Iseconds) idle=${IDLE_SECS}s ==="

last_count=-1
idle_since=""

while true; do
  info=$("${SSH[@]}" 'bash -s' <<'REMOTE'
set -euo pipefail
holder=$(cat /home/ubuntu/wt-pacs/locks/netem.holder 2>/dev/null || true)
count=0
if [[ -f /tmp/wt-pacs-exact.log ]]; then
  count=$(grep -c "session opened" /tmp/wt-pacs-exact.log || true)
  age=$(( $(date +%s) - $(stat -c %Y /tmp/wt-pacs-exact.log) ))
else
  age=99999
fi
conn=$(ss -tn state established '( sport = :4435 )' 2>/dev/null | awk 'NR>1' | wc -l)
netem=$(tc qdisc show dev ens3 2>/dev/null | grep -oE 'delay [^ ]+( loss [^ ]+)?' || echo none)
printf 'holder=%s\ncount=%s\nage=%s\nconn=%s\nnetem=%s\n' "${holder:-}" "${count:-0}" "$age" "${conn:-0}" "$netem"
REMOTE
)

  echo "$(date -Iseconds) $info"
  holder=$(echo "$info" | awk -F= '/^holder=/{print substr($0,8)}')
  count=$(echo "$info" | awk -F= '/^count=/{print $2}')
  age=$(echo "$info" | awk -F= '/^age=/{print $2}')
  conn=$(echo "$info" | awk -F= '/^conn=/{print $2}')

  # Foreign lock (not ours) → wait.
  if [[ -n "$holder" && "$holder" != L1-v2* ]]; then
    echo "foreign holder: $holder — waiting"
    idle_since=""
    last_count=$count
    sleep "$POLL_SECS"
    continue
  fi

  # Active TCP to 4435 or recent session → busy.
  if [[ "${conn:-0}" -gt 0 ]]; then
    echo "established conns=$conn — waiting"
    idle_since=""
    last_count=$count
    sleep "$POLL_SECS"
    continue
  fi

  if [[ "$count" != "$last_count" ]]; then
    echo "session count changed $last_count → $count — reset idle"
    last_count=$count
    idle_since=$(date +%s)
    sleep "$POLL_SECS"
    continue
  fi

  # Also require log mtime age ≥ IDLE_SECS (covers count stuck but file updating).
  if [[ "${age:-0}" -lt "$IDLE_SECS" ]]; then
    echo "log age=${age}s < ${IDLE_SECS}s — waiting"
    sleep "$POLL_SECS"
    continue
  fi

  now=$(date +%s)
  if [[ -z "$idle_since" ]]; then
    idle_since=$now
  fi
  idle_for=$((now - idle_since))
  if [[ "$idle_for" -lt "$IDLE_SECS" ]]; then
    echo "stable idle_for=${idle_for}s need ${IDLE_SECS}s"
    sleep "$POLL_SECS"
    continue
  fi

  echo "RIG FREE (idle_for=${idle_for}s age=${age}s conn=0 holder='${holder}') — starting L1 v2"
  break
done

exec bash "$ROOT/lab/scripts/l1_loss_run_v2_cloud.sh"
