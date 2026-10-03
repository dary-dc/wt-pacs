#!/usr/bin/env bash
# FQC: our steady asks, then our fill, against a kernel-TCP Cubic neighbour through the packet-layer
# relay, behind a FIFO or fq_codel of the same depth, under Cubic, BBR and the bounded BBR.
# Per run: the neighbour starts; 3 s on, ASKS 64 KB asks one at a time on a fresh session; then a
# DWELL_MS saturating fill beside it. Results: docs/transport/transport-conclusions.md §1 (FQC).
#
#   lab/scripts/fq_neighbour_cells.sh OUT.tsv [ROUNDS]   PROFILES= CCS= ASKS= DWELL_MS= FIRST= TRACES= KEEP=
#   (re-runs itself inside `unshare -rn`)
set -euo pipefail
if [[ -z ${FQC_INSIDE:-} ]]; then
  exec unshare -rn env FQC_INSIDE=1 "$0" "$@"
fi
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
ip link set lo up

OUT=$(realpath "$1")
ROUNDS="${2:-7}"
FIRST="${FIRST:-0}"
DWELL_MS="${DWELL_MS:-30000}"
ASKS="${ASKS:-20}"
read -ra PROFILES <<<"${PROFILES:-shallow deep lte-loaded}"
read -ra CCS <<<"${CCS:-cubic bbr}"
TRACES="${TRACES:-$HOME/.cache/wtpacs-traces}"
T="$(mktemp -d)"
PIDS=()
cleanup() { for p in "${PIDS[@]:-}"; do kill "$p" 2>/dev/null || true; done; rm -rf "$T"; }
trap cleanup EXIT

[ -s "$TRACES/Verizon-LTE-short.down" ] || { mkdir -p "$TRACES"; curl -sSfL -o "$TRACES/Verizon-LTE-short.down" \
  https://raw.githubusercontent.com/ravinet/mahimahi/master/traces/Verizon-LTE-short.down; }

# name -> one-way delay ms | relay args: row 99's shallow and deep 5 Mbit, row 86's LTE-loaded.
profile() {
  case "$1" in
    shallow)    echo "28|--rate-kbit 5000 --queue-pkts 20" ;;
    deep)       echo "28|--rate-kbit 5000 --queue-pkts 500" ;;
    lte-loaded) echo "30|--trace $TRACES/Verizon-LTE-short.down --loss-model ge --ge-p 0.02860 --ge-r 28.5714 --queue-ms 1000" ;;
    *) echo "unknown profile $1" >&2; exit 1 ;;
  esac
}

nice -n 19 cargo build -q -j 4 -p exact-server -p pack-study -p window-harness
BIN="${CARGO_TARGET_DIR:-target}/debug"
openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -keyout "$T/key.pem" \
  -out "$T/cert.pem" -days 2 -nodes -subj '/CN=localhost' \
  -addext 'extendedKeyUsage=serverAuth' -addext 'subjectAltName=IP:10.77.0.2' 2>/dev/null
FRAMES=100
mkdir -p "$T/frames"
for i in $(seq 0 $((FRAMES - 1))); do head -c 65536 /dev/urandom > "$T/frames/$(printf '%03d' "$i").htj2k"; done
echo "{\"frameCount\": $FRAMES}" > "$T/metadata.json"
"$BIN/pack-study" --metadata "$T/metadata.json" --frames "$T/frames" --output "$T/study.sbnd" >/dev/null

cat > "$T/bulk.py" <<'PY'
"""send PORT: one connection's worth of zeros, as fast as Cubic lets it, until killed.
recv PORT: reads it and logs `monotonic bytes` every 100 ms."""
import socket, sys, time
mode, port = sys.argv[1], int(sys.argv[2])
if mode == "send":
    ls = socket.socket()
    ls.setsockopt(socket.IPPROTO_TCP, socket.TCP_CONGESTION, b"cubic")
    ls.bind(("10.77.0.2", port))
    ls.listen(1)
    c, _ = ls.accept()
    assert c.getsockopt(socket.IPPROTO_TCP, socket.TCP_CONGESTION, 16).rstrip(b"\0") == b"cubic"
    buf = bytes(65536)
    while True:
        c.sendall(buf)
s = socket.create_connection(("10.77.0.2", port))
got, mark = 0, time.monotonic()
while True:
    n = len(s.recv(1 << 20))
    if not n:
        break
    got += n
    if time.monotonic() - mark >= 0.1:
        mark = time.monotonic()
        print("%.3f %d" % (mark, got), flush=True)
PY

run() {  # round prev profile cc qdisc: one row of $OUT
  local r="$1" prev="$2" name="$3" cc="$4" qd="$5" delay args fq=() ns
  IFS='|' read -r delay args <<<"$(profile "$name")"
  [[ $qd == fq ]] && fq=(--fq-codel)
  local srv=$((30000 + RANDOM % 20000)) nport=$((30000 + RANDOM % 20000))
  # shellcheck disable=SC2086
  nice -n 10 python3 lab/scripts/link_impair.py --tun --delay-ms "$delay" --rate-up-kbit 0 $args \
    "${fq[@]}" --seed "$r" --self-timing > "$T/relay.log" 2>&1 &
  local relay=$!
  for _ in $(seq 50); do grep -q READY "$T/relay.log" && break; sleep 0.1; done
  ns=(nsenter "--net=$(grep -o 'server_netns=[^ ]*' "$T/relay.log" | cut -d= -f2)")
  RUST_LOG=exact_server=info "${ns[@]}" "$BIN/exact-server" --port "$srv" --bind 10.77.0.2 \
    --study "$T/study.sbnd" --cert-pem "$T/cert.pem" --key-pem "$T/key.pem" --congestion "$cc" \
    > "$T/server.log" 2>&1 & PIDS+=("$!")
  "${ns[@]}" python3 "$T/bulk.py" send "$nport" & PIDS+=("$!")
  for _ in $(seq 100); do grep -q "wt_url=" "$T/server.log" && break; sleep 0.1; done
  sleep 0.3
  python3 "$T/bulk.py" recv "$nport" > "$T/neighbour.log" 2>/dev/null & local recv=$!
  sleep 3
  local asks
  asks=$(timeout 120 "$BIN/first_ask" --url "https://10.77.0.2:$srv/" --state fresh --target 0 \
    --asks "$ASKS" --rounds 1 --timeout-ms 60000 2>/dev/null | grep -o 'p50=[0-9.]* p99=[0-9.]*' || true)
  local t1
  timeout 150 nice -n 10 "$BIN/window-harness" --url "https://10.77.0.2:$srv/" --bind 0.0.0.0 \
    --mode saturate --fill-dwell-ms "$DWELL_MS" --frame-count "$FRAMES" --depth 8 --read-bps 0 \
    --stream-mode shared --timeout-ms 120000 --json > "$T/fill.json" 2>/dev/null || true
  t1=$(python3 -c 'import time; print(time.monotonic())')
  kill "$recv" 2>/dev/null || true
  kill -TERM "$relay"; wait "$relay" 2>/dev/null || true
  kill "${PIDS[@]}" 2>/dev/null || true
  PIDS=()
  sleep 0.5
  python3 - "$T" "$r" "$prev" "$name" "$cc" "$qd" "${asks:-p50=- p99=-}" "$t1" "$srv" "$nport" "$DWELL_MS" >> "$OUT" <<'PY'
import json, re, sys
t, r, prev, name, cc, qd, asks, t1, srv, nport, dwell = sys.argv[1:]
try:
    m = json.load(open(t + "/fill.json")); ours = m["fill_bytes"] * 8 / m["fill_dwell_ms"] / 1000
except Exception:
    ours = 0.0
# The neighbour over the fill's own dwell: its last DWELL_MS before the fill ended.
log = [tuple(map(float, l.split())) for l in open(t + "/neighbour.log") if l.strip()]
end = float(t1)
span = [x for x in log if end - float(dwell) / 1000 <= x[0] <= end]
nb = (span[-1][1] - span[0][1]) * 8 / (span[-1][0] - span[0][0]) / 1e6 if len(span) > 1 else 0.0
relay = open(t + "/relay.log").read()
flows = re.findall(r"flow client (\w+) 10\.77\.0\.2:(\d+) \S+ packets (\d+) bytes \d+ sojourn p50 ([\d.]+) p99 ([\d.]+)", relay)
ours_flows = [f for f in flows if f[0] == "udp" and f[1] == srv]
fill_q = ours_flows[-1][3] if len(ours_flows) > 1 else "-"
ask_q = ours_flows[0][3] if ours_flows else "-"
nb_q = next((f[3] for f in flows if f[0] == "tcp" and f[1] == nport), "-")
down = re.search(r"server->client sent (\d+) lost (\d+) overflowed (\d+) codel (\d+)", relay)
p50, p99 = (v.split("=")[1] for v in asks.split())
print("\t".join(map(str, [r, prev, name, cc, qd, p50, p99, "%.3f" % ours, "%.3f" % nb, ask_q, fill_q, nb_q,
                          *(down.groups() if down else ("-",) * 4), int("VOID" in relay)])))
PY
  [[ -z ${KEEP:-} ]] || cp "$T/relay.log" "$KEEP.$r.$name.$cc.$qd.log"
  tail -1 "$OUT"
}

ARMS=()
for cc in "${CCS[@]}"; do for qd in fifo fq; do ARMS+=("$cc/$qd"); done; done

one_round() {  # round
  local name k prev arm
  for name in "${PROFILES[@]}"; do
    prev=-
    for k in $(python3 lab/scripts/order.py row "${#ARMS[@]}" "$1"); do
      arm="${ARMS[k]}"
      run "$1" "$prev" "$name" "${arm%/*}" "${arm#*/}"
      prev="$arm"
    done
  done
}

echo "dwell ${DWELL_MS} ms, ${ASKS} asks of 64 KB; raw: $OUT"
[ -s "$OUT" ] || printf 'round\tprev\tprofile\tcc\tqdisc\task_p50\task_p99\tmbps\tneighbour_mbps\task_queue_ms\tfill_queue_ms\tneighbour_queue_ms\tsent\tlost\toverflowed\tcodel\tvoid\n' > "$OUT"
for ((r = FIRST; r < ROUNDS; r++)); do one_round "$r"; done
python3 lab/scripts/fq_summary.py "$OUT"
