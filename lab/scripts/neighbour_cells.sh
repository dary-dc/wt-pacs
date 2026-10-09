#!/usr/bin/env bash
# Two saturating fills through one relay bottleneck, each from its own server — the netem
# neighbour table in docs/transport/transport-conclusions.md §1, re-run through link_impair.py.
# The neighbour is quinn's Cubic, a proxy for a phone app's TCP: no HyStart, QUIC's own acks.
#
#   lab/scripts/neighbour_cells.sh [rounds]     RTT= RATE= DWELL_MS= QUEUES= VARIANTS= LAG_MS= OUT= FIRST=
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

ROUNDS="${1:-5}"
FIRST="${FIRST:-0}"           # resume: rounds FIRST..ROUNDS-1 appended to an existing OUT
RTT="${RTT:-56}"              # the netem rig's 25 ms egress delay over its 28–35 ms path
RATE="${RATE:-5000}"
DWELL_MS="${DWELL_MS:-30000}"
QUEUES="${QUEUES:-20 10 500}"
SOLO_MS=10000
read -ra VARIANTS <<<"${VARIANTS:-cubic bbr bbr:bbr}"  # A's controller[:the neighbour's, cubic]
LAG_MS="${LAG_MS:-0}"         # the neighbour starts this late, stops as early: the netem rig's way
OUT="${OUT:-$(mktemp -t neighbour_cells.XXXX.tsv)}"
LOCK="${LOCK:-/run/user/$(id -u)/wtpacs-rig.lock}"
T="$(mktemp -d)"
PIDS=()
cleanup() { for p in "${PIDS[@]:-}"; do kill "$p" 2>/dev/null || true; done; rm -rf "$T"; }
trap cleanup EXIT

nice -n 19 cargo build -q -j 4 -p series-server -p pack-series -p window-harness
BIN="${CARGO_TARGET_DIR:-target}/debug"
openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -keyout "$T/key.pem" \
  -out "$T/cert.pem" -days 2 -nodes -subj '/CN=localhost' \
  -addext 'basicConstraints=critical,CA:FALSE' -addext 'keyUsage=critical,digitalSignature' \
  -addext 'extendedKeyUsage=serverAuth' -addext 'subjectAltName=DNS:localhost,IP:127.0.0.1' 2>/dev/null
FRAMES=100
mkdir -p "$T/frames"
for i in $(seq 0 $((FRAMES - 1))); do head -c 65536 /dev/urandom > "$T/frames/$(printf '%03d' "$i").htj2k"; done
echo "{\"frameCount\": $FRAMES}" > "$T/metadata.json"
"$BIN/pack-series" --metadata "$T/metadata.json" --frames "$T/frames" --output "$T/series.sbnd" >/dev/null

BASE=$((34000 + RANDOM % 4000))
SRV=("$BASE" $((BASE + 1)))
IN=($((BASE + 2)) $((BASE + 3)))

start_server() {  # index congestion
  RUST_LOG=series_server=info "$BIN/series-server" --port "${SRV[$1]}" --series "$T/series.sbnd" \
    --cert-pem "$T/cert.pem" --key-pem "$T/key.pem" --congestion "$2" > "$T/server$1.log" 2>&1 9>&- &
  PIDS+=("$!")
  for _ in $(seq 100); do grep -q "wt_url=" "$T/server$1.log" && return; sleep 0.1; done
  echo "server did not start:" >&2; cat "$T/server$1.log" >&2; exit 1
}

fill() {  # index dwell_ms
  timeout 120 nice -n 10 "$BIN/window-harness" --url "https://127.0.0.1:${IN[$1]}/" \
    --mode saturate --fill-dwell-ms "$2" --frame-count "$FRAMES" --depth 8 --read-bps 0 \
    --stream-mode shared --json > "$T/flow$1.json" 2>/dev/null 9>&- || true
}

mbps() { python3 -c "
import json, sys
try:
    m = json.load(open(sys.argv[1])); print('%.3f' % (m['fill_bytes'] * 8 / m['fill_dwell_ms'] / 1000))
except Exception:
    print('0')" "$1"; }

# Each batch holds the rig lock; no child keeps it past the batch.
locked() { flock 9; "$@"; } 9>"$LOCK"

run() {  # round prev queue dwell_ms congestion [neighbour's]: one row of $OUT
  local r="$1" prev="$2" q="$3" dwell="$4" cc="$5" nb="${6:-}" i relay_args=() flows=()
  local n=$((${#nb} ? 2 : 1))
  start_server 0 "$cc"
  [[ $n == 2 ]] && start_server 1 "$nb"
  for ((i = 0; i < n; i++)); do relay_args+=(--udp "${IN[$i]}:${SRV[$i]}"); done
  nice -n 10 python3 lab/scripts/link_impair.py "${relay_args[@]}" --delay-ms "$((RTT / 2))" \
    --rate-kbit "$RATE" --rate-up-kbit 0 --queue-pkts "$q" --self-timing > "$T/relay.log" 2>&1 9>&- &
  local relay=$!
  for _ in $(seq 50); do grep -q READY "$T/relay.log" && break; sleep 0.1; done
  rm -f "$T"/flow*.json
  fill 0 "$dwell" & flows+=("$!")
  [[ $n == 1 ]] || { sleep "$((LAG_MS))e-3"; fill 1 "$((dwell - 2 * LAG_MS))"; } & flows+=("$!")
  wait "${flows[@]}"
  kill -TERM "$relay"; wait "$relay" 2>/dev/null || true
  kill "${PIDS[@]}" 2>/dev/null || true
  PIDS=()
  sleep 0.5
  local a b=0 void
  a=$(mbps "$T/flow0.json")
  [[ $n == 2 ]] && b=$(mbps "$T/flow1.json")
  void=$(grep -c VOID "$T/relay.log" || true)
  printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$q" "$r" "$prev" "$cc:${nb:-alone}" "$a" "$b" "$void" >> "$OUT"
  printf 'round %s queue %-4s %-18s %6.2f | %6.2f Mbps%s\n' "$r" "$q" "$cc:${nb:-alone}" "$a" "$b" \
    "$([[ $void != 0 ]] && echo ' VOID')"
}

solo() {
  local q cc
  for q in $QUEUES; do for cc in cubic bbr; do run - - "$q" "$SOLO_MS" "$cc"; done; done
}

one_round() {  # round
  local q k variant prev
  for q in $QUEUES; do
    prev=-
    for k in $(python3 lab/scripts/order.py row "${#VARIANTS[@]}" "$1"); do
      variant="${VARIANTS[k]}"
      [[ $variant == *:* ]] || variant="$variant:cubic"
      run "$1" "$prev" "$q" "$DWELL_MS" "${variant%%:*}" "${variant##*:}"
      prev="$variant"
    done
  done
}

echo "link: ${RTT} ms round trip, ${RATE} kbit down, uplink unshaped, dwell ${DWELL_MS} ms; raw: $OUT"
[ -s "$OUT" ] || printf 'queue\tround\tprev\tvariant\ta_mbps\tb_mbps\tvoid\n' > "$OUT"
[[ $FIRST != 0 ]] || locked solo
for ((r = FIRST; r < ROUNDS; r++)); do locked one_round "$r"; done

python3 - "$OUT" <<'PY'
import collections, statistics, sys
rows = [l.rstrip("\n").split("\t") for l in open(sys.argv[1])][1:]
cells = collections.defaultdict(list)
for q, r, prev, variant, a, b, void in rows:
    if r == "-":
        print("queue %-4s %-18s alone %6s Mbps%s" % (q, variant, a, "" if void == "0" else " VOID"))
    elif void == "0":
        a, b = float(a), float(b)
        cells[(int(q), variant)].append((a, b, a / (a + b) if a + b else 0, (a + b) ** 2 / (2 * (a * a + b * b)) if a or b else 0))
print("\n%-6s %-18s %3s %8s %8s %8s %14s %6s" % ("queue", "A:neighbour", "n", "A Mbps", "B Mbps", "A share", "share min-max", "Jain"))
for (q, variant), v in sorted(cells.items()):
    med = lambda i: statistics.median(x[i] for x in v)
    print("%-6d %-18s %3d %8.2f %8.2f %7.1f%% %6.1f-%5.1f%% %6.3f" % (q, variant, len(v), med(0), med(1), 100 * med(2),
          100 * min(x[2] for x in v), 100 * max(x[2] for x in v), med(3)))
print("void runs dropped: %d" % sum(1 for x in rows if x[6] != "0"))
PY
