#!/usr/bin/env bash
# W1: one frame asked on an idle session, through lab/scripts/link_impair.py at 40 and 80 ms round
# trip and at two frame sizes. `repro` is the session-state and lever sweep; `idle`, `together` and
# `queue` are the cells that decide a default, and `wake` prices one radio's promotion; they
# interleave their variants round by round in a Williams order (lab/scripts/order.py).
# The server's own `session path` line gives the window, loss and congestion events per variant.
# Results and the verdict they correct: docs/transport/transport-conclusions.md §3.
#
#   lab/scripts/first_ask_cells.sh [repro|idle|together|queue|resume|wake|stw|late|keep|rebind] [rounds]
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

CELL="${1:-repro}"
case "$CELL" in repro) ROUNDS="${2:-5}" ;; *) ROUNDS="${2:-7}" ;; esac
WARM="${WARM:-8}"
# One cell at a time keeps a turn on the shared box short: SIZES=250 RTTS=80 is one.
[[ "$CELL" == stw ]] && : "${SIZES:=250}" "${RTTS:=60}"
[[ "$CELL" == late || "$CELL" == keep ]] && : "${SIZES:=250}" "${RTTS:=80}"
SIZES="${SIZES:-50 250}"
RTTS="${RTTS:-40 80}"
TARGET=$((WARM + 1))
FRAMES=$((TARGET + 2))
# The pair docs/adr/transport-idle-sessions.md proposes, in every `idle` variant; `HOLD=` runs the same
# cell without it, which is the survive-or-die question.
HOLD="${HOLD---keep-alive-interval-ms 20000 --max-idle-timeout-ms 60000}"
T="$(mktemp -d)"
SERVER_PID=""
RELAY_PID=""
cleanup() { stop_relay; stop_server; rm -rf "$T"; }
trap cleanup EXIT

cargo build -q -p series-server -p pack-series -p window-harness
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
  "$BIN/pack-series" --metadata "$T/m$kb.json" --frames "$T/f$kb" --output "$T/s$kb.sbnd" >/dev/null
done

SRV=$((36000 + RANDOM % 2000))
IN=$((34000 + RANDOM % 2000))
CTRL=$((38000 + RANDOM % 2000))

# A pid can be recycled onto another lane's process between the spawn and the kill.
kill_ours() { [[ -n "$1" ]] && grep -qa "$2" "/proc/$1/cmdline" 2>/dev/null && kill "$1" 2>/dev/null; }

start_server() {  # series extra...
  : > "$T/server.log"
  RUST_LOG=series_server=info "$BIN/series-server" --port "$SRV" --series "$1" \
    --cert-pem "$T/cert.pem" --key-pem "$T/key.pem" "${@:2}" > "$T/server.log" 2>&1 &
  SERVER_PID=$!
  for _ in $(seq 100); do grep -q "wt_url=" "$T/server.log" && return; sleep 0.1; done
  echo "server did not start:"; cat "$T/server.log"; exit 1
}
stop_server() { kill_ours "$SERVER_PID" series-server || true; SERVER_PID=""; sleep 0.3; }

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

cell() {  # label state series rtt warm extra_server_args...
  local label="$1" state="$2" series="$3" rtt="$4" warm="$5"
  shift 5
  start_server "$series" "$@"
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
    "variant" "rtt" "ask ms" "trips" "sent/sess" "lost" "cong"
}

# A variant is `label|state|warm|idle_ms|server args|relay args|probe args`. Variants are compared, so a
# round runs every one of them, in a Williams order.
VARIANTS=()
variant() { VARIANTS+=("$1"); }

one_round() {  # state warm idle series rtt server_args relay_args probe_args -> "ms cwnd sent lost ce"
  local state="$1" warm="$2" idle="$3" series="$4" rtt="$5" srv probe line ms next
  read -r -a srv <<<"$6"
  read -r -a RELAY_EXTRA <<<"$7"
  read -r -a probe <<<"${8:-}"
  start_server "$series" ${srv[@]+"${srv[@]}"}
  start_relay "$rtt"
  if line=$(RUST_BACKTRACE=0 "$BIN/first_ask" --url "https://127.0.0.1:$IN/" --state "$state" \
      --warm "$warm" --target "$TARGET" --idle-ms "$idle" --control-port "$CTRL" --rounds 1 \
      ${probe[@]+"${probe[@]}"} 2>&1)
  then ms=$(sed -n 's/.*ask_to_last_byte_ms median=\([0-9.]*\).*/\1/p' <<<"$line")
       next=$(sed -n 's/.*next_ask_ms median=\([0-9.a-zA-Z]*\).*/\1/p' <<<"$line")
  else ms=nan
  fi
  # The close still has a one-way delay to travel, and the relay carries it: read the path line
  # before stopping the relay, or the session never ends and there is no line.
  for _ in $(seq 40); do grep -q "session path" "$T/server.log" && break; sleep 0.05; done
  local cost
  cost=$(link_cost)
  stop_relay
  grep -q VOID "$T/relay.log" && ms=void  # --self-timing: the relay, not the link, was late
  [[ $state != rebound ]] || grep -q REBOUND "$T/relay.log" || ms=nan  # the poke never landed
  stop_server
  echo "$ms $cost ${next:-NaN}"
}

round_robin() {  # series rtt
  local series="$1" rtt="$2" n=${#VARIANTS[@]} i k prev
  rm -rf "$T/rr"; mkdir -p "$T/rr"
  for ((k = 0; k < n; k++)); do cut -d'|' -f1 <<<"${VARIANTS[k]}" >> "$T/rr/labels"; done
  for ((i = 0; i < ROUNDS; i++)); do
    prev=-1
    for k in $(python3 lab/scripts/order.py row "$n" "$i"); do
      IFS='|' read -r _ state warm idle srv rly probe <<<"${VARIANTS[k]}"
      echo "$(one_round "$state" "$warm" "$idle" "$series" "$rtt" "$srv" "$rly" "$probe") $i $prev" >> "$T/rr/$k"
      prev=$k
    done
  done
  python3 - "$T/rr" "$n" <<'PY'
import statistics, sys
sys.path.insert(0, "lab/scripts")
from order import leads_by_predecessor
d, n = sys.argv[1], int(sys.argv[2])
labels = open(d + "/labels").read().split("\n")
cols, voids = [], []
for k in range(n):
    rows = [r.split() for r in open("%s/%d" % (d, k)) if r.strip()]
    voids.append(sum(r[0] == "void" for r in rows))
    cols.append([(float(r[0]) if r[0] != "nan" else None, r[1:]) for r in rows if r[0] != "void"])
base = {int(c[-2]): v for v, c in cols[0] if v is not None}
print("%-26s %9s %15s %9s %7s %8s %7s %6s %5s %9s" %
      ("variant", "ask ms", "min-max", "paired", "wins", "cwnd", "lost", "fails", "void", "next ask"))
for k in range(n):
    got = [v for v, _ in cols[k] if v is not None]
    pairs = [v - base[int(c[-2])] for v, c in cols[k] if v is not None and int(c[-2]) in base]
    wins = sum(1 for d in pairs if d < 0)
    cw = [int(c[0]) for _, c in cols[k] if c[0] != "-"]
    lost = [float(c[2]) for _, c in cols[k] if c[2] != "-"]
    nxt = [float(c[4]) for v, c in cols[k] if v is not None and c[4].lower() != "nan"]
    print("%-26s %9s %15s %9s %7s %8s %7s %6d %5d %9s" % (
        labels[k],
        "%.1f" % statistics.median(got) if got else "-",
        "%.1f-%.1f" % (min(got), max(got)) if got else "-",
        "" if k == 0 or not pairs else "%+.1f" % statistics.median(pairs),
        "" if k == 0 else "%d/%d" % (wins, len(pairs)),
        "%d" % statistics.median(cw) if cw else "-",
        "%.1f" % statistics.mean(lost) if lost else "-",
        len(cols[k]) - len(got), voids[k], "%.1f" % statistics.median(nxt) if nxt else "-"))
split = [{"round": int(c[-2]), "unit": labels[k], "prev": labels[int(c[-1])] if int(c[-1]) >= 0 else None, "v": v}
         for k in range(n) for v, c in cols[k]]
print("ask ms, each lead by the predecessor it ran after, rounds in brackets")
for line in leads_by_predecessor(split, labels[:n], [(labels[k], labels[0]) for k in range(1, n)], 1):
    print(line)
PY
}

repro() {
  for kb in 50 250; do
    header "${kb} KB frames"
    for rtt in 40 80; do
      for state in fresh filled lossy rebound; do
        cell "$state" "$state" "$T/s$kb.sbnd" "$rtt" "$WARM"
      done
      # Pushed at session open: the warm-up rides in the session URL, swept by how many frames it carries.
      for w in 1 2 4 8; do
        cell "open-push $((w * kb)) KB" open-push "$T/s$kb.sbnd" "$rtt" "$w" --opening-ask
      done
      # A 32-packet initial window: 32 packets before the first ACK, against quinn's 12 000 bytes.
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
    cell "open-push 1000 KB" open-push "$T/s250.sbnd" "$rtt" 4 --opening-ask
  done
  RELAY_EXTRA=()
}

# Does a warmed window survive the silence an on-demand viewer leaves between asks?
idle_cells() {
  for kb in $SIZES; do
    for rtt in $RTTS; do
      VARIANTS=()
      for cc in cubic bbr; do
        for s in 0 10 30; do
          variant "$cc, idle ${s}s|filled|$WARM|$((s * 1000))|--congestion $cc $HOLD|"
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
      VARIANTS=()
      variant "fresh|fresh|$WARM|0||"
      variant "iw 32 pkt|fresh|$WARM|0|--initial-window-bytes 38400|"
      variant "push $((4 * kb)) KB|open-push|4|0|--opening-ask|"
      variant "push + iw 32 pkt|open-push|4|0|--opening-ask --initial-window-bytes 38400|"
      variant "warmed|filled|$WARM|0||"
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
        VARIANTS=()
        variant "default|fresh|$WARM|0||--rate-kbit 10000 --queue-pkts $q"
        variant "iw 32 pkt|fresh|$WARM|0|--initial-window-bytes 38400|--rate-kbit 10000 --queue-pkts $q"
        printf '\n== %s KB, %s ms, 10 Mbit, a %s-packet queue\n' "$kb" "$rtt" "$q"
        round_robin "$T/s$kb.sbnd" "$rtt"
      done
    done
  done
}

# C1: Careful Resume's jump, approximated — a fresh session started at half the window a filled one
# ended with, without the validation or the retreat. LINKS are relay arguments, `;`-separated.
resume_cells() {
  local link cwnd
  IFS=';' read -r -a links <<<"${LINKS:-;--rate-kbit 10000 --queue-pkts 20}"
  for kb in $SIZES; do
    for rtt in $RTTS; do
      for link in "${links[@]}"; do
        read -r _ cwnd _ <<<"$(one_round filled "$WARM" 0 "$T/s$kb.sbnd" "$rtt" "" "$link")"
        VARIANTS=()
        variant "fresh|fresh|$WARM|0||$link"
        variant "warmed|filled|$WARM|0||$link"
        variant "jump $((cwnd / 2)) B|fresh|$WARM|0|--initial-window-bytes $((cwnd / 2))|$link"
        variant "push 4|open-push|4|0|--opening-ask|$link"
        variant "push 4 + jump|open-push|4|0|--opening-ask --initial-window-bytes $((cwnd / 2))|$link"
        printf '\n== %s KB, %s ms, %s; the filled session ended at cwnd %s B\n' "$kb" "$rtt" "${link:-unshaped}" "$cwnd"
        round_robin "$T/s$kb.sbnd" "$rtt"
      done
    done
  done
}

# One radio's idle penalty (relay --idle-promote) and a wake datagram sent L ms ahead of the ask:
# each variant should read the unpromoted ask plus max(0, P - L). docs/transport/transport-conclusions.md §3.
wake_cells() {
  local p l radio
  for kb in $SIZES; do
    for rtt in $RTTS; do
      VARIANTS=()
      variant "no promotion|filled|$WARM|6000||--self-timing|"
      for p in ${PROMOTIONS:-80 300}; do
        radio="--self-timing --idle-promote 5:$p"
        variant "P $p, no wake|filled|$WARM|6000||$radio|"
        for l in 0 50 100 200; do
          variant "P $p, wake $l ms ahead|filled|$WARM|6000||$radio|--wake-lead-ms $l"
        done
      done
      printf '\n== %s KB, %s ms, idle 6 s, a radio promoted after 5 s\n' "$kb" "$rtt"
      round_robin "$T/s$kb.sbnd" "$rtt"
    done
  done
}

# The window kept through a silence when the link slowed meanwhile: a trace steps 40 -> 8 Mbit
# STEP_MS after the relay starts, inside the IDLE_MS silence that follows the warm-up.
stw_cells() {
  local step="${STEP_MS:-4000}" idle="${IDLE_MS:-8000}" cc link
  python3 lab/scripts/gen_step_trace.py "40000:$step" "8000:$((60000 - step))" > "$T/step.trace"
  python3 lab/scripts/gen_step_trace.py 8000:60000 > "$T/slow.trace"
  python3 lab/scripts/gen_step_trace.py 40000:60000 > "$T/fast.trace"
  for kb in $SIZES; do
    for rtt in $RTTS; do
      VARIANTS=()
      link="--self-timing --queue-pkts 50 --trace"
      for cc in cubic cubic-restart; do
        variant "$cc, 40 -> 8|filled|$WARM|$idle|--congestion $cc $HOLD|$link $T/step.trace|"
      done
      variant "cubic, 8 throughout|filled|$WARM|$idle|--congestion cubic $HOLD|$link $T/slow.trace|"
      variant "cubic, 40 throughout|filled|$WARM|$idle|--congestion cubic $HOLD|$link $T/fast.trace|"
      printf '\n== %s KB, %s ms, idle %s ms, the link 40 -> 8 Mbit at %s ms, a 50-packet queue\n' \
        "$kb" "$rtt" "$idle" "$step"
      round_robin "$T/s$kb.sbnd" "$rtt"
    done
  done
}

# I1: a radio promoted after 5 s quiet holds the ask's first packet P ms; the next ask follows at
# once, to read what that one inflated round-trip sample costs it.
late_cells() {
  local p idle
  for kb in $SIZES; do
    for rtt in $RTTS; do
      for idle in 6000 10000; do
        VARIANTS=()
        variant "no promotion|filled|$WARM|$idle|$HOLD|--self-timing|--next-ask"
        for p in 200 400 1000 1900; do
          variant "P $p|filled|$WARM|$idle|$HOLD|--self-timing --idle-promote 5:$p|--next-ask"
        done
        printf '\n== %s KB, %s ms, idle %s ms, a radio promoted after 5 s\n' "$kb" "$rtt" "$idle"
        round_robin "$T/s$kb.sbnd" "$rtt"
      done
    done
  done
}

# I1: what keeps the radio up through 10 s of silence — a server keep-alive, or one datagram
# sent ahead of the ask — against neither, with P = KEEP_P.
keep_cells() {
  local p="${KEEP_P:-400}" ka l radio
  radio="--self-timing --idle-promote 5:$p"
  for kb in $SIZES; do
    for rtt in $RTTS; do
      VARIANTS=()
      variant "no keep-alive|filled|$WARM|10000|--max-idle-timeout-ms 60000|$radio|--next-ask"
      for ka in 3 5 10; do
        variant "keep-alive ${ka} s|filled|$WARM|10000|--keep-alive-interval-ms $((ka * 1000)) --max-idle-timeout-ms 60000|$radio|--next-ask"
      done
      for l in 100 300; do
        variant "poke $l ms ahead|filled|$WARM|10000|--max-idle-timeout-ms 60000|$radio|--next-ask --wake-lead-ms $l"
      done
      printf '\n== %s KB, %s ms, idle 10 s, P %s ms after 5 s quiet\n' "$kb" "$rtt" "$p"
      round_robin "$T/s$kb.sbnd" "$rtt"
    done
  done
}

# Which first-ask lever a rebind re-applies. quinn keeps the controller across a port-only change
# and resets it for a new address; the push rides the session URL and is spent at open either way.
rebind_cells() {
  local iw="--initial-window-bytes 38400"
  for kb in $SIZES; do
    for rtt in $RTTS; do
      VARIANTS=()
      variant "fresh|fresh|$WARM|0||--self-timing|"
      variant "warmed|filled|$WARM|0||--self-timing|"
      variant "rebound|rebound|$WARM|0||--self-timing|"
      variant "fresh, iw 32 pkt|fresh|$WARM|0|$iw|--self-timing|"
      variant "rebound, iw 32 pkt|rebound|$WARM|0|$iw|--self-timing|"
      variant "new address|rebound|$WARM|0||--self-timing --rebind-ip 127.0.0.2|"
      variant "new address, iw 32 pkt|rebound|$WARM|0|$iw|--self-timing --rebind-ip 127.0.0.2|"
      printf '\n== %s KB, %s ms, a rebind after the warm-up\n' "$kb" "$rtt"
      round_robin "$T/s$kb.sbnd" "$rtt"
    done
  done
}

case "$CELL" in
  repro) repro ;;
  rebind) rebind_cells ;;
  idle) idle_cells ;;
  together) together_cells ;;
  queue) queue_cells ;;
  resume) resume_cells ;;
  wake) wake_cells ;;
  stw) stw_cells ;;
  late) late_cells ;;
  keep) keep_cells ;;
  *) echo "unknown cell: $CELL"; exit 2 ;;
esac
