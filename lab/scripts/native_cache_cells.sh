#!/usr/bin/env bash
# M3 CACHE's three cells, docs/native/README.md §6: a 61 MB series reopened from native-fill's cache against
# fetched through the relay (arms in a Williams order each round), a writer killed at random points during 100
# writes, and a byte flipped in a cached frame refused on read and fetched again. Needs ingest/tools.sh's build.
#   lab/scripts/native_cache_cells.sh [rounds]   [RATE=20000] [RTT=40] [KILLS=100] [FRAMES=87]
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
ROUNDS="${1:-7}"
RATE="${RATE:-20000}"
RTT="${RTT:-40}"
KILLS="${KILLS:-100}"
FRAMES="${FRAMES:-87}"
BUILD="${INGEST_BUILD:-$ROOT/ingest/.build}"
NUMPY_PY="${NUMPY_PY:-/usr/bin/python3}"
T="$(mktemp -d)"
PIDS=()
trap 'kill "${PIDS[@]}" 2>/dev/null || true; rm -rf "$T"' EXIT

cargo build -q --release -p series-server -p pack-series
cargo build -q --release -p native-client --features decode

# 768×920, 12 bits, the `ct` content: about 700 KB a codestream, so 87 frames are the 61 MB series.
export LD_LIBRARY_PATH="$BUILD/openjph/lib"
mkdir -p "$T/frames"
for ((i = 0; i < FRAMES; i++)); do
  "$NUMPY_PY" lab/scripts/gen_frame_pnm.py "$T/f.pgm" 768 920 1 4095 "$i" "$FRAMES" ct
  "$BUILD/openjph/bin/ojph_compress" -i "$T/f.pgm" -o "$T/f.j2c" \
    -num_decomps 5 -block_size "{64,64}" -prog_order RPCL -reversible true > /dev/null
  mv "$T/f.j2c" "$(printf '%s/frames/%03d.htj2k' "$T" "$i")"
  "$NUMPY_PY" -c '
import sys, numpy, xxhash
raw = open(sys.argv[1], "rb").read()
samples = numpy.frombuffer(raw[len(raw) - 768 * 920 * 2:], ">u2").astype("<u2")
print(xxhash.xxh3_64_hexdigest(samples.tobytes()))' "$T/f.pgm" >> "$T/digests"
done
"$NUMPY_PY" -c '
import json, sys
print(json.dumps({"frameCount": int(sys.argv[1]), "digests": {"algorithm": "xxh3-64", "frames": open(sys.argv[2]).read().split()}}))' \
  "$FRAMES" "$T/digests" > "$T/metadata.json"
target/release/pack-series --metadata "$T/metadata.json" --frames "$T/frames" --output "$T/series.sbnd" > /dev/null
echo "series: $FRAMES frames, $(stat -c %s "$T/series.sbnd") bytes"

openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -keyout "$T/key.pem" -out "$T/cert.pem" \
  -days 2 -nodes -subj '/CN=localhost' -addext 'basicConstraints=critical,CA:FALSE' \
  -addext 'keyUsage=critical,digitalSignature' -addext 'extendedKeyUsage=serverAuth' \
  -addext 'subjectAltName=DNS:localhost,IP:127.0.0.1' 2>/dev/null
HASH="$(openssl x509 -in "$T/cert.pem" -outform DER | openssl dgst -sha256 | awk '{print $2}')"
SRV=$((30000 + RANDOM % 5000))
target/release/series-server --port "$SRV" --bind 127.0.0.1 --series "$T/series.sbnd" \
  --cert-pem "$T/cert.pem" --key-pem "$T/key.pem" > "$T/server.log" 2>&1 &
PIDS+=("$!")
for _ in $(seq 100); do grep -q "wt_url=" "$T/server.log" && break; sleep 0.1; done

fill() {  # cache-dir log [native-fill args]; through a fresh relay, the cache's key fixed
  local in=$((35000 + RANDOM % 5000)) cache=$1 log=$2
  shift 2
  python3 lab/scripts/link_impair.py --udp "$in:$SRV" --delay-ms "$((RTT / 2))" --rate-kbit "$RATE" \
    --queue-pkts 200 --self-timing > "$T/relay.log" 2>&1 &
  local relay=$!
  sleep 1
  target/release/native-fill --url "https://127.0.0.1:$in/" --cert-sha256 "$HASH" --bundle "$T/series.sbnd" \
    --fill "0-$((FRAMES - 1))" --cache "$cache" --series m3 --version 1 "$@" > "$log"
  kill "$relay" 2>/dev/null || true
  wait "$relay" 2>/dev/null || true
  grep -q "VOID" "$T/relay.log" && echo "void: the relay left packets late" || true
}

row() {  # log arm round
  python3 - "$@" <<'PY'
import re, sys
log = open(sys.argv[1]).read()
sources = re.findall(r"source=(\w+) identical=(\w+) .*?exact=(\w+)", log)
total = re.search(r"total bytes=(\d+) ms=([\d.]+) failed=(\d+)", log)
print(f"round={sys.argv[3]} arm={sys.argv[2]} ms={float(total[2]):.0f} bytes={total[1]} failed={total[3]}"
      f" from_cache={sum(s == 'cache' for s, _, _ in sources)} from_server={sum(s == 'server' for s, _, _ in sources)}"
      f" identical_and_true={sum(i == 'true' and e == 'true' for _, i, e in sources)}")
PY
}

echo "cell 1: reopen from the cache against the relay at $RATE kbit, $RTT ms RTT, $ROUNDS rounds"
fill "$T/warm" "$T/log" && row "$T/log" fill-warm 0
ARMS=(relay cache)
for round in $(seq "$ROUNDS"); do
  for k in $(python3 lab/scripts/order.py row 2 "$round"); do
    case "${ARMS[$k]}" in
      relay) rm -rf "$T/cold"; fill "$T/cold" "$T/log" ;;
      cache) fill "$T/warm" "$T/log" ;;
    esac
    row "$T/log" "${ARMS[$k]}" "$round"
  done
done

echo "cell 2: a writer killed at random points during 100 writes, $KILLS kills"
NATIVE_CACHE_KILLS="$KILLS" cargo test -q --release -p native-client cache::tests::a_killed_writer -- --nocapture 2>&1 \
  | grep -E "^kills=|test result"

echo "cell 3: a byte flipped in a cached frame, $ROUNDS rounds"
for round in $(seq "$ROUNDS"); do
  frame=$((RANDOM % FRAMES))
  file="$T/warm/m3/1/$frame"
  at=$((RANDOM * 32768 + RANDOM))
  at=$((at % $(stat -c %s "$file")))
  "$NUMPY_PY" -c 'import sys; f = open(sys.argv[1], "r+b"); f.seek(int(sys.argv[2])); b = f.read(1); f.seek(int(sys.argv[2])); f.write(bytes([b[0] ^ 0x01]))' "$file" "$at"
  fill "$T/warm" "$T/log"
  printf 'round=%s frame=%s byte=%s refetched=%s ' "$round" "$frame" "$at" \
    "$(grep -c "^frame=$frame .*source=server identical=true .*exact=true" "$T/log")"
  fill "$T/warm" "$T/log2"
  row "$T/log2" after-flip "$round"
done
