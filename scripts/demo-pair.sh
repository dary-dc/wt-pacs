#!/usr/bin/env bash
# README §Demo's pair, from any state: the certificate first, then the optimal-quality series on 4433, its exact series
# on 4434 and the static host on 8765, until Ctrl-C or until one of them stops. client/viewer/demo-check.mjs runs it too.
#   scripts/demo-pair.sh DIR ID      DIR as scripts/demo-series.sh wrote it; ID an optimal-quality series in it
#   DIAL=ADDR             the address the page dials both servers at (default 127.0.0.1); a phone's: the laptop's
#   DIAL_PORTS="P Q"      the ports it dials them at (default "4433 4434"), when a relay stands between
#   BIND=ADDR             the static host's address (default 127.0.0.1), the laptop's toward a phone without adb
#   OPENSSL=...           as server/scripts/gen_dev_cert.sh takes it
set -euo pipefail
cd "$(dirname "$0")/.."
DIR=${1:?usage: scripts/demo-pair.sh DIR ID}
ID=${2:?usage: scripts/demo-pair.sh DIR ID}
EXACT=$(python3 -c 'import json, sys; print(json.load(open(sys.argv[1]))["exactSeries"])' "$DIR/$ID.metadata.json")
read -r TO_LOSSY TO_EXACT <<<"${DIAL_PORTS:-4433 4434}"
SERVER="${CARGO_TARGET_DIR:-target}/release/series-server"
[[ -x "$SERVER" ]] || { echo "no $SERVER: cargo build --release -p series-server" >&2; exit 1; }
for f in "$DIR/$ID.sbnd" "$DIR/$EXACT.sbnd" "$DIR/$EXACT.metadata.json"; do [[ -f "$f" ]] || { echo "no $f" >&2; exit 1; }; done

pkill -f 'release/series-server --port 443[34] ' || true
pkill -f 'server/dev-server.py --port 8765 ' || true
./server/scripts/gen_dev_cert.sh --if-needed
RUN=target/demo-pair
mkdir -p "$RUN"
python3 - "$RUN" "${DIAL:-127.0.0.1}" "$TO_LOSSY" "$TO_EXACT" <<'PY'
import json, sys
run, dial, *ports = sys.argv[1:]
cert = json.load(open("client/dev-transport.json"))["cert_sha256"]
for name, port in zip(("lossy", "exact"), ports):
    json.dump({"wt_url": f"https://{dial}:{port}/", "cert_sha256": cert}, open(f"{run}/{name}-transport.json", "w"))
PY

trap 'trap - EXIT; kill $(jobs -p) 2>/dev/null; wait' EXIT INT TERM
cert=(--cert-pem server/dev-cert/cert.pem --key-pem server/dev-cert/key.pem)
"$SERVER" --port 4433 --series "$DIR/$ID.sbnd" "${cert[@]}" >"$RUN/lossy.log" 2>&1 &
"$SERVER" --port 4434 --series "$DIR/$EXACT.sbnd" "${cert[@]}" >"$RUN/exact.log" 2>&1 &
python3 server/dev-server.py --port 8765 --bind "${BIND:-127.0.0.1}" --metadata "$DIR/$ID.metadata.json" \
  --transport "$RUN/lossy-transport.json" \
  --exact-metadata "$DIR/$EXACT.metadata.json" --exact-transport "$RUN/exact-transport.json" >"$RUN/host.log" 2>&1 &
until grep -q transport= "$RUN/lossy.log" && grep -q transport= "$RUN/exact.log" && grep -q port=8765 "$RUN/host.log"; do
  [[ $(jobs -pr | wc -l) -eq 3 ]] || { tail -n 5 "$RUN"/*.log >&2; exit 1; }
  sleep 0.1
done
echo "demo pair ready: $ID and $EXACT, the page at http://${BIND:-127.0.0.1}:8765/?overlay=1 (logs in $RUN/)"
wait -n
tail -n 5 "$RUN"/*.log >&2
exit 1
