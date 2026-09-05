#!/usr/bin/env bash
# Inner half of quic_opt_shaped.sh — runs inside `unshare --net`, where `lo` is private.
# Everything it needs arrives in the environment; see the outer script.
set -euo pipefail
export PATH="$PATH:/usr/sbin"

ip link set lo up
tc qdisc replace dev lo root tbf rate "$RATE" burst 256kb latency 50ms
tc qdisc show dev lo | grep -q tbf || { echo "shaping not applied" >&2; exit 1; }

STUDY="$ROOT/lab/fixtures/$FIXTURE/$FIXTURE.sbnd"
FRAME_COUNT=$(python3 -c "import json,os;print(json.load(open(os.environ['ROOT']+'/lab/fixtures/'+os.environ['FIXTURE']+'/metadata.json'))['frameCount'])")
read -r -a FLAGS <<< "$SRV_FLAGS"
TICK=$(getconf CLK_TCK)

cpu_of() { awk -v t="$TICK" '{print ($14+$15)/t}' /proc/"$1"/stat 2>/dev/null || echo 0; }
rss_of() { awk '/VmRSS/{print $2}' /proc/"$1"/status 2>/dev/null || echo 0; }

for D in ${DEPTHS//,/ }; do
  for RUN in $(seq 1 "$REPEATS"); do
    "$SERVER_BIN" --port "$PORT" --study "$STUDY" --stream-mode "$STREAM_MODE" --bind 127.0.0.1 \
      "${FLAGS[@]}" --cert-pem "$ROOT/server/dev-cert/cert.pem" --key-pem "$ROOT/server/dev-cert/key.pem" \
      > /tmp/quic_opt_shaped_server.log 2>&1 &
    SRV=$!
    for _ in $(seq 1 50); do grep -q '^wt_url=' /tmp/quic_opt_shaped_server.log && break; sleep 0.1; done
    kill -0 "$SRV" 2>/dev/null || { tail -3 /tmp/quic_opt_shaped_server.log >&2; exit 1; }

    C0=$(cpu_of "$SRV")
    "$HARNESS" --url "https://127.0.0.1:$PORT/" --mode saturate --read-bps 0 --depth "$D" \
      --frame-count "$FRAME_COUNT" --fill-dwell-ms "$DWELL_MS" --stream-mode "$STREAM_MODE" \
      --bind 127.0.0.1 --arm "$ARM" --json > /tmp/quic_opt_shaped_run.json 2>/dev/null
    C1=$(cpu_of "$SRV")
    RSS=$(rss_of "$SRV")
    kill "$SRV" 2>/dev/null || true
    wait "$SRV" 2>/dev/null || true

    python3 "$ROOT/lab/scripts/quic_opt_row.py" "$ARM" "$FIXTURE" "$STREAM_MODE" "$RATE" \
      "$D" "$RUN" "$C0" "$C1" "$RSS" "$OUT" /tmp/quic_opt_shaped_run.json
  done
done
