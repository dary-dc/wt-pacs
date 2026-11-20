#!/usr/bin/env bash
# Claim: scripts/demo-pair.sh serves a pair whole: the page's two transport files name the dialled address and each
# server's port, the static host serves both series' metadata, and stopping the starter stops all three servers.
set -euo pipefail
cd "$(dirname "$0")/.."
cargo build -q --release -p series-server
T="$(mktemp -d)"
trap 'kill "${pair:-}" 2>/dev/null || true; rm -rf "$T"' EXIT
cp fixtures/us_cine_smoke/us_cine_smoke.sbnd "$T/smoke.sbnd"
cp fixtures/us_cine_smoke/us_cine_smoke.sbnd "$T/smoke-q8.sbnd"
echo '{"frameCount": 3, "seriesLabel": "exact"}' >"$T/smoke.metadata.json"
echo '{"frameCount": 3, "seriesLabel": "lossy", "exactSeries": "smoke"}' >"$T/smoke-q8.metadata.json"

DIAL=10.9.8.7 DIAL_PORTS="5433 5434" scripts/demo-pair.sh "$T" smoke-q8 >"$T/out" 2>&1 &
pair=$!
for _ in $(seq 300); do grep -q 'demo pair ready' "$T/out" && break; kill -0 $pair 2>/dev/null || break; sleep 0.1; done
grep -q 'demo pair ready' "$T/out" || { cat "$T/out"; echo "FAIL: the pair did not come up"; exit 1; }
get() { python3 -c 'import sys, urllib.request; print(urllib.request.urlopen("http://127.0.0.1:8765" + sys.argv[1]).read().decode())' "$1"; }
fails=0
expect() { [[ "$2" == *"$3"* ]] || { echo "FAIL: $1: $2"; fails=$((fails + 1)); }; }
expect "the page's transport file" "$(get /wt/dev-transport.json)" '"wt_url": "https://10.9.8.7:5433/"'
expect "the exact series' transport file" "$(get /wt/smoke/dev-transport.json)" '"wt_url": "https://10.9.8.7:5434/"'
expect "the metadata" "$(get /series/metadata)" '"lossy"'
expect "the exact series' metadata" "$(get /series/smoke/metadata)" '"exact"'
expect "the optimal-quality server" "$(pgrep -af 'series-server --port 4433 ')" "$T/smoke-q8.sbnd"
expect "the exact server" "$(pgrep -af 'series-server --port 4434 ')" "$T/smoke.sbnd"

kill $pair
wait $pair 2>/dev/null || true
sleep 0.5
left=$(pgrep -af "$T/" || true)
[[ -z "$left" ]] || { echo "FAIL: left running after the starter stopped: $left"; fails=$((fails + 1)); }
[[ $fails -eq 0 ]] || exit 1
echo "ok: the pair served whole, each transport file naming its server, and stopped with its starter"
