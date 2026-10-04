#!/usr/bin/env bash
# O1 / S21: the sequential fill against a coarse-to-fine one, each frame asked exactly once.
# Two questions: when is every 8th frame in hand, and what does the permuted order cost the
# read path when every frame is a miss (`--force-pool-reads`).
# Results: docs/transport/transport-conclusions.md §3, the fill's order.
#
#   lab/scripts/fill_order_cells.sh [rounds]
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

ROUNDS="${1:-3}"
RTT="${RTT:-80}"
RATE="${RATE:-20000}"
FRAMES="${FRAMES:-200}"
KB="${KB:-64}"
DEPTH="${DEPTH:-4}"
T="$(mktemp -d)"
PIDS=()
cleanup() { for p in "${PIDS[@]:-}"; do kill "$p" 2>/dev/null || true; done; rm -rf "$T"; }
trap cleanup EXIT

cargo build -q -p exact-server -p pack-study -p window-harness
BIN="${CARGO_TARGET_DIR:-target}/debug"
openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -keyout "$T/key.pem" \
  -out "$T/cert.pem" -days 2 -nodes -subj '/CN=localhost' \
  -addext 'basicConstraints=critical,CA:FALSE' -addext 'keyUsage=critical,digitalSignature' \
  -addext 'extendedKeyUsage=serverAuth' -addext 'subjectAltName=DNS:localhost,IP:127.0.0.1' 2>/dev/null
mkdir -p "$T/frames"
for i in $(seq 0 $((FRAMES - 1))); do
  head -c $((KB * 1024)) /dev/urandom > "$T/frames/$(printf '%03d' "$i").htj2k"
done
echo "{\"frameCount\": $FRAMES}" > "$T/metadata.json"
"$BIN/pack-study" --metadata "$T/metadata.json" --frames "$T/frames" --output "$T/study.sbnd" >/dev/null

SRV=$((36000 + RANDOM % 2000))
IN=$((34000 + RANDOM % 2000))

head_row() { printf '\n== %s\n%-28s %10s %14s\n' "$1" "order" "fill ms" "every 8th ms"; }

# The read-path question is a few per cent either way, so it gets the interleaved treatment the
# repository's measurement rules ask for: one round of each, order reversed every round.
ab() {  # label [server args...]; RELAY_ARGS picks the link
  local label="$1"
  shift
  : > "$T/server.log"
  RUST_LOG=exact_server=warn "$BIN/exact-server" --port "$SRV" --study "$T/study.sbnd" \
    --cert-pem "$T/cert.pem" --key-pem "$T/key.pem" "$@" > "$T/server.log" 2>&1 &
  local srv=$!
  PIDS+=("$srv")
  for _ in $(seq 100); do grep -q "wt_url=" "$T/server.log" && break; sleep 0.1; done
  local relay="" port=$SRV
  if [[ -n "${RELAY_ARGS[*]:-}" ]]; then
    python3 lab/scripts/link_impair.py --udp "$IN:$SRV" "${RELAY_ARGS[@]}" > "$T/relay.log" 2>&1 &
    relay=$!
    PIDS+=("$relay")
    for _ in $(seq 50); do grep -q READY "$T/relay.log" && break; sleep 0.1; done
    port=$IN
  fi
  : > "$T/ab.tsv"
  local r arms arm line
  for r in $(seq 1 "${AB_ROUNDS:-$((ROUNDS * 4))}"); do
    if (( r % 2 )); then arms=(sequential coarse); else arms=(coarse sequential); fi
    for arm in "${arms[@]}"; do
      line=$(RUST_BACKTRACE=0 "$BIN/fill_order" --url "https://127.0.0.1:$port/" \
        --frames "$FRAMES" --depth "$DEPTH" --order "$arm" --rounds 1 2>&1) || continue
      printf '%s\t%s\t%s\n' "$arm" \
        "$(sed -n 's/.*fill_ms=\([0-9]*\).*/\1/p' <<<"$line")" \
        "$(sed -n 's/.*every_8th_ms=\([0-9]*\).*/\1/p' <<<"$line")" >> "$T/ab.tsv"
    done
  done
  [[ -n "$relay" ]] && kill -TERM "$relay" 2>/dev/null
  kill "$srv" 2>/dev/null || true
  sleep 0.3
  python3 - "$T/ab.tsv" "$label" <<'PY'
import statistics as st, sys
rows = [l.split("\t") for l in open(sys.argv[1]).read().splitlines() if l]
by = {}
for arm, fill, coarse in rows:
    by.setdefault(arm, []).append((float(fill), float(coarse)))
seq = st.median(v[0] for v in by.get("sequential", [(float('nan'),)*2]))
crs = st.median(v[0] for v in by.get("coarse", [(float('nan'),)*2]))
crs8 = st.median(v[1] for v in by.get("coarse", [(float('nan'),)*2]))
seq8 = st.median(v[1] for v in by.get("sequential", [(float('nan'),)*2]))
n = len(by.get("sequential", []))
print("%-28s %10.0f %14.0f   n=%d" % (sys.argv[2] + ", sequential", seq, seq8, n))
print("%-28s %10.0f %14.0f   %+.1f %% on the fill" % (sys.argv[2] + ", coarse", crs, crs8,
                                                      100 * (crs - seq) / seq))
PY
}

echo "study $((FRAMES * KB / 1024)) MB in $FRAMES frames of ${KB} KB, depth $DEPTH"

RELAY_ARGS=(--delay-ms $((RTT / 2)) --rate-kbit "$RATE")
head_row "on the link: ${RTT} ms round trip, ${RATE} kbit"
AB_ROUNDS=$ROUNDS ab "link"

RELAY_ARGS=()
head_row "on loopback, every frame a miss (--force-pool-reads)"
ab "misses" --force-pool-reads

head_row "on loopback, warm store"
ab "warm"
