#!/usr/bin/env bash
# WP1: lever 2 against every other client this box can run, each through the relay at RTT ms,
# directly and through half_rtt_deaf.py (a client that ignores 0.5-RTT data), against two server
# builds, everything rotated inside each round. lab/other-clients/README.md
#
#   lab/other-clients/cells.sh ON_BIN OFF_BIN [rounds]   [RTT=40] [VENV=dir with aioquic] [GO_CLIENT=bin] [H3_GET=bin]
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
declare -A BIN=([on]="$1" [off]="$2")
ROUNDS="${3:-5}"
RTT="${RTT:-40}"
T="$(mktemp -d)"
PIDS=()
cleanup() { for p in "${PIDS[@]:-}"; do kill "$p" 2>/dev/null || true; done; rm -rf "$T"; }
trap cleanup EXIT
trap "exit 143" TERM INT

cargo build -q --release -p window-harness --bin cold_open
declare -A PORT
for arm in on off; do
  srv=$((30000 + RANDOM % 5000)); in=$((35000 + RANDOM % 5000)); deaf=$((45000 + RANDOM % 5000))
  "${BIN[$arm]}" --port "$srv" --bind 127.0.0.1 --study lab/fixtures/frames_250k/frames_250k.sbnd \
    --cert-pem server/dev-cert/cert.pem --key-pem server/dev-cert/key.pem > "$T/server-$arm.log" 2>&1 &
  PIDS+=("$!")
  python3 lab/scripts/link_impair.py --udp "$in:$srv" --control-port $((40000 + RANDOM % 5000)) \
    --delay-ms $((RTT / 2)) > "$T/relay-$arm.log" 2>&1 &
  PIDS+=("$!")
  python3 lab/scripts/half_rtt_deaf.py "$deaf" "$in" > "$T/deaf-$arm.log" &
  PIDS+=("$!")
  PORT[$arm/direct]=$in; PORT[$arm/deaf]=$deaf
done
sleep 1

# Each prints one JSON object of ms from its dial.
client() {
  local url="https://127.0.0.1:$2/"
  case "$1" in
    native) target/release/cold_open --url "$url" --rounds 1 |
              sed -E 's/.* session=([0-9.]+)ms .* first_byte=([0-9.]+)ms .*/{"ready": \1, "first_byte": \2}/' ;;
    aioquic) "${VENV:?aioquic venv}/bin/python" lab/other-clients/aioquic_wt.py "$url" ;;
    webtransport-go) "${GO_CLIENT:?go client}" wt "$url" ;;
    quic-go-http3) "$GO_CLIENT" get "$url" ;;
    h3-quinn) "${H3_GET:?h3-get}" "$url" ;;
  esac
}
CLIENTS=(native aioquic webtransport-go quic-go-http3 h3-quinn)
CELLS=()
for c in "${CLIENTS[@]}"; do for arm in on off; do for path in direct deaf; do CELLS+=("$c $arm $path"); done; done; done
for round in $(seq "$ROUNDS"); do
  n=${#CELLS[@]}
  for k in $(seq 0 $((n - 1))); do
    read -r c arm path <<< "${CELLS[$(((k + round * 7) % n))]}"
    out=$(timeout 20 bash -c "$(declare -f client); $(declare -p VENV GO_CLIENT H3_GET 2>/dev/null); client $c ${PORT[$arm/$path]}" 2>&1 | tail -1) || true
    echo "$c $arm $path $out" >> "$T/rows"
    sleep 0.3
  done
done

python3 - "$T/rows" "$RTT" <<'PY'
import collections, json, statistics, sys
rtt = float(sys.argv[2])
cells = collections.defaultdict(list)
for line in open(sys.argv[1]):
    c, arm, path, out = line.rstrip("\n").split(" ", 3)
    try:
        cells[(c, arm, path)].append(json.loads(out))
    except json.JSONDecodeError:
        cells[(c, arm, path)].append({"error": out})
print(f"median round trips at {rtt:.0f} ms (ms / RTT); `get` and `error` as the client reported them")
for (c, arm, path), rows in cells.items():
    keys = sorted({k for r in rows for k, v in r.items() if isinstance(v, (int, float))})
    nums = "  ".join(f"{k} {statistics.median(r[k] for r in rows if k in r) / rtt:.2f}" for k in keys)
    words = collections.Counter(str(r.get("get", r.get("error"))) for r in rows if "get" in r or "error" in r)
    print(f"{c:16} {arm:3} {path:6}  {nums}  n={len(rows)}" + (f"  {dict(words)}" if words else ""))
PY
