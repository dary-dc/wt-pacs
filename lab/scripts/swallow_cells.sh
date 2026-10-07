#!/usr/bin/env bash
# FF1: a cold native dial when the relay swallows exactly the server's first flight, against a
# clean dial, for two or more server binaries, in a Williams order inside every round
# (lab/scripts/order.py).
# Results: docs/ARCHITECTURE.md §What early SETTINGS cost.
#
#   SERVERS=a=BIN,b=BIN [RTTS="40 80"] [SWALLOW_MS=50] [TRACE=DIR] lab/scripts/swallow_cells.sh [rounds]
#
# Prints one row a dial — round rtt cell server session_ms first_byte_ms predecessor — then medians,
# the rounds each server beat the first in, and that lead by predecessor. TRACE=DIR keeps each server's quinn trace there.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

ROUNDS="${1:-7}"
read -r -a RTT_LIST <<< "${RTTS:-40 80}"
IFS=, read -r -a SERVER_LIST <<< "$SERVERS"
T="$(mktemp -d)"
PIDS=()
cleanup() { for p in "${PIDS[@]:-}"; do kill "$p" 2>/dev/null || true; done; rm -rf "$T"; }
trap cleanup EXIT
# `timeout` sends TERM, and without this the servers outlive the script — one spun for hours.
trap "exit 143" TERM INT

cargo build -q --release -p window-harness
cargo build -q -p pack-study
COLD="${CARGO_TARGET_DIR:-target}/release/cold_open"
openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -keyout "$T/key.pem" \
  -out "$T/cert.pem" -days 2 -nodes -subj '/CN=localhost' \
  -addext 'subjectAltName=DNS:localhost,IP:127.0.0.1' 2>/dev/null
mkdir -p "$T/frames"
head -c 1024 /dev/zero > "$T/frames/000.htj2k"
echo '{"frameCount": 1}' > "$T/m.json"
"${CARGO_TARGET_DIR:-target}/debug/pack-study" --metadata "$T/m.json" --frames "$T/frames" \
  --output "$T/study.sbnd" >/dev/null

port=$((30000 + RANDOM % 20000))
declare -A FRONT CTRL
for s in "${SERVER_LIST[@]}"; do
  name="${s%%=*}" bin="${s#*=}"
  srv=$((port++))
  log="${TRACE:-$T}/$name.log"
  RUST_LOG="${TRACE:+quinn_proto=trace,wtransport=trace,}exact_server=info" "$bin" --port "$srv" --bind 127.0.0.1 \
    --study "$T/study.sbnd" --cert-pem "$T/cert.pem" --key-pem "$T/key.pem" > "$log" 2>&1 &
  PIDS+=("$!")
  for rtt in "${RTT_LIST[@]}"; do
    FRONT[$name.$rtt]=$((port++)) CTRL[$name.$rtt]=$((port++))
    python3 lab/scripts/link_impair.py --udp "${FRONT[$name.$rtt]}:$srv" --delay-ms "$((rtt / 2))" \
      --control-port "${CTRL[$name.$rtt]}" > "$T/relay.$name.$rtt.log" 2>&1 &
    PIDS+=("$!")
  done
done
sleep 2

poke() { python3 -c "import socket,sys; socket.socket(socket.AF_INET, socket.SOCK_DGRAM).sendto(sys.argv[1].encode(), ('127.0.0.1', int(sys.argv[2])))" "$1" "$2"; }

n=${#SERVER_LIST[@]}
for round in $(seq "$ROUNDS"); do
  for rtt in "${RTT_LIST[@]}"; do
    for cell in clean swallow; do
      prev=first
      for k in $(python3 lab/scripts/order.py row "$n" "$round"); do
        s="${SERVER_LIST[$k]}"
        name="${s%%=*}"
        [[ $cell == swallow ]] && poke "swallow ${SWALLOW_MS:-50}" "${CTRL[$name.$rtt]}"
        out=$("$COLD" --url "https://127.0.0.1:${FRONT[$name.$rtt]}/" --rounds 1)
        echo "$round $rtt $cell $name $(sed -E 's/.*session=([0-9.]+)ms.*first_byte=([0-9.]+)ms.*/\1 \2/' <<< "$out") $prev"
        prev="$name"
        # Past the swallow window and the last session's close, so neither reaches the next dial.
        sleep 0.3
      done
    done
  done
done | tee "$T/rows"

python3 - "$T/rows" "${SERVER_LIST[@]%%=*}" <<'PY'
import collections, statistics, sys
sys.path.insert(0, "lab/scripts")
from order import leads_by_predecessor
rows = [l.split() for l in open(sys.argv[1])]
names = sys.argv[2:]
ref = names[0]
by = collections.defaultdict(dict)
for r, rtt, cell, name, sess, fb, prev in rows:
    by[(rtt, cell, name)][r] = (float(sess), float(fb))
print("\nsession ready ms: median [min-max], and rounds it beat %s in" % ref)
for (rtt, cell, name), v in sorted(by.items(), key=lambda kv: (int(kv[0][0]), kv[0][1], kv[0][2])):
    s = sorted(x[0] for x in v.values())
    won = sum(v[r][0] < by[(rtt, cell, ref)][r][0] for r in v)
    print("rtt %-3s %-7s %-10s %7.1f [%.1f-%.1f]  %d/%d" % (rtt, cell, name, statistics.median(s), s[0], s[-1], won, len(s)))
print("\nsession ready ms, each lead by the predecessor it ran after within its cell, rounds in brackets")
for rtt, cell in sorted({(r[1], r[2]) for r in rows}, key=lambda k: (int(k[0]), k[1])):
    split = [{"round": int(r[0]), "unit": r[3], "prev": None if r[6] == "first" else r[6], "v": float(r[4])}
             for r in rows if (r[1], r[2]) == (rtt, cell)]
    print("rtt %s %s" % (rtt, cell))
    for line in leads_by_predecessor(split, names, [(n, ref) for n in names[1:]], 1):
        print(line)
PY
