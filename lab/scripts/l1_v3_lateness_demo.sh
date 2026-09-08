#!/usr/bin/env bash
# L1 v3 — why the decision metric moves to reader lateness. Two runs of one arm differing only
# in reader speed: miss_p95_wait_ms barely moves while the reader falls seconds behind, because
# it is timed from the ask, after the loop has slipped. late_p95_ms is timed from the schedule.
# Usage: bash lab/scripts/l1_v3_lateness_demo.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PORT="${PORT:-4433}"
HARNESS="${HARNESS:-$ROOT/target/release/window-harness}"
SERVER="${SERVER:-$ROOT/target/release/exact-server}"
STUDY="${STUDY:-$ROOT/lab/fixtures/frames_32k_160/frames_32k_160.sbnd}"
TRACE="${TRACE:-$ROOT/lab/traces/l1_one_way_160.json}"
DEPTH="${DEPTH:-4}"
FRAME_COUNT="${FRAME_COUNT:-160}"
READ_BPS="${READ_BPS:-10000000}"   # LinkPacer stands in for netem's 10 Mbit cap
CLINICAL_STEP_MS="${CLINICAL_STEP_MS:-31}"
STRESS_STEP_MS="${STRESS_STEP_MS:-15}"
MODE="${MODE:-shared}"

[[ -x "$HARNESS" && -x "$SERVER" ]] || {
  echo "build first: cargo build -p exact-server -p window-harness --release --features lab" >&2
  exit 1
}
[[ -f "$STUDY" ]] || bash "$ROOT/lab/scripts/gen_tf_fixtures.sh" >/dev/null
[[ -f "$ROOT/server/dev-cert/cert.pem" ]] || bash "$ROOT/server/scripts/gen_dev_cert.sh" >/dev/null

srv_pid=""
cleanup() { [[ -n "$srv_pid" ]] && kill "$srv_pid" 2>/dev/null || true; }
trap cleanup EXIT

run_reader() {
  local step_ms=$1 label=$2
  cleanup; sleep 0.4
  "$SERVER" --port "$PORT" --study "$STUDY" \
    --cert-pem "$ROOT/server/dev-cert/cert.pem" --key-pem "$ROOT/server/dev-cert/key.pem" \
    --stream-mode "$MODE" >/dev/null 2>&1 &
  srv_pid=$!
  sleep 1.2
  echo "--- $label reader: ${step_ms} ms/step ---"
  if ! "$HARNESS" --url "https://127.0.0.1:$PORT/" --mode trace --trace "$TRACE" \
      --read-bps "$READ_BPS" --depth "$DEPTH" --frame-count "$FRAME_COUNT" \
      --fill-dwell-ms 0 --stream-mode "$MODE" --rtt-ms 0 --window-shape forward \
      --step-interval-ms "$step_ms" --timeout-ms 120000 --arm "$label" 2>&1 \
      | grep -E 'miss_p95_wait_ms|cache_misses|step_loop_ms|late_|on_time_rate'; then
    echo "harness failed — see note below" >&2
    return 1
  fi
}

if ! run_reader "$CLINICAL_STEP_MS" clinical; then
  cat >&2 <<'NOTE'

If that failed with "Address family not supported by protocol (os error 97)", the host
has no IPv6 and wtransport's default bind is dual-stack. Substitute in a scratch build:
  server/src/transport/server.rs   .with_bind_default(config.wt_port)
    -> .with_bind_config(wtransport::config::IpBindConfig::InAddrAnyV4, config.wt_port)
  lab/window-harness/src/client.rs .with_bind_default()
    -> .with_bind_config(wtransport::config::IpBindConfig::InAddrAnyV4)
NOTE
  exit 1
fi
run_reader "$STRESS_STEP_MS" stress

cat <<'EOF'

Read it this way: between the two runs `miss_p95_wait_ms` moves by tens of ms, while
`late_p95_ms` moves by seconds and `on_time_rate` collapses. Ranking two transport arms
on the first column cannot see a run in which the reader spent most of its steps behind
schedule — which is why L1_V3_PHASE_C_REVIEW.md makes lateness the primary readout.
EOF
