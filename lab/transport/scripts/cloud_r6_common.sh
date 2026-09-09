#!/usr/bin/env bash
# Shared helpers for running R6 against the Oracle rig. The *_cloud.sh variants beside the
# netsim scripts all source this, so deploy, shaping and CPU accounting stay identical.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
export ROOT

CLOUD_HOST="${CLOUD_HOST:-168.138.130.163}"
CLOUD_USER="${CLOUD_USER:-ubuntu}"
CLOUD_PORT="${CLOUD_PORT:-4435}"
CLOUD_URL="${CLOUD_URL:-https://${CLOUD_HOST}:${CLOUD_PORT}/}"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/id_ed25519_rig_agent}"
REMOTE="${CLOUD_USER}@${CLOUD_HOST}"
REMOTE_WT=/home/ubuntu/wt-pacs

SSH_KNOWN_HOSTS="${SSH_KNOWN_HOSTS:-$ROOT/.local/r2/known_hosts}"
mkdir -p "$(dirname "$SSH_KNOWN_HOSTS")" "$ROOT/.local/r6cloud"
[[ -f "$SSH_KNOWN_HOSTS" ]] || ssh-keyscan -H "$CLOUD_HOST" >>"$SSH_KNOWN_HOSTS" 2>/dev/null || true

# Multiplexed: a fresh handshake per round trip costs more than the gap being measured.
SSH_CTL="$ROOT/.local/r6cloud/cm-%r@%h:%p"
SSH_OPTS=(-i "$SSH_KEY" -o BatchMode=yes -o IdentitiesOnly=yes
  -o UserKnownHostsFile="$SSH_KNOWN_HOSTS" -o StrictHostKeyChecking=yes
  -o ControlMaster=auto -o ControlPath="$SSH_CTL" -o ControlPersist=600)
SSH=(ssh "${SSH_OPTS[@]}" "$REMOTE")
SCP=(scp "${SSH_OPTS[@]}")

HARNESS="${HARNESS:-$ROOT/target/release/window-harness}"
SRV_BIN="${SRV_BIN:-$ROOT/target/lab-arms/exact-server-seg10}"
CERT="${CERT:-$ROOT/server/dev-cert/cert.pem}"
KEY_PEM="${KEY_PEM:-$ROOT/server/dev-cert/key.pem}"

# ---- shaping -----------------------------------------------------------------------
r6_sync_scripts() {
  "${SSH[@]}" "mkdir -p $REMOTE_WT/bin $REMOTE_WT/cert $REMOTE_WT/fixtures $REMOTE_WT/scripts"
  "${SCP[@]}" -q "$ROOT/lab/transport/scripts/cloud_netem_exact.sh" "$REMOTE:$REMOTE_WT/scripts/"
  "${SSH[@]}" "chmod +x $REMOTE_WT/scripts/cloud_netem_exact.sh"
}

# r6_netem <one_way_delay_ms> <rate_mbps> <loss_pct> [limit] | r6_netem off
r6_netem() {
  "${SSH[@]}" "sudo -n $REMOTE_WT/scripts/cloud_netem_exact.sh $*"
}

# Reset netem's own counters so a per-row read is that row's drops, not the campaign's.
r6_netem_reset_stats() {
  local iface
  iface=$("${SSH[@]}" "ip route show default | awk '{print \$5}' | head -1")
  "${SSH[@]}" "sudo -n tc -s qdisc show dev $iface >/dev/null 2>&1 || true"
}

# netem's drops on the shaped band, cumulative — the rig's analogue of netsim's down_queue,
# and the only way to tell a cell that lost what it was told from one whose queue collapsed.
r6_netem_drops() {
  "${SSH[@]}" "tc -s -j qdisc show dev \$(ip route show default | awk '{print \$5}' | head -1) 2>/dev/null" \
    | python3 -c "
import json,sys
try: qs=json.load(sys.stdin)
except Exception: print(0); raise SystemExit
for q in qs:
    if q.get('kind')=='netem':
        print(int(q.get('drops',0))); raise SystemExit
print(0)
"
}

# ---- server ------------------------------------------------------------------------
r6_upload_server() {
  local bin="${1:-$SRV_BIN}"
  "${SSH[@]}" "mkdir -p $REMOTE_WT/bin $REMOTE_WT/cert $REMOTE_WT/fixtures"
  "${SSH[@]}" 'pkill -x exact-server 2>/dev/null || true; sleep 0.5'
  "${SCP[@]}" -q "$bin" "$REMOTE:$REMOTE_WT/bin/exact-server.new"
  "${SCP[@]}" -q "$CERT" "$KEY_PEM" "$REMOTE:$REMOTE_WT/cert/"
  "${SSH[@]}" "mv -f $REMOTE_WT/bin/exact-server.new $REMOTE_WT/bin/exact-server && chmod +x $REMOTE_WT/bin/exact-server"
}

r6_upload_fixture() {
  local local_sbnd="$1"
  local base; base="$(basename "$local_sbnd")"
  local want; want="$(stat -c%s "$local_sbnd")"
  local have; have=$("${SSH[@]}" "stat -c%s $REMOTE_WT/fixtures/$base 2>/dev/null || echo 0")
  if [[ "$have" != "$want" ]]; then
    echo "==> uploading fixture $base ($((want/1000000)) MB)" >&2
    "${SCP[@]}" -q "$local_sbnd" "$REMOTE:$REMOTE_WT/fixtures/$base"
  fi
  echo "$REMOTE_WT/fixtures/$base"
}

# r6_start_server <remote_study> <extra server flags...>
# Restarts exact-server with this arm's flags and returns its pid on stdout.
r6_start_server() {
  local study="$1"; shift
  # printf %q, because ssh flattens argv and the remote shell resplits it.
  local flags="$*"
  "${SSH[@]}" "bash -s $(printf '%q %q %q' "$CLOUD_PORT" "$study" "$flags")" <<'REMOTE'
set -euo pipefail
PORT=$1; STUDY=$2; FLAGS=$3
pkill -x exact-server 2>/dev/null || true
for _ in $(seq 1 40); do pgrep -x exact-server >/dev/null || break; sleep 0.1; done
> /tmp/wt-pacs-exact.log
# shellcheck disable=SC2086
setsid env RUST_LOG=info nohup /home/ubuntu/wt-pacs/bin/exact-server \
  --port "$PORT" --study "$STUDY" \
  --cert-pem /home/ubuntu/wt-pacs/cert/cert.pem \
  --key-pem /home/ubuntu/wt-pacs/cert/key.pem \
  $FLAGS > /tmp/wt-pacs-exact.log 2>&1 < /dev/null &
disown
for _ in $(seq 1 100); do grep -q '^wt_url=' /tmp/wt-pacs-exact.log && break; sleep 0.1; done
pgrep -x exact-server || { echo "exact-server failed to start:" >&2; cat /tmp/wt-pacs-exact.log >&2; exit 1; }
REMOTE
}

r6_stop_server() { "${SSH[@]}" 'pkill -x exact-server 2>/dev/null || true' ; }

# Remote utime+stime — what makes CPU-per-byte answerable here and not under netsim.
r6_srv_cpu() {
  local pid="$1"
  "${SSH[@]}" "awk -v t=\$(getconf CLK_TCK) '{print (\$14+\$15)/t}' /proc/$pid/stat 2>/dev/null || echo 0"
}
