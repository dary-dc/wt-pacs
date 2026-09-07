#!/usr/bin/env bash
# E0 for the L2 v4 campaign: does the rig accept the exact netem profile v4 will set?
# Checks rate, one-way delay, loss, and queue limit on the live box. Does not use the
# older e0_netem_validation.sh fixture (250 KB live-cell).
#
# Usage: lab/scripts/l2_e0_v4_profile.sh
# Exit 0 only if both profiles (loss 0 and 0.5 %) apply and tc reports the expected knobs.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
export SSH_KEY="${SSH_KEY:-$HOME/.ssh/id_ed25519_rig_agent}"
source "$ROOT/lab/scripts/cloud_common.sh"
export RIG_LOCK_HOLDER="${RIG_LOCK_HOLDER:-L2-v4}"
source "$ROOT/lab/scripts/rig_lock.sh"

OUT="${OUT:-$ROOT/.local/l2/e0-v4}"
mkdir -p "$OUT"
PROFILE="${PROFILE:-60}"
LIMIT="${NETEM_LIMIT:-1000}"
RATE_EXPECT="${RATE_EXPECT:-10Mbit}"
ONE_WAY=$((PROFILE / 2))

cleanup() { cloud_set_netem off 0 2>/dev/null || true; rig_lock_release || true; }
trap cleanup EXIT

echo "=== L2 e0 v4 profile $(date -Iseconds) ==="
rig_lock_acquire
cloud_sync_netem_script

check_one() {
  local loss=$1
  cloud_set_netem "$PROFILE" "$loss" "$LIMIT"
  local show
  show=$("${SSH[@]}" "sudo -n tc qdisc show")
  printf '%s\n' "$show" > "$OUT/tc_rtt${PROFILE}_loss${loss}.txt"
  echo "$show"
  python3 - "$show" "$ONE_WAY" "$loss" "$LIMIT" "$RATE_EXPECT" <<'PY'
import sys, re
show, delay, loss, limit, rate = sys.argv[1:6]
# tc prints e.g. "qdisc netem ... limit 1000 delay 30ms  loss 0.5% rate 10Mbit"
netem = [ln for ln in show.splitlines() if "netem" in ln]
if not netem:
    print("FAIL: no netem qdisc"); sys.exit(1)
line = netem[0]
ok = True
def need(pred, msg):
    global ok
    if not pred:
        print("FAIL:", msg, "in:", line); ok = False
need(re.search(rf"\blimit {re.escape(limit)}\b", line), f"limit {limit}")
need(re.search(rf"\bdelay {re.escape(delay)}ms\b", line), f"delay {delay}ms")
need(re.search(rf"\brate {re.escape(rate)}\b", line, re.I), f"rate {rate}")
if loss in ("0", "0.0"):
    need("loss" not in line, "no loss when loss=0")
else:
    # tc may print 0.5% as 0.5% or 500000000/1000000000
    need(("loss" in line) and (loss in line or "0.5" in line), f"loss {loss}%")
if not ok:
    sys.exit(1)
print("PASS", line)
PY
}

check_one 0
check_one 0.5
cloud_set_netem off 0
rig_lock_release
trap - EXIT
echo "=== e0 v4 profile PASS: rtt=$PROFILE one-way=${ONE_WAY}ms rate=$RATE_EXPECT limit=$LIMIT loss 0 and 0.5 ==="
echo "tc dumps: $OUT"
