#!/usr/bin/env bash
# W3: what a blink costs, where in the transfer it lands, and whether restarting slow start
# after the silence is worth it. Arms interleaved within every round, in a Williams order
# (lab/scripts/order.py).
# Results: docs/transport/transport-conclusions.md §3, after a blink.
#
#   lab/scripts/blink_cells.sh [rounds]
#   lab/scripts/blink_cells.sh w5b [rounds]   W5b: the restarts sized, blinks held and dropped at 0.1–1 % GE loss
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

MODE=w3
[[ "${1:-}" == w5b ]] && { MODE=w5b; shift; }
ROUNDS="${1:-5}"
RTT="${RTT:-80}"
RATE="${RATE:-20000}"
ARMS=(cubic cubic-restart bbr)
[[ $MODE == w5b ]] && ARMS=(cubic cubic-restart)
FILL=40          # frames the fill takes
KB=64            # frame size
ASK_KB=250       # the one-ask cell's frame size
ASK_WARM=8
T="$(mktemp -d)"
PIDS=()
cleanup() { for p in "${PIDS[@]:-}"; do kill "$p" 2>/dev/null || true; done; rm -rf "$T"; }
trap cleanup EXIT

cargo build -q -p exact-server -p pack-study -p window-harness
BIN="${CARGO_TARGET_DIR:-target}/debug"
openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -keyout "$T/key.pem" \
  -out "$T/cert.pem" -days 2 -nodes -subj '/CN=localhost' \
  -addext 'basicConstraints=critical,CA:FALSE' -addext 'keyUsage=critical,digitalSignature' \
  -addext 'extendedKeyUsage=serverAuth' -addext 'subjectAltName=DNS:localhost,IP:127.0.0.1' 2>/dev/null

study() {  # frames kb out
  local n="$1" kb="$2" out="$3" d="$T/f$3"
  mkdir -p "$d"
  for i in $(seq 0 "$n"); do
    head -c $((kb * 1024)) /dev/urandom > "$d/$(printf '%03d' "$i").htj2k"
  done
  echo "{\"frameCount\": $((n + 1))}" > "$T/m$3.json"
  "$BIN/pack-study" --metadata "$T/m$3.json" --frames "$d" --output "$T/$out.sbnd" >/dev/null
}
study "$FILL" "$KB" fill
study "$ASK_WARM" "$ASK_KB" ask

SRV=$((36000 + RANDOM % 2000))
IN=$((34000 + RANDOM % 2000))
CTRL=$((38000 + RANDOM % 2000))

start_server() {  # study extra args...
  local study="$1"; shift
  : > "$T/server.log"
  RUST_LOG=exact_server=info "$BIN/exact-server" --port "$SRV" --study "$T/$study.sbnd" \
    --cert-pem "$T/cert.pem" --key-pem "$T/key.pem" "$@" > "$T/server.log" 2>&1 &
  SERVER_PID=$!
  PIDS+=("$SERVER_PID")
  for _ in $(seq 100); do grep -q "wt_url=" "$T/server.log" && return; sleep 0.1; done
  echo "server did not start:"; cat "$T/server.log"; exit 1
}
start_relay() {
  python3 lab/scripts/link_impair.py --udp "$IN:$SRV" --delay-ms "$((RTT / 2))" \
    --control-port "$CTRL" "${RELAY_ARGS[@]}" > "$T/relay.log" 2>&1 &
  RELAY_PID=$!
  PIDS+=("$RELAY_PID")
  for _ in $(seq 50); do grep -q READY "$T/relay.log" && return; sleep 0.1; done
  echo "relay did not start"; exit 1
}

# Datagrams sent and lost for the one session this round served, from the server's path line.
link_cost() {
  python3 - "$T/server.log" <<'PY'
import re, sys
text = re.sub(r"\x1b\[[0-9;]*m", "", open(sys.argv[1], errors="replace").read())
rows = re.findall(r"session path .*?\bsent=(\d+) lost=(\d+) congestion_events=(\d+)", text)
print("%s %s %s" % rows[-1] if rows else "- - -")
PY
}

# One round of one arm. Appends "<metric ms> <sent> <lost> <cong> <round> <predecessor> <next ask ms>"
# to the arm's file; a run the relay timed late (`VOID`) is dropped.
one() {  # cell arm study warm target [harness args...]
  local cell="$1" arm="$2" study="$3" warm="$4" target="$5"
  shift 5
  start_server "$study" --congestion "$arm"
  start_relay
  local line
  line=$(RUST_BACKTRACE=0 "$BIN/first_ask" --url "https://127.0.0.1:$IN/" --warm "$warm" \
    --target "$target" --control-port "$CTRL" --rounds 1 --timeout-ms 60000 "$@" 2>&1) || {
      echo "FAILED $cell $arm: $(head -2 <<<"$line" | tr '\n' ' ')" >&2
      kill "$RELAY_PID" "$SERVER_PID" 2>/dev/null || true; sleep 0.3; return; }
  # The close is still in the relay's delay queue and the server writes its `session path` line
  # when it arrives, so wait for it with the relay still up. A client that exited before
  # flushing the close never sends one, and that round keeps its time and loses its counters.
  for _ in $(seq 30); do grep -q "session path" "$T/server.log" && break; sleep 0.1; done
  kill -TERM "$RELAY_PID" 2>/dev/null || true; sleep 0.3
  local v next
  v=$(sed -n "s/.*${METRIC} median=\([0-9.]*\).*/\1/p" <<<"$line")
  next=$(sed -n "s/.*ask_to_last_byte_ms median=\([0-9.]*\).*/\1/p" <<<"$line")
  if grep -q VOID "$T/relay.log"; then
    echo "VOID $cell $arm round $ROUND" >&2
  else
    echo "$v $(link_cost) $ROUND $PREV $next" >> "$T/$cell.$arm"
  fi
  kill "$SERVER_PID" 2>/dev/null || true; sleep 0.3
}

report() {  # cell
  python3 - "$T" "$1" "${ARMS[@]}" <<'PY'
import sys
sys.path.insert(0, "lab/scripts")
from order import leads_by_predecessor
t, cell, arms = sys.argv[1], sys.argv[2], sys.argv[3:]
def rows(arm):
    try:
        return [l.split() for l in open(f"{t}/{cell}.{arm}") if l.strip()]
    except FileNotFoundError:
        return []
base = {int(r[4]): float(r[0]) for r in rows(arms[0])}
base_next = {int(r[4]): float(r[6]) for r in rows(arms[0])}
def med(v):
    v = sorted(v)
    return float("nan") if not v else v[len(v) // 2] if len(v) % 2 else (v[len(v) // 2 - 1] + v[len(v) // 2]) / 2
for arm in arms:
    r = rows(arm)
    if not r:
        print("%-19s %s" % (arm, "no rounds")); continue
    mine = [float(x[0]) for x in r]
    ms = sorted(mine)
    paired = [float(x[0]) - base[int(x[4])] for x in r if int(x[4]) in base]
    wins = sum(1 for d in paired if d < 0)
    nexts = [float(x[6]) - base_next[int(x[4])] for x in r if int(x[4]) in base_next]
    counted = [x for x in r if x[1] != "-"]
    mean = lambda i: sum(int(x[i]) for x in counted) / len(counted)
    print("%-19s %9.1f %9.1f %9.1f %9s %8s %9.0f %7.1f %6.1f %6s %9.1f %9s" % (
        arm, med(mine), ms[0], ms[-1], "%+.1f" % med(paired) if arm != arms[0] else "",
        f"{wins}/{len(paired)}", mean(1), mean(2), mean(3), f"{len(counted)}/{len(r)}",
        med([float(x[6]) for x in r]), "%+.1f" % med(nexts) if arm != arms[0] else ""))
split = [{"round": int(x[4]), "unit": arm, "prev": None if x[5] == "first" else x[5], "v": float(x[0])}
         for arm in arms for x in rows(arm)]
for line in leads_by_predecessor(split, arms, [(a, arms[0]) for a in arms[1:]], 1):
    print(line)
PY
}

head_row() {
  printf '\n== %s\n%-19s %9s %9s %9s %9s %8s %9s %7s %6s %6s %9s %9s\n' "$1" \
    "arm" "median" "min" "max" "paired" "wins" "sent" "lost" "cong" "rows" "next ask" "paired"
}

cell() {  # label study warm target [harness args...]
  local label="$1"; shift
  local study="$1" warm="$2" target="$3"; shift 3
  local key="${label// /_}"
  rm -f "$T/$key".*
  for ROUND in $(seq 0 $((ROUNDS - 1))); do
    PREV=first
    for k in $(python3 lab/scripts/order.py row "${#ARMS[@]}" "$ROUND"); do
      one "$key" "${ARMS[$k]}" "$study" "$warm" "$target" "$@"
      PREV="${ARMS[$k]}"
    done
  done
  head_row "$label"
  report "$key"
}

echo "link: ${RTT} ms round trip, ${RATE} kbit, fill $((FILL * KB)) KB, $ROUNDS rounds, arms in a Williams order"

# Gilbert–Elliott in percent: bursts of 3.5 packets on average, the mean loss asked (profile_cells.sh).
ge() { python3 -c "r = 100 / 3.5; m = $1 / 100; print('--loss-model ge --ge-p %.5f --ge-r %.4f' % (m * r / (1 - m), r))"; }
if [[ $MODE == w5b ]]; then
  METRIC=fill_ms
  for loss in 0.1 0.3 1; do
    read -ra GE <<<"$(ge "$loss")"
    RELAY_ARGS=(--rate-kbit "$RATE" --queue-pkts 1500 --self-timing "${GE[@]}")
    cell "no blink, ${loss} % GE loss" fill "$FILL" "$FILL" --state filled
    for how in hold drop; do
      RELAY_ARGS=(--rate-kbit "$RATE" --queue-pkts 1500 --blackout-mode "$how" --self-timing "${GE[@]}")
      for ms in 500 2000; do
        cell "blink ${ms} ms, ${how}, at the fill's start, ${loss} % GE loss" fill "$FILL" "$FILL" \
          --state lossy --blackout-ms "$ms" --blackout-after 0
      done
    done
  done
  exit 0
fi

RELAY_ARGS=(--rate-kbit "$RATE" --queue-pkts 1500)
METRIC=fill_ms
cell "no blackout" fill "$FILL" "$FILL" --state filled
for ms in 500 1000 2000; do
  cell "blink ${ms} ms at the fill's start" fill "$FILL" "$FILL" \
    --state lossy --blackout-ms "$ms" --blackout-after 0
done
cell "blink 1000 ms mid-fill" fill "$FILL" "$FILL" \
  --state lossy --blackout-ms 1000 --blackout-after 20
cell "blink 1000 ms near the fill's end" fill "$FILL" "$FILL" \
  --state lossy --blackout-ms 1000 --blackout-after 36

METRIC=ask_to_last_byte_ms
cell "one ${KB} KB ask, warmed, blinked" fill "$FILL" "$FILL" \
  --state lossy --blackout-ms 1000 --blackout-after "$FILL"
cell "one ${ASK_KB} KB ask, warmed, clean" ask "$ASK_WARM" "$ASK_WARM" --state filled
cell "one ${ASK_KB} KB ask, warmed, blinked" ask "$ASK_WARM" "$ASK_WARM" \
  --state lossy --blackout-ms 1000 --blackout-after "$ASK_WARM"

METRIC=fill_ms
for loss in 1 3; do
  RELAY_ARGS=(--rate-kbit "$RATE" --queue-pkts 1500 --loss "$loss")
  cell "no blackout, ${loss} % loss" fill "$FILL" "$FILL" --state filled
done
