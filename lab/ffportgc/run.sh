#!/usr/bin/env bash
# Whole fills of a 240-frame series through the downloader in a stock headless Firefox, each visit its own
# server and static host; prints one line a visit. lab/ffportgc/README.md
#   FIREFOX_PATH=... [FOLLOW=1] [RELAY="--rate-kbit 50000 --delay-ms 20"] lab/ffportgc/run.sh SERIES_DIR VISITS
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
DIR="${1:?series dir: NNN.htj2k, NNN.sha256, metadata.json}"
VISITS="${2:-1}"
[[ -x "${FIREFOX_PATH:-}" ]] || { echo "set FIREFOX_PATH to a Firefox binary" >&2; exit 2; }
T="$(mktemp -d)"
trap 'kill "${SRV:-}" "${STATIC:-}" "${LINK:-}" 2>/dev/null || true; rm -rf "$T"' EXIT
openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -keyout "$T/key.pem" -out "$T/cert.pem" -days 2 \
  -nodes -subj /CN=localhost -addext subjectAltName=DNS:localhost,IP:127.0.0.1 2>/dev/null
N=$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['frameCount'])" "$DIR/metadata.json")
[[ -f "$DIR/series.sbnd" ]] || target/release/pack-series --metadata "$DIR/metadata.json" --frames "$DIR" --output "$DIR/series.sbnd"
for ((v = 0; v < VISITS; v++)); do
  P=$(python3 -c "import socket; s=socket.socket(socket.AF_INET, socket.SOCK_DGRAM); s.bind((\"127.0.0.1\", 0)); print(s.getsockname()[1])")
  target/release/series-server --port "$P" --bind 127.0.0.1 --series "$DIR/series.sbnd" --cert-pem "$T/cert.pem" \
    --key-pem "$T/key.pem" >"$T/server.log" 2>&1 &
  SRV=$!
  until grep -q '^transport=' "$T/server.log"; do sleep 0.1; done
  url=$(sed -n 's/^wt_url=\([^ ]*\).*/\1/p' "$T/server.log")
  if [[ -n "${RELAY:-}" ]]; then
    R=$((P + 1))
    # shellcheck disable=SC2086
    python3 lab/scripts/link_impair.py --udp "$R:$P" $RELAY >"$T/relay.log" 2>&1 &
    LINK=$!
    until grep -q READY "$T/relay.log"; do sleep 0.1; done
    url="https://127.0.0.1:$R/"
  fi
  hash=$(sed -n 's/.*cert_sha256=\([0-9a-f]*\).*/\1/p' "$T/server.log")
  printf '{"wt_url": "%s", "cert_sha256": "%s"}\n' "$url" "$hash" >"$T/transport.json"
  python3 server/dev-server.py --port 0 --transport "$T/transport.json" >"$T/static.log" 2>&1 &
  STATIC=$!
  until grep -q '^port=' "$T/static.log"; do sleep 0.1; done
  PORT=$(sed -n 's/^port=\([0-9]*\).*/\1/p' "$T/static.log")
  node client/contract/drive_firefox.mjs "http://127.0.0.1:$PORT/lab/ffportgc/index.html?n=$N&follow=${FOLLOW:-0}&dir=/${DIR#"$ROOT"/}" 180000 || true
  kill "$SRV" "$STATIC" ${LINK:+"$LINK"}
  wait "$SRV" "$STATIC" ${LINK:+"$LINK"} 2>/dev/null || true
  LINK=""
done
