#!/usr/bin/env bash
# Shared helpers for cloud-side measurements (harness local → exact-server on E2).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
export ROOT

CLOUD_HOST="${CLOUD_HOST:-168.138.130.163}"
CLOUD_USER="${CLOUD_USER:-ubuntu}"
CLOUD_PORT="${CLOUD_PORT:-4435}"
CLOUD_URL="${CLOUD_URL:-https://${CLOUD_HOST}:${CLOUD_PORT}/}"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/id_ed25519_rig_agent}"
REMOTE="${CLOUD_USER}@${CLOUD_HOST}"
REMOTE_WT="$REMOTE:/home/ubuntu/wt-pacs"
# Prefer workspace known_hosts (cloud agents often lack ~/.ssh/known_hosts entry).
SSH_KNOWN_HOSTS="${SSH_KNOWN_HOSTS:-$ROOT/.local/r2/known_hosts}"
mkdir -p "$(dirname "$SSH_KNOWN_HOSTS")"
[[ -f "$SSH_KNOWN_HOSTS" ]] || ssh-keyscan -H "$CLOUD_HOST" >>"$SSH_KNOWN_HOSTS" 2>/dev/null || true

SSH=(ssh -i "$SSH_KEY" -o BatchMode=yes -o IdentitiesOnly=yes
  -o UserKnownHostsFile="$SSH_KNOWN_HOSTS" -o StrictHostKeyChecking=yes "$REMOTE")
SCP=(scp -i "$SSH_KEY" -o BatchMode=yes -o IdentitiesOnly=yes
  -o UserKnownHostsFile="$SSH_KNOWN_HOSTS" -o StrictHostKeyChecking=yes)

# Harness: no client-side shaping — wire cap is on the server via cloud_netem.sh
HARNESS_READ_BPS="${HARNESS_READ_BPS:-1000000000}"

export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-$ROOT/target}"
HARNESS="${HARNESS:-$CARGO_TARGET_DIR/release/window-harness}"

cloud_precheck_ratio() {
  local frame_bytes=$1 link_mbps=$2 step_ms=$3 label=${4:-cell}
  python3 -c "
fb=int('$frame_bytes'); mbps=float('$link_mbps'); step=int('$step_ms'); label='$label'
bps=mbps*1_000_000
supply=bps/(fb*8)
demand=1000.0/step
ratio=demand/supply
live='live' if ratio >= 1.0 else 'DEAD'
print(f'{live} {label}: demand/supply={ratio:.2f} (reader {demand:.1f} f/s, link {supply:.1f} f/s @ {mbps:.0f} Mbps, {fb} B frames, {step} ms/step)')
if ratio < 1.0:
    raise SystemExit(2)
"
}

cloud_set_netem() {
  # Args: profile [loss_pct] [loss_model]
  # loss_model: iid (default) | gemodel  (C5; gemodel uses GE_P/GE_R on the rig)
  local profile=$1
  local loss=${2:-0}
  local model=${3:-iid}
  "${SSH[@]}" "GE_P=${GE_P:-0.07} GE_R=${GE_R:-14} sudo -n -E /home/ubuntu/wt-pacs/scripts/cloud_netem.sh $profile $loss $model"
}

cloud_ensure_server() {
  "${SSH[@]}" 'pgrep -x exact-server >/dev/null || {
    echo "exact-server not running — run deploy_exact_server_cloud.sh" >&2
    exit 1
  }'
}

cloud_sync_netem_script() {
  "${SCP[@]}" "$ROOT/lab/scripts/cloud_netem.sh" "$REMOTE_WT/scripts/cloud_netem.sh"
  "${SSH[@]}" "chmod +x /home/ubuntu/wt-pacs/scripts/cloud_netem.sh"
}

run_cloud_harness() {
  local trace=$1 depth=$2 arm=$3 frame_count=${4:-320}
  [[ -x "$HARNESS" ]] || { echo "missing harness — SKIP_BUILD=1 after cargo build" >&2; exit 1; }
  "$HARNESS" --url "$CLOUD_URL" --trace "$trace" \
    --read-bps "$HARNESS_READ_BPS" --depth "$depth" --frame-count "$frame_count" \
    --fill-dwell-ms 0 --mode trace --arm "$arm" --rtt-ms 0 --json
}

ensure_harness_binary() {
  if [[ "${SKIP_BUILD:-0}" == "1" ]]; then
    [[ -x "$HARNESS" ]] || { echo "SKIP_BUILD=1 but missing $HARNESS" >&2; exit 1; }
  else
    cargo build -p window-harness --release >/dev/null
  fi
}
