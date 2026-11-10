#!/usr/bin/env bash
# The phone-section pair check: netns `phone` stands in for the phone, a veth pair for the tether, a socat tunnel
# over a unix socket for `adb reverse`. usage: run.sh MIX PAIRDIR (PAIRDIR holds lossy.sbnd lossy.json exact.sbnd exact.json)
set -euo pipefail
MIX=$1 PAIR=$2 H=$(cd "$(dirname "$0")" && pwd)
cleanup() { kill $(jobs -p) 2>/dev/null || true; ip netns del phone 2>/dev/null || true; ip link del lap0 2>/dev/null || true; rm -f "$H/adb.sock"; }
trap cleanup EXIT; cleanup
ip netns add phone
ip link add lap0 type veth peer name ph0
ip link set ph0 netns phone
ip addr add 10.77.0.1/24 dev lap0 && ip link set lap0 up
ip netns exec phone ip addr add 10.77.0.2/24 dev ph0
ip netns exec phone ip link set ph0 up && ip netns exec phone ip link set lo up
LAPTOP_IP=10.77.0.1
cd "$MIX"
./server/scripts/gen_dev_cert.sh --if-needed >/dev/null
HASH=$(openssl x509 -in server/dev-cert/cert.pem -outform DER | openssl dgst -sha256 | awk '{print $2}')
mkdir -p target
for p in 4433 4434; do
  printf '{"wt_url": "https://%s:%s/", "cert_sha256": "%s"}\n' "$LAPTOP_IP" "$p" "$HASH" > target/phone-transport-$p.json
done
target/release/series-server --port 4433 --series "$PAIR/lossy.sbnd" --cert-pem server/dev-cert/cert.pem --key-pem server/dev-cert/key.pem > "$H/s4433.log" 2>&1 &
target/release/series-server --port 4434 --series "$PAIR/exact.sbnd" --cert-pem server/dev-cert/cert.pem --key-pem server/dev-cert/key.pem > "$H/s4434.log" 2>&1 &
python3 server/dev-server.py --port 8765 --metadata "$PAIR/lossy.json" --transport target/phone-transport-4433.json \
  --exact-metadata "$PAIR/exact.json" --exact-transport target/phone-transport-4434.json > "$H/dev.log" 2>&1 &
sleep 2
socat UNIX-LISTEN:"$H/adb.sock",fork TCP:127.0.0.1:8765 &
sleep 0.5
ip netns exec phone socat TCP-LISTEN:8765,bind=127.0.0.1,fork,reuseaddr UNIX-CONNECT:"$H/adb.sock" &
sleep 0.5
ip netns exec phone curl -sf -o /dev/null -w 'page over the tunnel: %{http_code}\n' http://127.0.0.1:8765/
ip netns exec phone curl -s -o /dev/null -w 'laptop loopback from phone: %{http_code}\n' --max-time 2 http://10.77.0.1:8765/ || echo "laptop's 8765 not reachable from the phone's namespace (as intended)"
ip netns exec phone node "$H/page.mjs"
sleep 1; kill $(jobs -p) 2>/dev/null; sleep 1
echo "--- 4433:"; grep -E 'session' "$H/s4433.log" | tail -3
echo "--- 4434:"; grep -E 'session' "$H/s4434.log" | tail -3
