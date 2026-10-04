#!/usr/bin/env bash
# W4b: a fill many times a deep buffer, at a flat rate and on traces of the same mean, per
# controller — how long the fill takes and how much queue stands behind it.
# Results: docs/transport/transport-conclusions.md §3 The slow-start exit.
#
#   lab/scripts/deep_queue_cells.sh [rounds]     RTT= LINKS= QUEUES= ARMS= OUT= FIRST=
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

ROUNDS="${1:-7}"
FIRST="${FIRST:-0}"
RTT="${RTT:-80}"
read -ra LINKS <<<"${LINKS:-flat step step40 burst}"
read -ra QUEUES <<<"${QUEUES:-500 1000}"     # ms at the link's mean rate
# controller[:client] — the client is first_ask with this stream credit in bytes (quinn's 1.25 MB
# when absent), or `browser`: headless Chromium's downloader, lab/session-survival.
read -ra ARMS <<<"${ARMS:-cubic cubic:16000000 bbr:16000000 cubic:browser}"
FRAMES=237
FRAME_BYTES=265000
OUT="${OUT:-$(mktemp -t deep_queue_cells.XXXX.tsv)}"
T="$(mktemp -d)"
PIDS=()
CFG=client/dev-transport.json
[[ -f $CFG ]] && cp "$CFG" "$T/cfg.bak"
cleanup() {
  for p in "${PIDS[@]:-}" "${HTTP_PID:-}"; do kill "$p" 2>/dev/null || true; done
  if [[ -f $T/cfg.bak ]]; then cp "$T/cfg.bak" "$CFG"; else rm -f "$CFG"; fi
  rm -rf "$T"
}
trap cleanup EXIT
trap "exit 143" TERM INT

# Release: a debug server and client at 40 Mbit leave the relay late (VOID) half the time.
nice -n 19 cargo build -q --release -p exact-server --features exact-server/telemetry -p pack-study -p window-harness
BIN="${CARGO_TARGET_DIR:-target}/release"
bash client/transport-ts/build.sh > /dev/null
openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -keyout "$T/key.pem" \
  -out "$T/cert.pem" -days 2 -nodes -subj '/CN=localhost' \
  -addext 'basicConstraints=critical,CA:FALSE' -addext 'keyUsage=critical,digitalSignature' \
  -addext 'extendedKeyUsage=serverAuth' -addext 'subjectAltName=DNS:localhost,IP:127.0.0.1' 2>/dev/null
mkdir -p "$T/frames"
for i in $(seq 0 $((FRAMES - 1))); do head -c "$FRAME_BYTES" /dev/urandom > "$T/frames/$(printf '%03d' "$i").htj2k"; done
echo "{\"frameCount\": $FRAMES}" > "$T/metadata.json"
"$BIN/pack-study" --metadata "$T/metadata.json" --frames "$T/frames" --output "$T/study.sbnd" >/dev/null

# Every link has a 22 Mbit mean. step: a home Wi-Fi link's steps; step40 the same loop entered a
# step later, so the fill crosses 40 → 10; burst: a 1 ms grant every 10 ms.
G=lab/scripts/gen_step_trace.py
python3 $G 15000:12000 40000:12000 10000:12000 30000:12000 15000:12000 > "$T/step.trace"
python3 $G 40000:12000 10000:12000 30000:12000 15000:12000 15000:12000 > "$T/step40.trace"
python3 $G 0:9 220000:1 > "$T/burst.trace"
link_args() {  # link
  case "$1" in
    flat) echo --rate-kbit 22000 ;;
    *) echo --rate-kbit 22000 --trace "$T/$1.trace" ;;
  esac
}

BASE=$((34000 + RANDOM % 4000))
SRV=$BASE IN=$((BASE + 1)) HTTP=$((BASE + 2))
HASH=$(openssl x509 -in "$T/cert.pem" -outform DER | openssl dgst -sha256 | awk '{print $2}')
echo "{\"wt_url\": \"https://127.0.0.1:$IN/\", \"cert_sha256\": \"$HASH\"}" > "$CFG"
python3 server/dev-server.py --port "$HTTP" > /dev/null 2>&1 &
HTTP_PID=$!

# srtt − min RTT over the session's path samples (100 ms apart): median and max, in ms.
standing() {
  python3 - "$T/path.jsonl" <<'PY'
import json, statistics, sys
try:
    q = [(r["rtt_us"] - r["min_rtt_us"]) / 1000 for r in map(json.loads, open(sys.argv[1]))]
except FileNotFoundError:
    q = []
print("%.0f %.0f" % (statistics.median(q), max(q)) if q else "- -")
PY
}

session_path() {  # lost congestion_events
  sed 's/\x1b\[[0-9;]*m//g' "$T/server.log" |
    sed -n 's/.*session path .*\blost=\([0-9]*\) congestion_events=\([0-9]*\).*/\1 \2/p' | tail -1
}

run() {  # round prev link queue arm: one row of $OUT
  local r="$1" prev="$2" link="$3" q="$4" arm="$5" fill sq50 sqmax lost cong void window=()
  [[ $arm == *:[0-9]* ]] && window=(--stream-recv-window "${arm##*:}")
  rm -f "$T/path.jsonl"
  WTPACS_PATH_TELEMETRY=1 WTPACS_PATH_TELEMETRY_MS=100 WTPACS_PATH_TELEMETRY_PATH="$T/path.jsonl" \
    RUST_LOG=exact_server=info "$BIN/exact-server" --port "$SRV" --bind 127.0.0.1 --study "$T/study.sbnd" \
    --cert-pem "$T/cert.pem" --key-pem "$T/key.pem" --congestion "${arm%%:*}" > "$T/server.log" 2>&1 &
  local server=$!
  for _ in $(seq 100); do grep -q "wt_url=" "$T/server.log" && break; sleep 0.1; done
  # shellcheck disable=SC2046
  python3 lab/scripts/link_impair.py --udp "$IN:$SRV" --delay-ms "$((RTT / 2))" --rate-up-kbit 0 \
    $(link_args "$link") --queue-ms "$q" --self-timing > "$T/relay.log" 2>&1 &
  local relay=$!
  PIDS=("$server" "$relay")
  for _ in $(seq 50); do grep -q READY "$T/relay.log" && break; sleep 0.1; done
  if [[ $arm == *:browser ]]; then
    NODE_PATH="${NODE_PATH:-$(npm root -g)}" node lab/session-survival/run.mjs --rounds 1 --arms built \
      --base "http://127.0.0.1:$HTTP" --no-cut --fill "$FRAMES" --timeout 120000 --out "$T/row.jsonl" \
      > /dev/null 2>&1 || true
    fill=$(python3 -c 'import json,sys; r=json.loads(open(sys.argv[1]).read().splitlines()[-1]); print(r["spanMs"] if r["done"] and not r["failures"] else "")' "$T/row.jsonl" 2>/dev/null || true)
    rm -f "$T/row.jsonl"
  else
    fill=$("$BIN/first_ask" --url "https://127.0.0.1:$IN/" --state filled --warm $((FRAMES - 1)) \
      --target $((FRAMES - 1)) --rounds 1 --timeout-ms 120000 "${window[@]}" 2>&1 |
      sed -n 's/.*fill_ms median=\([0-9.]*\).*/\1/p') || true
  fi
  for _ in $(seq 30); do grep -q "session path" "$T/server.log" && break; sleep 0.1; done
  kill -TERM "$relay"; wait "$relay" 2>/dev/null || true
  kill "$server" 2>/dev/null; wait "$server" 2>/dev/null || true
  PIDS=()
  read -r sq50 sqmax <<<"$(standing)"
  read -r lost cong <<<"$(session_path)"
  void=$(grep -c VOID "$T/relay.log" || true)
  p99=$(sed -n 's/^self-timing .* p99 \([0-9.]*\) .*/\1/p' "$T/relay.log")
  printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$link" "$q" "$r" "$prev" "$arm" "${fill:--}" \
    "$sq50" "$sqmax" "${lost:--}" "${cong:--}" "$void" "${p99:--}" >> "$OUT"
  printf 'round %s %-6s %4s ms %-22s fill %8s ms  standing p50 %s max %s ms  lost %s cong %s%s\n' \
    "$r" "$link" "$q" "$arm" "${fill:-FAILED}" "$sq50" "$sqmax" "${lost:--}" "${cong:--}" \
    "$([[ $void != 0 ]] && echo " VOID p99 $p99")"
  sleep 1
}

echo "link: ${RTT} ms round trip, 22 Mbit mean down, uplink unshaped; fill $FRAMES x $FRAME_BYTES B; raw: $OUT"
[ -s "$OUT" ] || printf 'link\tqueue_ms\tround\tprev\tarm\tfill_ms\tsq_p50_ms\tsq_max_ms\tlost\tcong\tvoid\trelay_p99_ms\n' > "$OUT"
for ((r = FIRST; r < ROUNDS; r++)); do
  for link in "${LINKS[@]}"; do
    for q in "${QUEUES[@]}"; do
      prev=-
      for k in $(python3 lab/scripts/order.py row "${#ARMS[@]}" "$r"); do
        run "$r" "$prev" "$link" "$q" "${ARMS[k]}"
        prev="${ARMS[k]}"
      done
    done
  done
done

python3 - "$OUT" "${ARMS[@]}" <<'PY'
import collections, statistics, sys
sys.path.insert(0, "lab/scripts")
from order import leads_by_predecessor
arms = sys.argv[2:]
head = open(sys.argv[1]).readline().rstrip("\n").split("\t")
rows = [dict(zip(head, l.rstrip("\n").split("\t"))) for l in open(sys.argv[1]).readlines()[1:]]
ok = [r for r in rows if r["void"] == "0" and r["fill_ms"] != "-"]
print("void runs dropped: %d, failed: %d" % (sum(r["void"] != "0" for r in rows), sum(r["fill_ms"] == "-" for r in rows)))
cells = collections.defaultdict(list)
for r in ok:
    cells[(r["link"], r["queue_ms"])].append(r)
f = lambda x: "%.0f" % x
for (link, q), rs in cells.items():
    print("\n== %s, %s ms queue" % (link, q))
    print("%-22s %3s %9s %15s %9s %9s %6s %5s %10s" % ("arm", "n", "fill ms", "fill min-max", "sq p50", "sq max", "lost", "cong", "vs " + arms[0]))
    at = {r["round"]: float(r["fill_ms"]) for r in rs if r["arm"] == arms[0]}
    for a in arms:
        v = [r for r in rs if r["arm"] == a]
        if not v:
            continue
        fill = [float(r["fill_ms"]) for r in v]
        med = lambda k: statistics.median(float(r[k]) for r in v if r[k] != "-") if any(r[k] != "-" for r in v) else float("nan")
        lead = [float(r["fill_ms"]) - at[r["round"]] for r in v if r["round"] in at]
        better = sum(d < 0 for d in lead)
        vs = "-" if a == arms[0] else "%+.0f %d/%d" % (statistics.median(lead), better, len(lead)) if lead else "-"
        print("%-22s %3d %9s %7s-%-7s %9s %9s %6.0f %5.0f %10s" % (a, len(v), f(statistics.median(fill)), f(min(fill)), f(max(fill)),
              f(med("sq_p50_ms")), f(med("sq_max_ms")), med("lost"), med("cong"), vs))
    split = [{"round": int(r["round"]), "unit": r["arm"], "prev": None if r["prev"] == "-" else r["prev"],
              "v": float(r["fill_ms"])} for r in rs]
    for line in leads_by_predecessor(split, arms, [(a, arms[0]) for a in arms[1:]]):
        print(line)
PY
