#!/usr/bin/env bash
# README §Demo's phone block for a laptop without installs, in a network namespace: netns `phone` stands in for the
# phone, a veth pair for the tether; no adb. The certificate is made by openssl in a container (docker here, podman on
# the laptop), the hash read with jq, the page bound to the laptop's address and opened there by Chromium with
# "Insecure origins treated as secure". usage: run.sh REPO ID [FLAG|noflag]
set -euo pipefail
REPO=$1 ID=$2 ARM=${3:-flag} H=$(cd "$(dirname "$0")" && pwd)
cleanup() { kill $(jobs -p) 2>/dev/null || true; ip netns del phone 2>/dev/null || true; ip link del lap0 2>/dev/null || true; }
trap cleanup EXIT; cleanup
ip netns add phone
ip link add lap0 type veth peer name ph0
ip link set ph0 netns phone
ip addr add 10.77.0.1/24 dev lap0 && ip link set lap0 up
ip netns exec phone ip addr add 10.77.0.2/24 dev ph0
ip netns exec phone ip link set ph0 up && ip netns exec phone ip link set lo up
cd "$REPO"
# README's commands from here, with LAPTOP_IP as target/phone.env would hold it
LAPTOP_IP=10.77.0.1; EXACT=${ID%%-*}
OPENSSL="docker run --rm -i --network none -v $PWD/server/dev-cert:$PWD/server/dev-cert:z rust:1 openssl"
mkdir -p server/dev-cert target
OPENSSL="$OPENSSL" ./server/scripts/gen_dev_cert.sh --if-needed >/dev/null
HASH=$(jq -r .cert_sha256 client/dev-transport.json)
for p in 4433 4434; do
  printf '{"wt_url": "https://%s:%s/", "cert_sha256": "%s"}\n' "$LAPTOP_IP" "$p" "$HASH" > target/phone-transport-$p.json
done
target/release/series-server --port 4433 --series demo-series/$ID.sbnd \
  --cert-pem server/dev-cert/cert.pem --key-pem server/dev-cert/key.pem > "$H/s4433.log" 2>&1 &
target/release/series-server --port 4434 --series demo-series/$EXACT.sbnd \
  --cert-pem server/dev-cert/cert.pem --key-pem server/dev-cert/key.pem > "$H/s4434.log" 2>&1 &
python3 server/dev-server.py --bind "$LAPTOP_IP" --port 8765 --metadata demo-series/$ID.metadata.json \
  --transport target/phone-transport-4433.json \
  --exact-metadata demo-series/$EXACT.metadata.json --exact-transport target/phone-transport-4434.json > "$H/dev.log" 2>&1 &
sleep 2
head -1 "$H/dev.log"
ip netns exec phone curl -s -o /dev/null -w 'page at the laptop address from the phone: %{http_code}\n' --max-time 2 "http://$LAPTOP_IP:8765/" || true
curl -s -o /dev/null -w 'laptop loopback 8765: %{http_code}\n' --max-time 2 http://127.0.0.1:8765/ || echo "laptop loopback 8765: not served (bound to $LAPTOP_IP alone)"
ip netns exec phone env URL="http://$LAPTOP_IP:8765" ARM="$ARM" NODE_PATH="$(npm root -g)" node "$H/page.mjs"
sleep 1; kill $(jobs -p) 2>/dev/null; sleep 1
echo "--- 4433:"; grep -E 'session' "$H/s4433.log" | tail -2
echo "--- 4434:"; grep -E 'session' "$H/s4434.log" | tail -2
