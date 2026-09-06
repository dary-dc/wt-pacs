#!/usr/bin/env bash
# Preflight for any agent (local Claude Code, Cursor, a laptop shell) that wants to run a
# campaign on the Oracle rig.
#
# Run this FIRST and stop if it fails. It exists because a cloud agent container cannot
# reach the rig at all — no raw TCP, no UDP — and the failure shows up as a timeout deep
# inside a campaign rather than as a clear "you cannot get there from here". Twenty
# seconds here saves an hour of confusing output.
#
# Usage:  lab/scripts/cloud_preflight.sh
# Exit:   0 = good to go, 1 = a check failed (the message says which and what to do)
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

CLOUD_HOST="${CLOUD_HOST:-168.138.130.163}"
CLOUD_USER="${CLOUD_USER:-ubuntu}"
CLOUD_PORT="${CLOUD_PORT:-4435}"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/id_ed25519_rig_agent}"

fail=0
ok()   { printf '  \033[32mok\033[0m    %s\n' "$1"; }
bad()  { printf '  \033[31mFAIL\033[0m  %s\n' "$1"; fail=1; }
note() { printf '        %s\n' "$1"; }

echo "Oracle rig preflight — $CLOUD_USER@$CLOUD_HOST"
echo

# ---- 1 · tools -------------------------------------------------------------------------
for t in ssh scp ssh-keygen; do
  command -v "$t" >/dev/null 2>&1 && ok "$t present" || {
    bad "$t missing"; note "install openssh-client"; }
done

# ---- 2 · key ---------------------------------------------------------------------------
if [[ -f "$SSH_KEY" ]]; then
  perms=$(stat -c '%a' "$SSH_KEY" 2>/dev/null || stat -f '%Lp' "$SSH_KEY" 2>/dev/null)
  if [[ "$perms" == "600" || "$perms" == "400" ]]; then
    ok "key $SSH_KEY (mode $perms)"
  else
    bad "key $SSH_KEY has mode $perms"; note "chmod 600 '$SSH_KEY'"
  fi
  fp=$(ssh-keygen -lf "$SSH_KEY" 2>/dev/null | awk '{print $2}')
  note "fingerprint $fp"
  note "cross-check it against docs/cloud-rig-access.md before trusting this rig"
else
  bad "no key at $SSH_KEY"
  note "set SSH_KEY=/path/to/key, or install the rig key there with mode 600"
  note "NEVER put the key inside the repository"
fi

# ---- 3 · the check a cloud agent container fails ---------------------------------------
# Plain TCP to port 22. In an agent sandbox behind an HTTPS CONNECT proxy this times out,
# and no amount of campaign scripting will fix it.
if timeout 12 bash -c "</dev/tcp/$CLOUD_HOST/22" 2>/dev/null; then
  ok "TCP $CLOUD_HOST:22 reachable"
else
  bad "TCP $CLOUD_HOST:22 unreachable"
  note "You are probably inside an agent sandbox whose egress goes through an HTTPS"
  note "CONNECT proxy. That proxy carries neither raw TCP nor UDP, so SSH cannot work"
  note "and — decisively — QUIC cannot either, because QUIC is UDP."
  note "Run this from a machine with ordinary outbound internet instead."
fi

# ---- 4 · UDP, which is what the measurement actually needs ------------------------------
# QUIC is UDP. An SSH tunnel would not help: CONNECT tunnels TCP only.
if command -v nc >/dev/null 2>&1; then
  # `nc -u -z` reports success whenever no ICMP unreachable came back, which is also what
  # a silently blackholed datagram looks like. It is therefore NOT evidence that UDP works
  # and must never be printed as `ok` — a false green here is exactly the misleading signal
  # this script exists to prevent.
  timeout 8 nc -u -z -w 5 "$CLOUD_HOST" "$CLOUD_PORT" >/dev/null 2>&1
  note "UDP probe is INCONCLUSIVE by construction (connectionless: silence looks like success)."
  note "The authoritative UDP test is a real QUIC handshake - runbook step 3."
else
  note "nc absent — skipping the UDP probe; step 6 is the authoritative test"
fi

# ---- 5 · ssh login ---------------------------------------------------------------------
if [[ $fail -eq 0 ]]; then
  if timeout 25 ssh -i "$SSH_KEY" -o BatchMode=yes -o IdentitiesOnly=yes \
       -o StrictHostKeyChecking=accept-new -o ConnectTimeout=15 \
       "$CLOUD_USER@$CLOUD_HOST" 'echo ok' >/dev/null 2>&1; then
    ok "ssh login succeeds"
    note "$(timeout 25 ssh -i "$SSH_KEY" -o BatchMode=yes -o IdentitiesOnly=yes \
             "$CLOUD_USER@$CLOUD_HOST" 'echo "$(uname -r), $(nproc) cpu, $(free -m | awk "NR==2{print \$2}") MB"' 2>/dev/null)"
    if timeout 25 ssh -i "$SSH_KEY" -o BatchMode=yes -o IdentitiesOnly=yes \
         "$CLOUD_USER@$CLOUD_HOST" 'sudo modprobe sch_netem 2>/dev/null && lsmod | grep -q sch_netem' 2>/dev/null; then
      ok "sch_netem loads on the rig (real kernel shaping available)"
    else
      bad "sch_netem does not load"
      note "The rig exists precisely because netem works there and not in a container."
      note "Without it you are back to lab/netsim, which cannot answer CPU or throughput."
    fi
  else
    bad "ssh login failed"
    note "Key not authorised, or the host is down. Check docs/cloud-rig-access.md."
  fi
fi

# ---- 6 · local build -------------------------------------------------------------------
if [[ -x "$ROOT/target/release/window-harness" ]]; then
  ok "window-harness built"
else
  note "window-harness not built — run: cargo build --release -p window-harness"
fi

echo
if [[ $fail -eq 0 ]]; then
  echo "PREFLIGHT PASSED — continue with docs/measurements/r6/oracle-runbook.md"
  exit 0
fi
echo "PREFLIGHT FAILED — do not start a campaign; fix the FAIL lines above."
echo "If TCP:22 is unreachable you are in the wrong environment, not misconfigured."
exit 1
