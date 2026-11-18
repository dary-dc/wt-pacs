#!/usr/bin/env bash
# The phone run's load 6, simulated: a fill under 7 % loss, then a blackout on the link with `l` pressed in it,
# the client as proposed (`retry`) against the re-asks off (`off`), interleaved.
# docs/reviews/lossless-under-loss.md §Reproduced on a simulated link
#   lab/lossless-under-loss/run.sh [rounds] [blackout ms]
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
ROUNDS="${1:-3}"
BLACKOUT="${2:-50000}"
FRAMES=50
KB=460
T="$(mktemp -d)"
PIDS=()
cleanup() { for p in "${PIDS[@]:-}"; do kill "$p" 2>/dev/null || true; done; rm -rf "$T"; }
trap cleanup EXIT

cargo build -q -p series-server -p pack-series
BIN="${CARGO_TARGET_DIR:-target}/debug"
openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -keyout "$T/key.pem" \
  -out "$T/cert.pem" -days 2 -nodes -subj '/CN=localhost' \
  -addext 'basicConstraints=critical,CA:FALSE' -addext 'keyUsage=critical,digitalSignature' \
  -addext 'extendedKeyUsage=serverAuth' -addext 'subjectAltName=DNS:localhost,IP:127.0.0.1' 2>/dev/null
HASH="$(openssl x509 -in "$T/cert.pem" -outform DER | openssl dgst -sha256 | awk '{print $2}')"

mkdir -p "$T/frames"
for i in $(seq -w 0 $((FRAMES - 1))); do head -c $((KB * 1024)) /dev/urandom > "$T/frames/0$i.htj2k"; done
echo "{\"frameCount\": $FRAMES}" > "$T/meta.json"
"$BIN/pack-series" --metadata "$T/meta.json" --frames "$T/frames" --output "$T/s.sbnd" >/dev/null

B=$((36000 + RANDOM % 1000))
FILL_SRV=$B EXACT_SRV=$((B + 1)) FILL_IN=$((B + 2)) EXACT_IN=$((B + 3)) CTRL=$((B + 4)) STATIC=$((B + 5))
for p in "$FILL_SRV" "$EXACT_SRV"; do
  "$BIN/series-server" --port "$p" --series "$T/s.sbnd" --cert-pem "$T/cert.pem" --key-pem "$T/key.pem" \
    --congestion bbr > "$T/srv-$p.log" 2>&1 &
  PIDS+=($!)
done
# A home Wi-Fi's round trip and rate, 7 % loss each way: the run's load 6 lost 7 % of the server's packets.
python3 lab/scripts/link_impair.py --udp "$FILL_IN:$FILL_SRV" --udp "$EXACT_IN:$EXACT_SRV" --delay-ms 5 \
  --rate-kbit 100000 --queue-pkts 200 --loss 7 --control-port "$CTRL" > "$T/impair.log" 2>&1 &
PIDS+=($!)
python3 server/dev-server.py --port "$STATIC" > "$T/static.log" 2>&1 &
PIDS+=($!)
sleep 2

VISIT_MS=$((BLACKOUT + 60000))
for r in $(seq "$ROUNDS"); do
  ARMS=(retry off)
  ((r % 2 == 0)) && ARMS=(off retry)
  for arm in "${ARMS[@]}"; do
    url="http://127.0.0.1:$STATIC/lab/lossless-under-loss/page.html?frames=$FRAMES&hash=$HASH&retry=$arm"
    url+="&fill=https://127.0.0.1:$FILL_IN/&exact=https://127.0.0.1:$EXACT_IN/"
    NODE_PATH="$(npm root -g)" node lab/lossless-under-loss/drive.mjs "$url" "$CTRL" "$BLACKOUT" "$VISIT_MS" |
      sed "s/^{/{\"round\":$r,\"arm\":\"$arm\",/"
  done
done
