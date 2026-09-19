#!/usr/bin/env bash
# L20: what a study nobody has read costs — one ask on an idle session, and a whole fill, each
# on its own, cold against warm, interleaved in a real browser. docs/disk-access/EVIDENCE.md.
#
#   ROUNDS=6 FRAMES=120 lab/scripts/cold_study.sh
#
# Cold is forced through the store's own lever (`--force-pool-reads`), not by evicting the page
# cache, which CLAUDE.md#measurement rules out. Each run prints the server's own miss count, so
# a cold arm that was not actually cold is visible rather than assumed.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

if ! node -e 'require("playwright")' 2>/dev/null; then
  export NODE_PATH="${NODE_PATH:-$(npm root -g 2>/dev/null || true)}"
  if ! node -e 'require("playwright")' 2>/dev/null; then
    echo "SKIPPED: cold study — playwright is not installed (npm install -g playwright)"
    exit 0
  fi
fi
CHROME="$(node -e 'console.log(process.env.CHROME_PATH || require("playwright").chromium.executablePath())' 2>/dev/null || true)"
[[ -x "$CHROME" ]] || { echo "SKIPPED: cold study — no headless Chromium (set CHROME_PATH)"; exit 0; }
export CHROME_PATH="$CHROME"

ROUNDS="${ROUNDS:-6}"
FRAMES="${FRAMES:-120}"
cargo build -q -p exact-server -p pack-study
BIN="${CARGO_TARGET_DIR:-target}/debug"
T="$(mktemp -d)"
SERVER=""
STATIC=""
CFG="$ROOT/client/dev-transport.json"
if [[ -f "$CFG" ]]; then cp "$CFG" "$T/dev-transport.bak"; fi
restore() {
  kill "$SERVER" "$STATIC" 2>/dev/null || true
  if [[ -f "$T/dev-transport.bak" ]]; then cp "$T/dev-transport.bak" "$CFG"; fi
  rm -rf "$T"
}
trap restore EXIT

openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -keyout "$T/key.pem" -out "$T/cert.pem" \
  -days 2 -nodes -subj '/CN=localhost' -addext 'basicConstraints=critical,CA:FALSE' \
  -addext 'keyUsage=critical,digitalSignature' -addext 'extendedKeyUsage=serverAuth' \
  -addext 'subjectAltName=DNS:localhost,IP:127.0.0.1' 2>/dev/null
HASH="$(openssl x509 -in "$T/cert.pem" -outform DER | openssl dgst -sha256 | awk '{print $2}')"

mkdir -p "$T/frames"
for i in $(seq 0 $((FRAMES - 1))); do head -c 262144 /dev/urandom > "$T/frames/$(printf '%03d' "$i").htj2k"; done
echo "{\"frameCount\": $FRAMES}" > "$T/metadata.json"
"$BIN/pack-study" --metadata "$T/metadata.json" --frames "$T/frames" --output "$T/study.sbnd" >/dev/null

WT_PORT=$((30000 + RANDOM % 20000))
PORT=$((20000 + RANDOM % 10000))
printf '{"wt_url": "https://127.0.0.1:%s/", "cert_sha256": "%s"}\n' "$WT_PORT" "$HASH" > "$CFG"
python3 server/dev-server.py --port "$PORT" >"$T/static.log" 2>&1 &
STATIC=$!
for _ in $(seq 50); do curl -sf "http://127.0.0.1:$PORT/harness/ts.html" >/dev/null 2>&1 && break; sleep 0.1; done

# One measurement: start the server in this arm, drive one page, stop it. The page cache is the
# kernel's and outlives the process, so restarting between arms does not reset what warm means.
run_one() {
  local arm=$1 scenario=$2 log="$T/srv.log" flag=()
  if [[ "$arm" == cold ]]; then flag=(--force-pool-reads); fi
  RUST_LOG=exact_server=info "$BIN/exact-server" --port "$WT_PORT" --study "$T/study.sbnd" \
    --cert-pem "$T/cert.pem" --key-pem "$T/key.pem" "${flag[@]}" >"$log" 2>&1 &
  SERVER=$!
  for _ in $(seq 100); do grep -q "wt_url=" "$log" 2>/dev/null && break; sleep 0.1; done
  # frames= overrides /study/metadata, which the static host answers from fixtures/ and not
  # from the study this server was given.
  local url="http://127.0.0.1:$PORT/harness/ts.html?autorun=1&frames=$FRAMES"
  case "$scenario" in
    ask)  url="$url&cell=ondemand&n=1&d=1" ;;
    fill) url="$url&cell=fill&n=$FRAMES" ;;
  esac
  local out
  out="$(node lab/scripts/chrome_harness.cjs "$url" 120000 2>/dev/null || true)"
  for _ in $(seq 30); do grep -q "session reads" "$log" && break; sleep 0.1; done
  kill "$SERVER" 2>/dev/null || true
  wait "$SERVER" 2>/dev/null || true
  SERVER=""
  local wall misses
  wall="$(sed -n 's/.*run_end \({.*}\).*/\1/p' <<<"$out" | tail -1 |
    python3 -c 'import json,sys; d=sys.stdin.read().strip(); print(json.loads(d)["wall_ms"] if d else "")' 2>/dev/null || true)"
  # The server's line is ANSI-coloured, so strip CSI before reading a field off it.
  misses="$(sed -r 's/\x1b\[[0-9;]*m//g' "$log" | grep -oE '\bmisses=[0-9]+' | tail -1 | cut -d= -f2 || true)"
  printf '%s\t%s\t%s\t%s\n' "$arm" "$scenario" "${wall:-NA}" "${misses:-NA}"
}

: > "$T/rows.tsv"
for r in $(seq 1 "$ROUNDS"); do
  for scenario in ask fill; do
    # Arm order reversed every round — CLAUDE.md#measurement.
    if (( r % 2 )); then order=(warm cold); else order=(cold warm); fi
    for arm in "${order[@]}"; do run_one "$arm" "$scenario" >> "$T/rows.tsv"; done
  done
  echo "round $r/$ROUNDS done" >&2
done

python3 - "$T/rows.tsv" <<'PY'
import sys, statistics as st
rows = [l.split('\t') for l in open(sys.argv[1]).read().splitlines() if l]
data = {}
for arm, scen, wall, miss in rows:
    if wall == 'NA':
        continue
    data.setdefault((scen, arm), []).append((float(wall), miss))
print(f"\n{'scenario':9} {'arm':5} {'n':>3} {'wall ms median':>15} {'[min … max]':>18}  misses")
for scen in ('ask', 'fill'):
    for arm in ('warm', 'cold'):
        v = data.get((scen, arm), [])
        if not v:
            continue
        w = [x[0] for x in v]
        miss = {x[1] for x in v}
        print(f"{scen:9} {arm:5} {len(w):>3} {st.median(w):>15.1f} "
              f"{f'[{min(w):.0f} … {max(w):.0f}]':>18}  {','.join(sorted(miss))}")
    a = [x[0] for x in data.get((scen, 'warm'), [])]
    b = [x[0] for x in data.get((scen, 'cold'), [])]
    if a and b:
        pairs = list(zip(a, b))
        worse = sum(1 for x, y in pairs if y > x)
        print(f"{'':9} cold is {st.median(b) / st.median(a):.2f}x warm, "
              f"slower in {worse} of {len(pairs)} paired rounds\n")
PY
