#!/usr/bin/env bash
# Profile-guided release build of exact-server: instrument, train on the cells the server is
# measured on, rebuild with the profile. The profile is bound to the source it was taken from,
# so this runs per build, never from a stored profile. `docs/transport/why-these-changes.md` §9.
#
#   scripts/pgo_build.sh            → target/pgo/release/exact-server
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
OUT="${OUT:-$ROOT/target/pgo}"
PROFILES="${PROFILES:-$OUT/profiles}"
rm -rf "$PROFILES" && mkdir -p "$PROFILES"

PROFDATA=$(ls "$HOME"/.rustup/toolchains/*/lib/rustlib/*/bin/llvm-profdata 2>/dev/null | head -1)
[[ -n "$PROFDATA" ]] || { echo "llvm-profdata missing: rustup component add llvm-tools-preview" >&2; exit 1; }
[[ -f server/dev-cert/cert.pem ]] || bash server/scripts/gen_dev_cert.sh >/dev/null
[[ -f lab/fixtures/frames_32k/frames_32k.sbnd ]] || FRAMES=80 bash lab/scripts/gen_tf_fixtures.sh >/dev/null
[[ -f lab/fixtures/frames_tiny/frames_tiny.sbnd ]] || NAME=frames_tiny BYTES=100 FRAMES=80 bash lab/scripts/gen_live_cell_fixture.sh >/dev/null
cargo build --release -p disk-access-bench --bin server_ab

RUSTFLAGS="-Cprofile-generate=$PROFILES" cargo build --release -p exact-server --target-dir "$OUT/instrumented"

# The training set is the measured cell shape: fill, depth 4 with several sessions, depth 1.
train() {
  local fx=$1 log; log=$(mktemp)
  local port; port=$(python3 -c 'import socket;s=socket.socket(socket.AF_INET,socket.SOCK_DGRAM);s.bind(("127.0.0.1",0));print(s.getsockname()[1])')
  NO_COLOR=1 RUST_LOG=exact_server=warn "$OUT/instrumented/release/exact-server" --port "$port" --study "$fx" \
    --stream-mode shared --bind 127.0.0.1 --cert-pem server/dev-cert/cert.pem --key-pem server/dev-cert/key.pem >"$log" 2>&1 &
  local pid=$!
  for _ in $(seq 1 200); do grep -q '^telemetry=' "$log" && break; sleep 0.05; done
  local url="https://127.0.0.1:$port/" d=target/release/server_ab
  for _ in 1 2 3; do "$d" --url "$url" --server-pid "$pid" --mode fill --asks 80 --frames 80 --no-header >/dev/null; done
  "$d" --url "$url" --server-pid "$pid" --mode on-demand --depth 4 --asks 200 --sessions 4 --frames 80 --no-header >/dev/null
  "$d" --url "$url" --server-pid "$pid" --mode on-demand --depth 4 --asks 100 --sessions 16 --frames 80 --no-header >/dev/null
  "$d" --url "$url" --server-pid "$pid" --mode on-demand --depth 1 --asks 300 --frames 80 --no-header >/dev/null
  kill "$pid"; wait "$pid" 2>/dev/null || true
  rm -f "$log"
}
train lab/fixtures/frames_250k/frames_250k.sbnd
train lab/fixtures/frames_32k/frames_32k.sbnd
train lab/fixtures/frames_tiny/frames_tiny.sbnd

"$PROFDATA" merge -o "$PROFILES/merged.profdata" "$PROFILES"/*.profraw
RUSTFLAGS="-Cprofile-use=$PROFILES/merged.profdata -Cllvm-args=-pgo-warn-missing-function" \
  cargo build --release -p exact-server --target-dir "$OUT"
echo "pgo_binary=$OUT/release/exact-server"
