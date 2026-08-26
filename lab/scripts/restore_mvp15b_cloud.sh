#!/usr/bin/env bash
# Restore MVP1.5b field-test server on the Oracle E2 rig (stops wt-pacs exact-server).
set -euo pipefail
SERVER="${SERVER:-ubuntu@168.138.130.163}"
KEY="${KEY:-$HOME/.ssh/id_ed25519}"
SSH=(ssh -i "$KEY" -o BatchMode=yes "$SERVER")

"${SSH[@]}" 'bash -s' <<'REMOTE'
set -euo pipefail
pkill -x exact-server 2>/dev/null || true
sleep 1
cd /home/ubuntu/deck/lab
> /tmp/deck.log
setsid env \
  DECK_DB=/home/ubuntu/deck/lab/test_study.sqlite \
  DECK_SESSIONS_DIR=/home/ubuntu/deck/sessions \
  DECK_NETEM_SCRIPT=/home/ubuntu/deck/lab/mvp1-5b-datagram-push/scripts/netem.sh \
  RUST_LOG=info \
  nohup ./mvp1-5b-datagram-push/mvp1-5b-datagram-push > /tmp/deck.log 2>&1 < /dev/null &
disown
sleep 3
pgrep -x mvp1-5b-datagra || { tail -20 /tmp/deck.log; exit 1; }
ss -tulnp 2>/dev/null | grep -E "4435|4436" || true
REMOTE
echo "MVP1.5b restored on 168.138.130.163"
