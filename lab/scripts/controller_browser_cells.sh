#!/usr/bin/env bash
# The congestion controller priced in headless Chromium, the downloader through the relay —
# a fill and one ask on a fresh session, per controller, variants in a Williams order inside every round
# (lab/scripts/order.py). Each run starts its own server and relay, and the server's `session path`
# line gives what was sent, lost and the smoothed round trip at the end. Results: docs/transport/transport-conclusions.md §1.
#
#   lab/scripts/controller_browser_cells.sh loss1|loss3|radio|blink|jitter10|jitter20 [rounds]
#     [VARIANTS="cubic bbr cubic-restart"] [MODES="fill ask"] [RTT=80] [RATE=20000] [FILL=20] [QUEUE=200]
#     [LOCK=file — held through each round, so a shared host's other campaigns stay out of it]
#
# A variant is a controller, or `name:controller[:server-binary[:server flags]]` — another build, or
# the same one with flags: `iw32:cubic::--initial-window-bytes=38400`.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
CELL="${1:?cell}"
ROUNDS="${2:-7}"
read -r -a VARIANT_LIST <<< "${VARIANTS:-cubic bbr cubic-restart}"
read -r -a MODE_LIST <<< "${MODES:-fill ask}"
RTT="${RTT:-80}"
RATE="${RATE:-20000}"
FILL="${FILL:-20}"
T="$(mktemp -d)"
PIDS=()
CFG=client/dev-transport.json
[[ -f $CFG ]] && cp "$CFG" "$T/cfg.bak"
cleanup() {
  for p in "${PIDS[@]:-}"; do kill "$p" 2>/dev/null || true; done
  if [[ -f $T/cfg.bak ]]; then cp "$T/cfg.bak" "$CFG"; else rm -f "$CFG"; fi
  rm -rf "$T"
}
trap cleanup EXIT
# `timeout` sends TERM, and without this the servers outlive the script — one spun for hours.
trap "exit 143" TERM INT

LINK=(--delay-ms "$((RTT / 2))" --rate-kbit "$RATE" --queue-pkts "${QUEUE:-200}" --self-timing)
BLINK=()
case "$CELL" in
  loss1) LINK+=(--loss 1) ;;
  loss3) LINK+=(--loss 3) ;;
  radio) LINK+=(--jitter-ms 10 --jitter-mode ordered --loss-model ge) ;;
  jitter10) LINK+=(--jitter-ms 10 --jitter-mode ordered) ;;
  jitter20) LINK+=(--jitter-ms 20 --jitter-mode ordered) ;;
  # 500 ms, dropped, 3 s after the page loads: inside the fill, before the ask on a fresh session.
  blink) BLINK=(--blink-at 3000 --blink-ms 500) ;;
  *) echo "unknown cell $CELL" >&2; exit 2 ;;
esac

cargo build -q --release -p series-server
cargo build -q -p pack-series
openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -keyout "$T/key.pem" \
  -out "$T/cert.pem" -days 2 -nodes -subj '/CN=localhost' \
  -addext 'subjectAltName=DNS:localhost,IP:127.0.0.1' 2>/dev/null
HASH=$(openssl x509 -in "$T/cert.pem" -outform DER | openssl dgst -sha256 | awk '{print $2}')
mkdir -p "$T/frames"
for i in $(seq 0 $((FILL - 1))); do head -c 438272 /dev/urandom > "$T/frames/$(printf '%03d' "$i").htj2k"; done
echo "{\"frameCount\": $FILL}" > "$T/m.json"
target/debug/pack-series --metadata "$T/m.json" --frames "$T/frames" --output "$T/series.sbnd" >/dev/null

HTTP=$((45000 + RANDOM % 5000))
python3 server/dev-server.py --port "$HTTP" > /dev/null 2>&1 &
PIDS+=("$!")

one() {  # round mode variant
  local srv=$((30000 + RANDOM % 5000)) in=$((35000 + RANDOM % 5000)) ctrl=$((40000 + RANDOM % 5000))
  local name cc bin extra
  IFS=: read -r name cc bin extra <<< "$3"
  cc="${cc:-$name}" bin="${bin:-target/release/series-server}"
  local run=(--fill "$FILL")
  [[ $2 == ask ]] && run=(--asks 1)
  "$bin" --port "$srv" --bind 127.0.0.1 --series "$T/series.sbnd" \
    --cert-pem "$T/cert.pem" --key-pem "$T/key.pem" --congestion "$cc" $extra > "$T/server.log" 2>&1 9>&- &
  local server=$!
  python3 lab/scripts/link_impair.py --udp "$in:$srv" --control-port "$ctrl" --seed "$1" "${LINK[@]}" \
    > "$T/relay.log" 2>&1 9>&- &
  local relay=$!
  echo "{\"wt_url\": \"https://127.0.0.1:$in/\", \"cert_sha256\": \"$HASH\"}" > "$CFG"
  sleep 1
  NODE_PATH="${NODE_PATH:-$(npm root -g)}" node lab/session-survival/run.mjs --rounds 1 --variants built \
    --base "http://127.0.0.1:$HTTP" --control "$ctrl" --no-cut --timeout 600000 --out "$T/row.jsonl" \
    "${run[@]}" "${BLINK[@]}" > /dev/null 9>&-
  # The page's close is still in the relay's delay queue; the server logs the session when it lands.
  for _ in $(seq 30); do grep -q "session path" "$T/server.log" && break; sleep 0.1; done
  kill "$relay" "$server" 2>/dev/null || true
  wait "$relay" "$server" 2>/dev/null || true
  python3 - "$T/row.jsonl" "$T/server.log" "$1" "$2" "$name" "$RTT" "$T/relay.log" "$PREV" <<'PY'
import json, re, sys
row = json.loads(open(sys.argv[1]).read().splitlines()[-1])
# The relay's tally: what its loss model took from the server's packets, and what its queue did.
relay = open(sys.argv[7]).read()
tally = re.findall(r"server->client sent (\d+) lost (\d+) overflowed (\d+)", relay)
# A relay that left packets late reads as link jitter: the run is dropped (rig-limits.md §3).
late = re.findall(r"self-timing packets (\d+) late .*? p99 ([\d.]+) .*", relay)
dropped, overflowed = (int(tally[-1][1]), int(tally[-1][2])) if tally else (None, None)
log = re.sub(r"\x1b\[[0-9;]*m", "", open(sys.argv[2], errors="replace").read())
paths = re.findall(r"session path .*?rtt_us=(\d+) cwnd=(\d+) sent=(\d+) lost=(\d+) congestion_events=(\d+)", log)
sent = sum(int(p[2]) for p in paths); lost = sum(int(p[3]) for p in paths)
rtt = int(paths[-1][0]) / 1000 if paths else None
print(json.dumps({"round": int(sys.argv[3]), "mode": sys.argv[4], "variant": sys.argv[5], "prev": sys.argv[8],
                  "ms": row["spanMs"], "done": row["delivered"] > 0 and row["failures"] == 0,
                  "delivered": row["delivered"], "took_ms": row["tookMs"],
                  "relay_packets": int(late[-1][0]) if late else None,
                  "resumes": row["resumes"], "sent": sent, "lost": lost,
                  "relay_p99_ms": float(late[-1][1]) if late else None, "void": not late or "VOID" in relay,
                  "link_dropped": dropped, "queue_overflowed": overflowed,
                  "cwnd_kb": round(int(paths[-1][1]) / 1000, 1) if paths else None,
                  "queue_ms": round(rtt - int(sys.argv[6]), 1) if rtt else None}))
PY
}

echo "cell $CELL: relay ${LINK[*]} ${BLINK[*]}"
n=${#VARIANT_LIST[@]}
for round in $(seq "$ROUNDS"); do
  if [[ -n ${LOCK:-} ]]; then exec 9> "$LOCK"; flock 9; fi
  for mode in "${MODE_LIST[@]}"; do
    PREV=first
    for k in $(python3 lab/scripts/order.py row "$n" "$round"); do
      one "$round" "$mode" "${VARIANT_LIST[$k]}"
      PREV="${VARIANT_LIST[$k]%%:*}"
    done
  done
  if [[ -n ${LOCK:-} ]]; then exec 9>&-; fi
done | tee "$T/rows.jsonl"

python3 - "$T/rows.jsonl" "${VARIANT_LIST[@]%%:*}" <<'PY'
import collections, json, statistics, sys
sys.path.insert(0, "lab/scripts")
from order import leads_by_predecessor
rows = [json.loads(l) for l in open(sys.argv[1])]
void = [r for r in rows if r["void"]]
rows = [r for r in rows if not r["void"]]
names = sys.argv[2:]
ref = names[0]
by = collections.defaultdict(dict)
# A variant whose every run timed out still gets its line.
med = lambda xs: statistics.median(xs) if xs else float("nan")
for r in rows:
    by[(r["mode"], r["variant"])][r["round"]] = r
print(f"\nmedian [min-max]; rounds each variant beat {ref} in; retransmitted share; standing queue ms; window at close")
for (mode, variant), rs in sorted(by.items()):
    ms = sorted(r["ms"] for r in rs.values() if r["ms"] is not None)
    won = sum(1 for k, r in rs.items() if r["ms"] is not None and by[(mode, ref)].get(k, {}).get("ms") is not None
              and r["ms"] < by[(mode, ref)][k]["ms"])
    share = med([r["lost"] / r["sent"] for r in rs.values() if r["sent"]])
    queue = med([r["queue_ms"] for r in rs.values() if r["queue_ms"] is not None])
    bad = sum(1 for r in rs.values() if not r["done"])
    over = med([r["queue_overflowed"] / r["sent"] for r in rs.values() if r["sent"] and r["queue_overflowed"] is not None])
    print(f"{mode:5} {variant:14} {med(ms):8.0f} [{(ms or [0])[0]:.0f}-{(ms or [0])[-1]:.0f}]  {won}/{len(rs)}"
          f"  lost {100 * share:5.1f} % (queue overflow {100 * over:5.1f} %)  queue {queue:6.1f}"
          f"  resumes {sum(r['resumes'] for r in rs.values())}"
          + f"  window {med([r['cwnd_kb'] for r in rs.values() if r['cwnd_kb'] is not None]):6.1f} KB"
          + (f"  INCOMPLETE {bad}" if bad else ""))
print(f"VOID, dropped: {len(void)}" + "".join(f" · round {r['round']} {r['variant']}" for r in void))
print("\nms, each lead by the predecessor it ran after, rounds in brackets")
for mode in sorted({r["mode"] for r in rows}):
    split = [{"round": r["round"], "unit": r["variant"], "prev": None if r["prev"] == "first" else r["prev"], "v": r["ms"]}
             for r in rows if r["mode"] == mode]
    print(mode)
    for line in leads_by_predecessor(split, names, [(n, ref) for n in names[1:]]):
        print(line)
PY
