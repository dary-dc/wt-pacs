#!/usr/bin/env bash
# Deploy exact-server to the deck-webtransport Oracle E2 rig for E0 / real-path runs.
# Uses UDP 4435 (already open at VCN + iptables). Briefly stops MVP1.5b bench server.
#
# Prereqs: ~/.ssh/id_ed25519, release binaries built, live-cell fixture present.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SERVER="${SERVER:-ubuntu@168.138.130.163}"
KEY="${KEY:-$HOME/.ssh/id_ed25519}"
SSH=(ssh -i "$KEY" -o BatchMode=yes "$SERVER")
SCP=(scp -i "$KEY")
PORT="${CLOUD_PORT:-4435}"
STUDY="${STUDY:-$ROOT/lab/fixtures/frames_250k_live/frames_250k_live.sbnd}"
CERT="${CERT:-$ROOT/server/dev-cert/cert.pem}"
KEY_PEM="${KEY_PEM:-$ROOT/server/dev-cert/key.pem}"
BIN="${BIN:-$ROOT/target/release/exact-server}"
REMOTE=/home/ubuntu/wt-pacs

[[ -x "$BIN" ]] || { echo "missing $BIN — cargo build -p exact-server --release" >&2; exit 1; }
[[ -f "$STUDY" ]] || { echo "missing study $STUDY" >&2; exit 1; }
[[ -f "$CERT" ]] || "$ROOT/server/scripts/gen_dev_cert.sh"

echo "==> stop servers on cloud (binary must not be running for scp)" >&2
"${SSH[@]}" 'pkill -x exact-server 2>/dev/null || true; pkill -x mvp1-5b-datagra 2>/dev/null || true; sleep 1'

echo "==> sync binary + cert + study (~80 MB) to $SERVER:$REMOTE" >&2
"${SSH[@]}" "mkdir -p $REMOTE/bin $REMOTE/cert $REMOTE/fixtures $REMOTE/scripts"
"${SCP[@]}" "$BIN" "$SERVER:$REMOTE/bin/exact-server.new"
"${SCP[@]}" "$CERT" "$KEY_PEM" "$SERVER:$REMOTE/cert/"
"${SCP[@]}" "$STUDY" "$SERVER:$REMOTE/fixtures/frames_250k_live.sbnd"
"${SCP[@]}" "$ROOT/lab/scripts/cloud_netem.sh" "$SERVER:$REMOTE/scripts/cloud_netem.sh"
"${SSH[@]}" "mv -f $REMOTE/bin/exact-server.new $REMOTE/bin/exact-server && chmod +x $REMOTE/bin/exact-server $REMOTE/scripts/cloud_netem.sh"

echo "==> restart exact-server on UDP $PORT" >&2
"${SSH[@]}" "bash -s" "$PORT" "$REMOTE" <<'REMOTE'
set -euo pipefail
PORT=$1
REMOTE=$2
pkill -x exact-server 2>/dev/null || true
sleep 1
chmod +x "$REMOTE/bin/exact-server"
> /tmp/wt-pacs-exact.log
setsid env RUST_LOG=info nohup "$REMOTE/bin/exact-server" \
  --port "$PORT" \
  --study "$REMOTE/fixtures/frames_250k_live.sbnd" \
  --cert-pem "$REMOTE/cert/cert.pem" \
  --key-pem "$REMOTE/cert/key.pem" \
  > /tmp/wt-pacs-exact.log 2>&1 < /dev/null &
disown
sleep 2
pgrep -x exact-server || { echo "exact-server failed to start:"; cat /tmp/wt-pacs-exact.log; exit 1; }
grep -E '^wt_url=|^cert_sha256=|^frames=' /tmp/wt-pacs-exact.log || cat /tmp/wt-pacs-exact.log
ss -ulnp 2>/dev/null | grep ":$PORT " || true
REMOTE

echo "CLOUD_URL=https://168.138.130.163:${PORT}/" >&2
