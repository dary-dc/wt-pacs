#!/usr/bin/env bash
# RCY: what recycling a session before WebKit bug 319818's stall costs. A 61 MB fill through the
# relay against a server that stalls each session after N bytes (or not), per arm:
#   reactive  stall, no recycle — today: `stallMs` of silence, then a re-dial
#   proactive stall, `recycleAtBytes` N — the replacement dialled at three quarters
#   late      stall, `recycleAtBytes` N on a mutated downloader that closes the old session and
#             only then dials: what the pre-dial is worth
#   recycle   no stall, `recycleAtBytes` N — the recycle's own cost on a healthy session
#   none      no stall, no recycle
# Each run starts its own server and relay, the arms in a Williams order inside every round
# (lab/scripts/order.py); a relay that left packets late voids its run. Results:
# docs/ARCHITECTURE.md §Recycling before the stall.
#
#   lab/session-survival/recycle_cells.sh RTT [rounds]   [ARMS="reactive proactive late recycle none"]
#     [RATE=20000] [N=16777216] [FRAMES=87] [FRAME_BYTES=701000] [LOCK=file] [KEEP=raw rows, jsonl]
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
RTT="${1:?rtt ms}"
ROUNDS="${2:-7}"
read -r -a ARM_LIST <<< "${ARMS:-reactive proactive late recycle none}"
RATE="${RATE:-20000}"
N="${N:-16777216}"
FRAMES="${FRAMES:-87}"
FRAME_BYTES="${FRAME_BYTES:-701000}"
T="$(mktemp -d)"
PIDS=()
CFG=client/dev-transport.json
[[ -f $CFG ]] && cp "$CFG" "$T/cfg.bak"
MUTANT=lab/session-survival/mutant-late-dial
cleanup() {
  for p in "${PIDS[@]:-}"; do kill "$p" 2>/dev/null || true; done
  rm -rf "$MUTANT"
  if [[ -f $T/cfg.bak ]]; then cp "$T/cfg.bak" "$CFG"; else rm -f "$CFG"; fi
  rm -rf "$T"
}
trap cleanup EXIT
trap "exit 143" TERM INT

cargo build -q --release -p exact-server
cargo build -q -p pack-study
openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -keyout "$T/key.pem" \
  -out "$T/cert.pem" -days 2 -nodes -subj '/CN=localhost' \
  -addext 'subjectAltName=DNS:localhost,IP:127.0.0.1' 2>/dev/null
HASH=$(openssl x509 -in "$T/cert.pem" -outform DER | openssl dgst -sha256 | awk '{print $2}')
mkdir -p "$T/frames"
for i in $(seq 0 $((FRAMES - 1))); do head -c "$FRAME_BYTES" /dev/urandom > "$T/frames/$(printf '%03d' "$i").htj2k"; done
(cd "$T/frames" && for f in *.htj2k; do echo "$((10#${f%.htj2k})) $(sha256sum < "$f" | cut -d' ' -f1)"; done) > "$T/sha.txt"
echo "{\"frameCount\": $FRAMES}" > "$T/m.json"
target/debug/pack-study --metadata "$T/m.json" --frames "$T/frames" --output "$T/study.sbnd" >/dev/null

mkdir -p "$MUTANT"
cp client/downloader/*.js "$MUTANT/"
python3 - "$MUTANT/downloader.js" <<'PY'
import sys
p = sys.argv[1]
s = open(p).read()
a = "  const ep = epoch;\n  const next = await openSession(null)"
assert a in s, "the recycle changed: re-derive the mutant"
open(p, "w").write(s.replace(a, "  epoch += 1;\n  asksInFlight = 0;\n  session.close();\n" + a, 1))
PY

HTTP=$((45000 + RANDOM % 5000))
python3 server/dev-server.py --port "$HTTP" > /dev/null 2>&1 &
PIDS+=("$!")

one() {  # round arm prev
  local srv=$((30000 + RANDOM % 5000)) in=$((35000 + RANDOM % 5000)) ctrl=$((40000 + RANDOM % 5000))
  local stall=() query="sha=1"
  [[ $2 == reactive || $2 == proactive || $2 == late ]] && stall=(--stall-after-bytes "$N")
  [[ $2 == proactive || $2 == recycle || $2 == late ]] && query+="&recycle=$N"
  [[ $2 == late ]] && query+="&client=/$MUTANT/consumer.js"
  target/release/exact-server --port "$srv" --bind 127.0.0.1 --study "$T/study.sbnd" \
    --cert-pem "$T/cert.pem" --key-pem "$T/key.pem" "${stall[@]}" > "$T/server.log" 2>&1 9>&- &
  local server=$!
  python3 lab/scripts/link_impair.py --udp "$in:$srv" --control-port "$ctrl" --seed "$1" \
    --delay-ms "$((RTT / 2))" --rate-kbit "$RATE" --queue-pkts 200 --self-timing > "$T/relay.log" 2>&1 9>&- &
  local relay=$!
  echo "{\"wt_url\": \"https://127.0.0.1:$in/\", \"cert_sha256\": \"$HASH\"}" > "$CFG"
  sleep 1
  NODE_PATH="${NODE_PATH:-$(npm root -g)}" node lab/session-survival/run.mjs --rounds 1 --arms "$2" \
    --base "http://127.0.0.1:$HTTP" --control "$ctrl" --no-cut --timeout 300000 --out "$T/row.jsonl" \
    --fill "$FRAMES" --query "$query" > /dev/null 9>&-
  kill "$relay" "$server" 2>/dev/null || true
  wait "$relay" "$server" 2>/dev/null || true
  [[ -n ${KEEP:-} ]] && cat "$T/row.jsonl" >> "$KEEP"
  python3 - "$T/row.jsonl" "$T/relay.log" "$T/sha.txt" "$1" "$2" "$3" <<'PY'
import json, re, sys
row = json.loads(open(sys.argv[1]).read().splitlines()[-1])
relay = open(sys.argv[2]).read()
late = re.findall(r"self-timing packets (\d+) late .*? p99 ([\d.]+) .*", relay)
want = dict(l.split() for l in open(sys.argv[3]))
exact = sum(1 for i, h in row["sha"].items() if want.get(i) == h)
at = sorted(t for _, t in row["frameAt"])
# The gap at a swap: the last frame before it to the first frame after it.
gaps = []
for t in sorted(row["resumedAtMs"] + row["recycledAtMs"]):
    before = [a for a in at if a <= t]
    after = [a for a in at if a > t]
    if after:
        gaps.append(round(after[0] - (before[-1] if before else 0)))
steps = [b - a for a, b in zip(at, at[1:])]
print(json.dumps({"round": int(sys.argv[4]), "arm": sys.argv[5], "prev": sys.argv[6],
                  "ms": row["spanMs"], "delivered": row["delivered"], "failures": row["failures"],
                  "exact": exact, "resumes": len(row["resumedAtMs"]), "recycles": len(row["recycledAtMs"]),
                  "gaps": gaps, "step_p50": round(sorted(steps)[len(steps) // 2]) if steps else None,
                  "relay_p99_ms": float(late[-1][1]) if late else None, "void": not late or "VOID" in relay}))
PY
}

echo "rcy: ${RTT} ms, ${RATE} kbit, N $N, $FRAMES × $FRAME_BYTES B"
n=${#ARM_LIST[@]}
for round in $(seq "$ROUNDS"); do
  if [[ -n ${LOCK:-} ]]; then exec 9> "$LOCK"; flock 9; fi
  PREV=first
  for k in $(python3 lab/scripts/order.py row "$n" "$round"); do
    one "$round" "${ARM_LIST[$k]}" "$PREV"
    PREV="${ARM_LIST[$k]}"
  done
  if [[ -n ${LOCK:-} ]]; then exec 9>&-; fi
done | tee "$T/rows.jsonl"

python3 - "$T/rows.jsonl" "$FRAMES" "${ARM_LIST[@]}" <<'PY'
import collections, json, statistics, sys
sys.path.insert(0, "lab/scripts")
from order import leads_by_predecessor
rows = [json.loads(l) for l in open(sys.argv[1])]
frames = int(sys.argv[2])
names = sys.argv[3:]
void = [r for r in rows if r["void"]]
rows = [r for r in rows if not r["void"]]
by = collections.defaultdict(dict)
for r in rows:
    by[r["arm"]][r["round"]] = r
med = lambda xs: statistics.median(xs) if xs else float("nan")
ref = "none" if "none" in names else names[0]
print(f"\nfill ms median [min-max]; paired lead over {ref}, rounds it beat {ref} in; gap at each swap ms; bit-exact")
for arm in names:
    rs = by[arm]
    ms = sorted(r["ms"] for r in rs.values() if r["ms"] is not None)
    lead = [r["ms"] - by[ref][k]["ms"] for k, r in rs.items() if k in by[ref] and r["ms"] and by[ref][k]["ms"]]
    won = sum(1 for d in lead if d < 0)
    gaps = [g for r in rs.values() for g in r["gaps"]]
    bad = sum(1 for r in rs.values() if r["delivered"] != frames or r["failures"])
    exact = sum(r["exact"] for r in rs.values())
    print(f"{arm:10} {med(ms):8.0f} [{(ms or [0])[0]:.0f}-{(ms or [0])[-1]:.0f}]  {med(lead):+8.0f} {won}/{len(lead)}"
          f"  swaps {sum(r['resumes'] + r['recycles'] for r in rs.values())}"
          f"  gap {med(gaps):6.0f} [{min(gaps or [0])}-{max(gaps or [0])}]  frame step {med([r['step_p50'] for r in rs.values()]):4.0f}"
          f"  exact {exact}/{frames * len(rs)}" + (f"  INCOMPLETE {bad}" if bad else "") + f"  n={len(rs)}")
print(f"VOID, dropped: {len(void)}" + "".join(f" · round {r['round']} {r['arm']}" for r in void))
print("\nms, each lead by the predecessor it ran after, rounds in brackets")
split = [{"round": r["round"], "unit": r["arm"], "prev": None if r["prev"] == "first" else r["prev"], "v": r["ms"]} for r in rows]
for line in leads_by_predecessor(split, names, [(n, ref) for n in names if n != ref]):
    print(line)
PY
