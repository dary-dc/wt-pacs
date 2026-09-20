#!/usr/bin/env bash
# N2: what the relay's radio modes change, against the models they sit beside.
#   jitter      S26 — jitter that reorders against jitter that does not, Cubic and BBR, and
#               Cubic's packet threshold raised under the reordering one.
#   outage      S33 — a blackout that drops against one that holds, Cubic and BBR.
#   two-blinks  S33's prediction — a second blink 3 s after the first, on both models.
# Arms are interleaved inside every round and the relay takes the round as its seed, so every
# arm of a round meets the same draw. Results: docs/transport/transport-conclusions.md §3.
#
#   lab/scripts/radio_link_cells.sh jitter|outage|two-blinks [rounds]
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

CELL="${1:-jitter}"
ROUNDS="${2:-5}"
RTT="${RTT:-80}"
RATE="${RATE:-20000}"
QUEUE="${QUEUE:-1500}"
KB=64
T="$(mktemp -d)"
PIDS=()
cleanup() { for p in "${PIDS[@]:-}"; do kill "$p" 2>/dev/null || true; done; rm -rf "$T"; }
trap cleanup EXIT

case "$CELL" in
  jitter)
    FILL="${FILL:-40}"
    ARMS=(
      "cubic j0|--jitter-ms 0||"
      "bbr j0|--jitter-ms 0|--congestion bbr|"
      "cubic j2 reorder|--jitter-ms 2 --jitter-mode reorder||"
      "cubic j2 ordered|--jitter-ms 2 --jitter-mode ordered||"
      "bbr j2 reorder|--jitter-ms 2 --jitter-mode reorder|--congestion bbr|"
      "bbr j2 ordered|--jitter-ms 2 --jitter-mode ordered|--congestion bbr|"
      "cubic j2 reorder pt6|--jitter-ms 2 --jitter-mode reorder|--packet-threshold 6|"
      "cubic j2 reorder pt12|--jitter-ms 2 --jitter-mode reorder|--packet-threshold 12|"
      "cubic j2 reorder pt48|--jitter-ms 2 --jitter-mode reorder|--packet-threshold 48|"
      "cubic j10 reorder|--jitter-ms 10 --jitter-mode reorder||"
      "cubic j10 ordered|--jitter-ms 10 --jitter-mode ordered||"
      "bbr j10 reorder|--jitter-ms 10 --jitter-mode reorder|--congestion bbr|"
      "bbr j10 ordered|--jitter-ms 10 --jitter-mode ordered|--congestion bbr|"
      "cubic j10 reorder pt6|--jitter-ms 10 --jitter-mode reorder|--packet-threshold 6|"
      "cubic j10 reorder pt12|--jitter-ms 10 --jitter-mode reorder|--packet-threshold 12|"
      "cubic j10 reorder pt48|--jitter-ms 10 --jitter-mode reorder|--packet-threshold 48|"
    )
    STATE=filled
    PAIRS="cubic j2 reorder>cubic j0;cubic j2 ordered>cubic j0;bbr j2 reorder>bbr j0;bbr j2 ordered>bbr j0;cubic j2 reorder pt6>cubic j2 reorder;cubic j2 reorder pt12>cubic j2 reorder;cubic j2 reorder pt48>cubic j2 reorder;cubic j10 reorder>cubic j0;cubic j10 ordered>cubic j0;bbr j10 reorder>bbr j0;bbr j10 ordered>bbr j0;cubic j10 reorder pt6>cubic j10 reorder;cubic j10 reorder pt12>cubic j10 reorder;cubic j10 reorder pt48>cubic j10 reorder"
    ;;
  outage)
    FILL="${FILL:-40}"
    ARMS=()
    for ms in 500 1000 2000; do
      for arm in "cubic:" "bbr:--congestion bbr"; do
        for mode in drop hold; do
          ARMS+=("${arm%%:*} $mode $ms|--blackout-mode $mode|${arm#*:}|--blackout-ms $ms")
        done
      done
    done
    STATE=lossy
    PAIRS="cubic hold 500>cubic drop 500;bbr hold 500>bbr drop 500;cubic hold 1000>cubic drop 1000;bbr hold 1000>bbr drop 1000;cubic hold 2000>cubic drop 2000;bbr hold 2000>bbr drop 2000"
    ;;
  two-blinks)
    FILL="${FILL:-200}"
    ARMS=(
      "cubic drop x1|--blackout-mode drop||--blackout-ms 1000"
      "cubic drop x2 +3s|--blackout-mode drop||--blackout-ms 1000 --blackout-again-after-ms 3000"
      "cubic drop x2 +0.2s|--blackout-mode drop||--blackout-ms 1000 --blackout-again-after-ms 1200"
      "cubic hold x1|--blackout-mode hold||--blackout-ms 1000"
      "cubic hold x2 +3s|--blackout-mode hold||--blackout-ms 1000 --blackout-again-after-ms 3000"
      "cubic hold x2 +0.2s|--blackout-mode hold||--blackout-ms 1000 --blackout-again-after-ms 1200"
    )
    STATE=lossy
    PAIRS="cubic drop x2 +3s>cubic drop x1;cubic drop x2 +0.2s>cubic drop x1;cubic hold x2 +3s>cubic hold x1;cubic hold x2 +0.2s>cubic hold x1"
    ;;
  *) echo "usage: $0 jitter|outage|two-blinks [rounds]"; exit 2 ;;
esac

cargo build -q -p exact-server -p pack-study -p window-harness
BIN="${CARGO_TARGET_DIR:-target}/debug"
openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -keyout "$T/key.pem" \
  -out "$T/cert.pem" -days 2 -nodes -subj '/CN=localhost' \
  -addext 'basicConstraints=critical,CA:FALSE' -addext 'keyUsage=critical,digitalSignature' \
  -addext 'extendedKeyUsage=serverAuth' -addext 'subjectAltName=DNS:localhost,IP:127.0.0.1' 2>/dev/null
mkdir -p "$T/frames"
for i in $(seq 0 "$FILL"); do
  head -c $((KB * 1024)) /dev/urandom > "$T/frames/$(printf '%03d' "$i").htj2k"
done
echo "{\"frameCount\": $((FILL + 1))}" > "$T/metadata.json"
"$BIN/pack-study" --metadata "$T/metadata.json" --frames "$T/frames" --output "$T/study.sbnd" >/dev/null

SRV=$((36000 + RANDOM % 2000))
IN=$((34000 + RANDOM % 2000))
CTRL=$((38000 + RANDOM % 2000))

# Per session: datagrams sent, lost, congestion events, and the smoothed RTT the session ended on.
link_cost() {
  python3 - "$T/server.log" <<'PY'
import re, sys
text = re.sub(r"\x1b\[[0-9;]*m", "", open(sys.argv[1], errors="replace").read())
rows = re.findall(r"session path .*?\brtt_us=(\d+) .*?\bsent=(\d+) lost=(\d+) congestion_events=(\d+)", text)
if not rows:
    print("- - - -")
else:
    n = len(rows)
    cols = [sum(int(r[i]) for r in rows) / n for i in range(4)]
    print("%.0f %.0f %.1f %.1f" % (cols[0] / 1000, cols[1], cols[2], cols[3]))
PY
}

run() {  # round label relay-args server-args probe-args
  local round="$1" label="$2"
  read -ra relay_args <<<"$3"
  read -ra server_args <<<"$4"
  read -ra probe_args <<<"$5"
  : > "$T/server.log"
  RUST_LOG=exact_server=info "$BIN/exact-server" --port "$SRV" --study "$T/study.sbnd" \
    --cert-pem "$T/cert.pem" --key-pem "$T/key.pem" "${server_args[@]}" > "$T/server.log" 2>&1 &
  local srv=$!
  PIDS+=("$srv")
  for _ in $(seq 100); do grep -q "wt_url=" "$T/server.log" && break; sleep 0.1; done
  python3 lab/scripts/link_impair.py --udp "$IN:$SRV" --delay-ms "$((RTT / 2))" \
    --rate-kbit "$RATE" --queue-pkts "$QUEUE" --control-port "$CTRL" --seed "$round" \
    "${relay_args[@]}" > "$T/relay.log" 2>&1 &
  local relay=$!
  PIDS+=("$relay")
  for _ in $(seq 50); do grep -q READY "$T/relay.log" && break; sleep 0.1; done
  local line
  if line=$(RUST_BACKTRACE=0 "$BIN/first_ask" --url "https://127.0.0.1:$IN/" --state "$STATE" \
      --warm "$FILL" --target "$FILL" --control-port "$CTRL" --rounds 1 --timeout-ms 120000 \
      "${probe_args[@]}" 2>&1); then
    # The last session's close is still in the relay's delay queue and the server writes its
    # `session path` line when it arrives, so let it. A backed-up queue can outlast this, and
    # then the counters are missing for that round while the fill still counts.
    sleep 1.0
    kill -TERM "$relay" 2>/dev/null || true
    sleep 0.3
    read -r rtt_ms sent lost ce < <(link_cost)
    printf '%d\t%s\t%s\t%s\t%s\t%s\t%s\n' "$round" "$label" \
      "$(sed -n 's/.*fill_ms median=\([0-9.]*\).*/\1/p' <<<"$line")" \
      "$sent" "$lost" "$ce" "$rtt_ms" >> "$T/rows.tsv"
  else
    printf '%-24s round %d FAILED %s\n' "$label" "$round" "$(head -2 <<<"$line" | tr '\n' ' ')" >&2
    kill -TERM "$relay" 2>/dev/null || true
  fi
  kill "$srv" 2>/dev/null || true
  sleep 0.3
}

: > "$T/rows.tsv"
echo "cell $CELL · ${RTT} ms round trip, ${RATE} kbit, queue $QUEUE, fill $((FILL * KB)) KB, $ROUNDS rounds"
for round in $(seq 1 "$ROUNDS"); do
  for spec in "${ARMS[@]}"; do
    IFS='|' read -r label relay server probe <<<"$spec"
    run "$round" "$label" "$relay" "$server" "$probe"
  done
  printf 'round %d done\n' "$round" >&2
done

if [[ -n "${OUT_TSV:-}" ]]; then cp "$T/rows.tsv" "$OUT_TSV"; fi
python3 - "$T/rows.tsv" "$PAIRS" <<'PY'
import statistics as st, sys
rows = [l.split("\t") for l in open(sys.argv[1]).read().splitlines() if l]
by, order = {}, []
for rnd, label, fill, sent, lost, ce, rtt in rows:
    if label not in by:
        by[label] = {}
        order.append(label)
    by[label][int(rnd)] = (float(fill), sent, lost, ce, rtt)
print("\n%-24s %3s %9s %19s %7s %7s %6s %7s %3s" %
      ("arm", "n", "fill ms", "min-max", "sent", "lost", "cong", "end rtt", "nc"))
for label in order:
    v = by[label]
    f = sorted(x[0] for x in v.values())
    counted = [x for x in v.values() if x[1] != "-"]
    col = lambda i: st.median([float(x[i]) for x in counted]) if counted else float("nan")
    print("%-24s %3d %9.0f %8.0f -%9.0f %7.0f %7.0f %6.1f %7.0f %3d" %
          (label, len(f), st.median(f), f[0], f[-1],
           col(1), col(2), col(3), col(4), len(counted)))
print("\n%-24s %-24s %8s %8s" % ("arm", "against", "x median", "wins"))
for pair in sys.argv[2].split(";"):
    a, b = pair.split(">")
    if a not in by or b not in by:
        continue
    shared = sorted(set(by[a]) & set(by[b]))
    ma, mb = st.median([by[a][r][0] for r in shared]), st.median([by[b][r][0] for r in shared])
    wins = sum(by[a][r][0] < by[b][r][0] for r in shared)
    print("%-24s %-24s %8.2f %5d/%d" % (a, b, ma / mb, wins, len(shared)))
PY
