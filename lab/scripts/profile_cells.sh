#!/usr/bin/env bash
# PROF: link profiles close to a phone, through link_impair.py — a rate trace, a base round trip,
# Gilbert–Elliott loss in bursts, a FIFO sized in ms or CoDel, a neighbour, an outage — and the
# controllers on them. Per run: a 250 KB first ask on a fresh session, then a saturating fill
# with a 20 ms probe beside it whose extra round trip is the standing queue.
# LTE traces are mahimahi's, fetched into $TRACES and never committed; the Wi-Fi ones are steps.
# Results: docs/transport/transport-conclusions.md §1 (PROF).
#
#   lab/scripts/profile_cells.sh [rounds]     PROFILES= ARMS= DWELL_MS= OUT= FIRST= TRACES=
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

ROUNDS="${1:-5}"
FIRST="${FIRST:-0}"
DWELL_MS="${DWELL_MS:-30000}"
read -ra PROFILES <<<"${PROFILES:-control lte-good lte-good-codel lte-loaded lte-moving wifi-home wifi-home-codel wifi-busy}"
read -ra ARMS <<<"${ARMS:-cubic bbr}"
OUT="${OUT:-$(mktemp -t profile_cells.XXXX.tsv)}"
TRACES="${TRACES:-$HOME/.cache/wtpacs-traces}"
LOCK="${LOCK:-/run/user/$(id -u)/wtpacs-rig.lock}"
MAHIMAHI=https://raw.githubusercontent.com/ravinet/mahimahi/master/traces
T="$(mktemp -d)"
PIDS=()
cleanup() { for p in "${PIDS[@]:-}"; do kill "$p" 2>/dev/null || true; done; rm -rf "$T"; }
trap cleanup EXIT

mkdir -p "$TRACES" "$(dirname "$LOCK")"
for f in TMobile-LTE-short Verizon-LTE-short TMobile-LTE-driving; do
  [ -s "$TRACES/$f.down" ] || curl -sSfL -o "$TRACES/$f.down" "$MAHIMAHI/$f.down"
done
python3 lab/scripts/gen_step_trace.py 15000:12000 40000:12000 10000:12000 30000:12000 \
  15000:12000 > "$T/wifi-home.trace"
python3 lab/scripts/gen_step_trace.py 20000:3000 5000:3000 15000:3000 8000:2000 0:500 \
  20000:3000 5000:3000 12000:3000 6000:3000 18000:3000 > "$T/wifi-busy.trace"

# Gilbert–Elliott in percent: bursts of 3.5 packets on average (r), p for the mean loss asked.
ge() { python3 -c "r = 100 / 3.5; m = $1 / 100; print('--loss-model ge --ge-p %.5f --ge-r %.4f' % (m * r / (1 - m), r))"; }

# name -> one-way delay ms | relay args | neighbour (1/0) | outage hold ms at mid-fill
profile() {
  case "$1" in
    control)         echo "25|--rate-kbit 20000 --loss 1 --queue-ms 120|0|0" ;;
    lte-good)        echo "25|--trace $TRACES/TMobile-LTE-short.down $(ge 0.01) --queue-ms 500|0|0" ;;
    lte-good-codel)  echo "25|--trace $TRACES/TMobile-LTE-short.down $(ge 0.01) --queue-ms 500 --codel 5:100|0|0" ;;
    lte-loaded)      echo "30|--trace $TRACES/Verizon-LTE-short.down $(ge 0.1) --queue-ms 1000|1|0" ;;
    lte-moving)      echo "35|--trace $TRACES/TMobile-LTE-driving.down $(ge 0.3) --queue-ms 500 --blackout-mode hold|0|200" ;;
    wifi-home)       echo "15|--trace $T/wifi-home.trace $(ge 0.5) --queue-ms 300|0|0" ;;
    wifi-home-codel) echo "15|--trace $T/wifi-home.trace $(ge 0.5) --queue-ms 300 --codel 5:100|0|0" ;;
    wifi-busy)       echo "20|--trace $T/wifi-busy.trace $(ge 1) --queue-ms 300|1|0" ;;
    *) echo "unknown profile $1" >&2; exit 1 ;;
  esac
}

nice -n 19 cargo build -q -j 4 -p exact-server -p pack-study -p window-harness
BIN="${CARGO_TARGET_DIR:-target}/debug"
openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -keyout "$T/key.pem" \
  -out "$T/cert.pem" -days 2 -nodes -subj '/CN=localhost' \
  -addext 'basicConstraints=critical,CA:FALSE' -addext 'keyUsage=critical,digitalSignature' \
  -addext 'extendedKeyUsage=serverAuth' -addext 'subjectAltName=DNS:localhost,IP:127.0.0.1' 2>/dev/null
FRAMES=100
mkdir -p "$T/frames"
for i in $(seq 0 $((FRAMES - 1))); do head -c 256000 /dev/urandom > "$T/frames/$(printf '%03d' "$i").htj2k"; done
echo "{\"frameCount\": $FRAMES}" > "$T/metadata.json"
"$BIN/pack-study" --metadata "$T/metadata.json" --frames "$T/frames" --output "$T/study.sbnd" >/dev/null

cat > "$T/echo.py" <<'PY'
import socket, sys
s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
s.bind(("127.0.0.1", int(sys.argv[1])))
while True:
    d, a = s.recvfrom(65535)
    s.sendto(d, a)
PY
cat > "$T/probe.py" <<'PY'
"""One 100 B datagram every 20 ms for `seconds`; prints the median RTT in ms and the share lost."""
import socket, statistics, struct, sys, threading, time
port, seconds = int(sys.argv[1]), float(sys.argv[2])
s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
s.settimeout(3)
n = int(seconds / 0.02)
rtt = []


def send():
    for i in range(n):
        s.sendto(struct.pack("!d", time.monotonic()) + b"x" * 92, ("127.0.0.1", port))
        time.sleep(0.02)


sender = threading.Thread(target=send, daemon=True)
sender.start()
while True:
    try:
        d, _ = s.recvfrom(65535)
    except socket.timeout:
        if not sender.is_alive():
            break
        continue
    rtt.append((time.monotonic() - struct.unpack("!d", d[:8])[0]) * 1000)
print("%.1f %.3f" % (statistics.median(rtt) if rtt else -1, 1 - len(rtt) / n))
PY

BASE=$((30000 + RANDOM % 6000))
SRV=$BASE NSRV=$((BASE + 1)) ECHO=$((BASE + 2)) IN=$((BASE + 3)) NIN=$((BASE + 4)) PIN=$((BASE + 5))
CTRL=$((BASE + 6))

start_server() {  # port congestion log
  RUST_LOG=exact_server=info "$BIN/exact-server" --port "$1" --study "$T/study.sbnd" \
    --cert-pem "$T/cert.pem" --key-pem "$T/key.pem" --congestion "$2" > "$3" 2>&1 9>&- &
  PIDS+=("$!")
  for _ in $(seq 100); do grep -q "wt_url=" "$3" && return; sleep 0.1; done
  echo "server did not start:" >&2; cat "$3" >&2; exit 1
}

saturate() {  # port dwell_ms json
  timeout 150 nice -n 10 "$BIN/window-harness" --url "https://127.0.0.1:$1/" --mode saturate \
    --fill-dwell-ms "$2" --frame-count "$FRAMES" --depth 8 --read-bps 0 --stream-mode shared \
    --timeout-ms 120000 --json > "$3" 2>/dev/null 9>&- || true
}

run() {  # round prev profile arm: one row of $OUT
  local r="$1" prev="$2" name="$3" cc="$4" delay args nb hold flows=() udp
  IFS='|' read -r delay args nb hold <<<"$(profile "$name")"
  start_server "$SRV" "$cc" "$T/server.log"
  udp=(--udp "$IN:$SRV" --udp "$PIN:$ECHO")
  if [[ $nb == 1 ]]; then start_server "$NSRV" cubic "$T/nserver.log"; udp+=(--udp "$NIN:$NSRV"); fi
  python3 "$T/echo.py" "$ECHO" 9>&- & PIDS+=("$!")
  # shellcheck disable=SC2086
  nice -n 10 python3 lab/scripts/link_impair.py "${udp[@]}" --delay-ms "$delay" --rate-up-kbit 0 \
    $args --seed "$r" --control-port "$CTRL" --self-timing > "$T/relay.log" 2>&1 9>&- &
  local relay=$!
  for _ in $(seq 50); do grep -q READY "$T/relay.log" && break; sleep 0.1; done
  rm -f "$T"/flow*.json
  # The ask meets a neighbour already running; the fill and a fresh neighbour start together.
  local ask ahead=
  [[ $nb == 1 ]] && { saturate "$NIN" 8000 "$T/ahead.json" & ahead=$!; sleep 3; }
  ask=$(timeout 60 "$BIN/cold_open" --url "https://127.0.0.1:$IN/" --rounds 1 2>/dev/null \
    | grep -o 'ask_to_last_byte=[0-9.]*' | cut -d= -f2 || true)
  [[ -z $ahead ]] || wait "$ahead"
  [[ $nb == 1 ]] && { saturate "$NIN" "$DWELL_MS" "$T/flowN.json" & flows+=("$!"); }
  saturate "$IN" "$DWELL_MS" "$T/flow0.json" & flows+=("$!")
  sleep 3
  if [[ $hold != 0 ]]; then
    (sleep "$((DWELL_MS / 2000))"; python3 -c "
import socket; socket.socket(socket.AF_INET, socket.SOCK_DGRAM).sendto(b'blackout $hold', ('127.0.0.1', $CTRL))") &
  fi
  local probe
  probe=$(python3 "$T/probe.py" "$PIN" "$(( DWELL_MS / 1000 - 5 ))")
  wait "${flows[@]}"
  sleep 0.5
  kill -TERM "$relay"; wait "$relay" 2>/dev/null || true
  kill "${PIDS[@]}" 2>/dev/null || true
  PIDS=()
  sleep 0.5
  python3 - "$T" "$r" "$prev" "$name" "$cc" "${ask:--}" "$probe" "$delay" >> "$OUT" <<'PY'
import json, re, sys
t, r, prev, name, cc, ask, probe, delay = sys.argv[1:]
def mbps(f):
    try:
        m = json.load(open(f)); return m["fill_bytes"] * 8 / m["fill_dwell_ms"] / 1000
    except Exception:
        return 0.0
relay = open(t + "/relay.log").read()
down = re.findall(r"udp :\d+ client->server .*? \| server->client sent (\d+) lost (\d+) overflowed (\d+) codel (\d+)", relay)
sent, lost, over, codel = map(int, down[0]) if down else (0, 0, 0, 0)
log = re.sub(r"\x1b\[[0-9;]*m", "", open(t + "/server.log", errors="replace").read())
paths = re.findall(r"session path .*?\bsent=(\d+) lost=(\d+) congestion_events=(\d+)", log)
ce = paths[-1][2] if paths else "-"
rtt, probe_loss = probe.split()
a, b = mbps(t + "/flow0.json"), mbps(t + "/flowN.json")
print("\t".join(map(str, [r, prev, name, cc, ask, "%.3f" % a, "%.3f" % b, "%.1f" % (float(rtt) - 2 * float(delay)),
                          probe_loss, sent, lost, over, codel, ce, int("VOID" in relay)])))
PY
  tail -1 "$OUT"
}

locked() { flock 9; "$@"; } 9>"$LOCK"

one_round() {  # round
  local name k prev
  for name in "${PROFILES[@]}"; do
    prev=-
    for k in $(python3 lab/scripts/order.py row "${#ARMS[@]}" "$1"); do
      run "$1" "$prev" "$name" "${ARMS[k]}"
      prev="${ARMS[k]}"
    done
  done
}

echo "dwell ${DWELL_MS} ms; traces: $(cd "$TRACES" && sha256sum ./*.down | cut -c1-16,66- | tr '\n' ' '); raw: $OUT"
[ -s "$OUT" ] || printf 'round\tprev\tprofile\tarm\task_ms\tmbps\tneighbour_mbps\tqueue_ms\tprobe_loss\tsent\tlost\toverflowed\tcodel\tcong\tvoid\n' > "$OUT"
for ((r = FIRST; r < ROUNDS; r++)); do locked one_round "$r"; done

python3 - "$OUT" <<'PY'
import collections, statistics, sys
rows = [dict(zip(h, l.rstrip("\n").split("\t"))) for h in [open(sys.argv[1]).readline().rstrip("\n").split("\t")]
        for l in list(open(sys.argv[1]))[1:]]
kept = [x for x in rows if x["void"] == "0"]
med = lambda v: statistics.median(v) if v else float("nan")
print("\n%-16s %-12s %2s %9s %8s %7s %9s %7s %7s %7s" % ("profile", "arm", "n", "ask ms", "Mbit/s", "share",
      "queue ms", "lost %", "over %", "codel %"))
cells = collections.defaultdict(list)
for x in kept:
    cells[(x["profile"], x["arm"])].append(x)
for (p, arm), v in sorted(cells.items()):
    pct = lambda k: med([100 * int(x[k]) / max(1, int(x["sent"]) + int(x["lost"]) + int(x["overflowed"]) + int(x["codel"])) for x in v])
    a = [float(x["mbps"]) for x in v]
    share = med([float(x["mbps"]) / (float(x["mbps"]) + float(x["neighbour_mbps"])) for x in v
                 if float(x["neighbour_mbps"]) > 0])
    print("%-16s %-12s %2d %9.1f %8.2f %6s %9.1f %7.2f %7.2f %7.2f" % (p, arm, len(v),
          med([float(x["ask_ms"]) for x in v if x["ask_ms"] != "-"]), med(a),
          "-" if share != share else "%.0f%%" % (100 * share), med([float(x["queue_ms"]) for x in v]),
          pct("lost"), pct("overflowed"), pct("codel")))
# Paired by round, against Cubic: fill ratio and ask difference, and how many rounds each wins.
print("\npaired against cubic, same profile and round: fill x (rounds faster) | ask ms (rounds faster)")
by = {(x["profile"], x["arm"], x["round"]): x for x in kept}
for (p, arm) in sorted(cells):
    if arm == "cubic":
        continue
    pairs = [(by[(p, arm, r)], by[(p, "cubic", r)]) for (pp, aa, r) in by if pp == p and aa == arm and (p, "cubic", r) in by]
    if not pairs:
        continue
    fx = [float(a["mbps"]) / float(c["mbps"]) for a, c in pairs if float(c["mbps"]) > 0]
    asks = [float(a["ask_ms"]) - float(c["ask_ms"]) for a, c in pairs if "-" not in (a["ask_ms"], c["ask_ms"])]
    print("%-16s %-12s %5.2fx (%d/%d)   %+8.1f ms (%d/%d)" % (p, arm, med(fx), sum(f > 1 for f in fx), len(fx),
          med(asks), sum(d < 0 for d in asks), len(asks)))
print("\nvoid runs dropped: %d of %d" % (len(rows) - len(kept), len(rows)))
PY
