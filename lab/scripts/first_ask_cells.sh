#!/usr/bin/env bash
# W1: one frame asked on an idle session, through lab/scripts/link_impair.py at 40 and 80 ms round
# trip and at two frame sizes. `repro` is the session-state and lever sweep; `idle`, `together` and
# `queue` are the cells that decide a default, and they interleave their arms round by round.
# The server's own `session path` line gives the window, loss and congestion events per arm.
# Results and the verdict they correct: docs/transport/transport-conclusions.md §3.
#
#   lab/scripts/first_ask_cells.sh [repro|idle|together|queue] [rounds]
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

CELL="${1:-repro}"
case "$CELL" in repro) ROUNDS="${2:-5}" ;; *) ROUNDS="${2:-7}" ;; esac
WARM="${WARM:-8}"
# One cell at a time keeps a turn on the shared box short: SIZES=250 RTTS=80 is one.
SIZES="${SIZES:-50 250}"
RTTS="${RTTS:-40 80}"
TARGET=$((WARM + 1))
FRAMES=$((TARGET + 2))
# The pair docs/transport/adr-idle-sessions.md proposes, in every `idle` arm; `HOLD=` runs the same
# cell without it, which is the survive-or-die question.
HOLD="${HOLD---keep-alive-interval-ms 20000 --max-idle-timeout-ms 60000}"
T="$(mktemp -d)"
SERVER_PID=""
RELAY_PID=""
cleanup() { stop_relay; stop_server; rm -rf "$T"; }
trap cleanup EXIT

cargo build -q -p exact-server -p pack-study -p window-harness
BIN="${CARGO_TARGET_DIR:-target}/debug"
openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -keyout "$T/key.pem" \
  -out "$T/cert.pem" -days 2 -nodes -subj '/CN=localhost' \
  -addext 'basicConstraints=critical,CA:FALSE' -addext 'keyUsage=critical,digitalSignature' \
  -addext 'extendedKeyUsage=serverAuth' -addext 'subjectAltName=DNS:localhost,IP:127.0.0.1' 2>/dev/null

for kb in 50 250; do
  mkdir -p "$T/f$kb"
  for i in $(seq 0 $((FRAMES - 1))); do
    head -c $((kb * 1000)) /dev/urandom > "$T/f$kb/$(printf '%03d' "$i").htj2k"
  done
  echo "{\"frameCount\": $FRAMES}" > "$T/m$kb.json"
  "$BIN/pack-study" --metadata "$T/m$kb.json" --frames "$T/f$kb" --output "$T/s$kb.sbnd" >/dev/null
done

SRV=$((36000 + RANDOM % 2000))
IN=$((34000 + RANDOM % 2000))
CTRL=$((38000 + RANDOM % 2000))

# A pid can be recycled onto another lane's process between the spawn and the kill.
kill_ours() { [[ -n "$1" ]] && grep -qa "$2" "/proc/$1/cmdline" 2>/dev/null && kill "$1" 2>/dev/null; }

start_server() {  # study extra...
  : > "$T/server.log"
  RUST_LOG=exact_server=info "$BIN/exact-server" --port "$SRV" --study "$1" \
    --cert-pem "$T/cert.pem" --key-pem "$T/key.pem" "${@:2}" > "$T/server.log" 2>&1 &
  SERVER_PID=$!
  for _ in $(seq 100); do grep -q "wt_url=" "$T/server.log" && return; sleep 0.1; done
  echo "server did not start:"; cat "$T/server.log"; exit 1
}
stop_server() { kill_ours "$SERVER_PID" exact-server || true; SERVER_PID=""; sleep 0.3; }

RELAY_EXTRA=()
start_relay() {  # rtt_ms; RELAY_EXTRA carries rate and queue when a cell wants them
  python3 lab/scripts/link_impair.py --udp "$IN:$SRV" --delay-ms "$(($1 / 2))" \
    --control-port "$CTRL" ${RELAY_EXTRA[@]+"${RELAY_EXTRA[@]}"} > "$T/relay.log" 2>&1 &
  RELAY_PID=$!
  for _ in $(seq 50); do grep -q READY "$T/relay.log" && return; sleep 0.1; done
  echo "relay did not start"; exit 1
}
stop_relay() { kill_ours "$RELAY_PID" link_impair || true; RELAY_PID=""; sleep 0.3; }

# The server prints one `session path` line per session it ends; the probe opens one per round, so
# these cover the same sessions the median does. Loss and congestion events are per session and
# count the whole of it — a warm-up's loss is in there too, not only the ask's. `cwnd` is the
# window the session ended with, which is after the ask and not at it.
link_cost() {
  python3 - "$T/server.log" <<'PY'
import re, sys
text = re.sub(r"\x1b\[[0-9;]*m", "", open(sys.argv[1], errors="replace").read())
rows = [tuple(int(x) for x in m) for m in re.findall(
    r"session path .*?\bcwnd=(\d+) sent=(\d+) lost=(\d+) congestion_events=(\d+)", text)]
if not rows:
    print("- - - -")
else:
    n = len(rows)
    print("%d %d %.1f %.1f" % (sum(r[0] for r in rows) // n, sum(r[1] for r in rows) // n,
                               sum(r[2] for r in rows) / n, sum(r[3] for r in rows) / n))
PY
}

cell() {  # label state study rtt warm extra_server_args...
  local label="$1" state="$2" study="$3" rtt="$4" warm="$5"
  shift 5
  start_server "$study" "$@"
  start_relay "$rtt"
  local line
  line=$(RUST_BACKTRACE=0 "$BIN/first_ask" --url "https://127.0.0.1:$IN/" --state "$state" --warm "$warm" \
    --target "$TARGET" --control-port "$CTRL" --rounds "$ROUNDS" 2>&1) || {
      printf '%-22s %-9s FAILED %s\n' "$label" "${rtt} ms" "$(head -3 <<<"$line" | tr "\n" " ")"; stop_relay
      stop_server; return; }
  stop_relay
  local ms
  ms=$(sed -n 's/.*ask_to_last_byte_ms median=\([0-9.]*\).*/\1/p' <<<"$line")
  read -r _cwnd sent lost ce < <(link_cost)
  stop_server
  printf '%-22s %-9s %9.1f %8.2f %9s %6s %6s\n' \
    "$label" "${rtt} ms" "$ms" "$(python3 -c "print($ms/$rtt)")" "$sent" "$lost" "$ce"
}

header() {
  printf '\n== %s\n%-22s %-9s %9s %8s %9s %6s %6s\n' "$1" \
    "arm" "rtt" "ask ms" "trips" "sent/sess" "lost" "cong"
}

# An arm is `label|state|warm|idle_ms|server args|relay args`. Arms are compared, so a round runs
# every one of them and reverses the order on every other round.
ARMS=()
arm() { ARMS+=("$1"); }

one_round() {  # state warm idle study rtt server_args relay_args -> "ms cwnd sent lost ce"
  local state="$1" warm="$2" idle="$3" study="$4" rtt="$5" srv rly line ms
  read -r -a srv <<<"$6"
  read -r -a RELAY_EXTRA <<<"$7"
  start_server "$study" ${srv[@]+"${srv[@]}"}
  start_relay "$rtt"
  if line=$(RUST_BACKTRACE=0 "$BIN/first_ask" --url "https://127.0.0.1:$IN/" --state "$state" \
      --warm "$warm" --target "$TARGET" --idle-ms "$idle" --control-port "$CTRL" --rounds 1 2>&1)
  then ms=$(sed -n 's/.*ask_to_last_byte_ms median=\([0-9.]*\).*/\1/p' <<<"$line")
  else ms=nan
  fi
  # The close still has a one-way delay to travel, and the relay carries it: read the path line
  # before stopping the relay, or the session never ends and there is no line.
  for _ in $(seq 40); do grep -q "session path" "$T/server.log" && break; sleep 0.05; done
  local cost
  cost=$(link_cost)
  stop_relay
  stop_server
  echo "$ms $cost"
}

round_robin() {  # study rtt
  local study="$1" rtt="$2" n=${#ARMS[@]} i j k
  rm -rf "$T/rr"; mkdir -p "$T/rr"
  for ((k = 0; k < n; k++)); do cut -d'|' -f1 <<<"${ARMS[k]}" >> "$T/rr/labels"; done
  for ((i = 0; i < ROUNDS; i++)); do
    for ((j = 0; j < n; j++)); do
      if ((i % 2 == 0)); then k=$j; else k=$((n - 1 - j)); fi
      IFS='|' read -r _ state warm idle srv rly <<<"${ARMS[k]}"
      one_round "$state" "$warm" "$idle" "$study" "$rtt" "$srv" "$rly" >> "$T/rr/$k"
    done
  done
  python3 - "$T/rr" "$n" <<'PY'
import statistics, sys
d, n = sys.argv[1], int(sys.argv[2])
labels = open(d + "/labels").read().split("\n")
cols = []
for k in range(n):
    rows = [r.split() for r in open("%s/%d" % (d, k)) if r.strip()]
    cols.append([(float(r[0]) if r[0] != "nan" else None, r[1:]) for r in rows])
base = [v for v, _ in cols[0]]
print("%-26s %9s %15s %7s %8s %7s %6s" %
      ("arm", "ask ms", "min-max", "wins", "cwnd", "lost", "fails"))
for k in range(n):
    got = [v for v, _ in cols[k] if v is not None]
    wins = sum(1 for (a, _), b in zip(cols[k], base) if a is not None and b is not None and a < b)
    cw = [int(c[0]) for _, c in cols[k] if c[0] != "-"]
    lost = [float(c[2]) for _, c in cols[k] if c[2] != "-"]
    print("%-26s %9s %15s %7s %8s %7s %6d" % (
        labels[k],
        "%.1f" % statistics.median(got) if got else "-",
        "%.1f-%.1f" % (min(got), max(got)) if got else "-",
        "" if k == 0 else "%d/%d" % (wins, len(cols[k])),
        "%d" % statistics.median(cw) if cw else "-",
        "%.1f" % statistics.mean(lost) if lost else "-",
        len(cols[k]) - len(got)))
PY
}

repro() {
  for kb in 50 250; do
    header "${kb} KB frames"
    for rtt in 40 80; do
      for state in fresh filled lossy rebound; do
        cell "$state" "$state" "$T/s$kb.sbnd" "$rtt" "$WARM"
      done
      # Lever 1: the warm-up rides in the session URL, swept by how many frames it carries.
      for w in 1 2 4 8; do
        cell "open-push $((w * kb)) KB" open-push "$T/s$kb.sbnd" "$rtt" "$w" --open-ask
      done
      # Lever 2: 32 packets before the first ACK, against quinn's 12 000 bytes.
      cell "fresh, iw 32 pkt" fresh "$T/s$kb.sbnd" "$rtt" "$WARM" --initial-window-bytes 38400
      cell "filled, iw 32 pkt" filled "$T/s$kb.sbnd" "$rtt" "$WARM" --initial-window-bytes 38400
    done
  done

  # A 32-packet initial window is only free where nothing can punish the burst. These cells can:
  # the link is rate-limited and its queue is shallower than the window.
  RELAY_EXTRA=(--rate-kbit 10000 --queue-pkts 20)
  header "250 KB frames, 10 Mbit link with a 20-packet queue"
  for rtt in 40 80; do
    cell "fresh" fresh "$T/s250.sbnd" "$rtt" "$WARM"
    cell "fresh, iw 32 pkt" fresh "$T/s250.sbnd" "$rtt" "$WARM" --initial-window-bytes 38400
    cell "open-push 1000 KB" open-push "$T/s250.sbnd" "$rtt" 4 --open-ask
  done
  RELAY_EXTRA=()
}

# Does a warmed window survive the silence an on-demand viewer leaves between asks?
idle_cells() {
  for kb in $SIZES; do
    for rtt in $RTTS; do
      ARMS=()
      for cc in cubic bbr; do
        for s in 0 10 30; do
          arm "$cc, idle ${s}s|filled|$WARM|$((s * 1000))|--congestion $cc $HOLD|"
        done
      done
      printf '\n== %s KB, %s ms, a warmed session left idle%s\n' "$kb" "$rtt" \
        "${HOLD:+, keep-alive 20 s}"
      round_robin "$T/s$kb.sbnd" "$rtt"
    done
  done
}

# The two levers together, against each alone and against the warmed ceiling.
together_cells() {
  for kb in $SIZES; do
    for rtt in $RTTS; do
      ARMS=()
      arm "fresh|fresh|$WARM|0||"
      arm "iw 32 pkt|fresh|$WARM|0|--initial-window-bytes 38400|"
      arm "push $((4 * kb)) KB|open-push|4|0|--open-ask|"
      arm "push + iw 32 pkt|open-push|4|0|--open-ask --initial-window-bytes 38400|"
      arm "warmed|filled|$WARM|0||"
      printf '\n== %s KB, %s ms, the two levers together\n' "$kb" "$rtt"
      round_robin "$T/s$kb.sbnd" "$rtt"
    done
  done
}

# What the wide first flight costs when the queue is shallower than it: the depth is the lever.
queue_cells() {
  for kb in $SIZES; do
    for rtt in $RTTS; do
      for q in 10 20 40 100; do
        ARMS=()
        arm "default|fresh|$WARM|0||--rate-kbit 10000 --queue-pkts $q"
        arm "iw 32 pkt|fresh|$WARM|0|--initial-window-bytes 38400|--rate-kbit 10000 --queue-pkts $q"
        printf '\n== %s KB, %s ms, 10 Mbit, a %s-packet queue\n' "$kb" "$rtt" "$q"
        round_robin "$T/s$kb.sbnd" "$rtt"
      done
    done
  done
}

case "$CELL" in
  repro) repro ;;
  idle) idle_cells ;;
  together) together_cells ;;
  queue) queue_cells ;;
  *) echo "unknown cell: $CELL"; exit 2 ;;
esac
