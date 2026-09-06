#!/usr/bin/env bash
# Run exact-server under callgrind while one harness saturates it; annotate top self-cost symbols.
# usage: callgrind_run.sh LABEL SERVER_PROF_BIN FIXTURE MODE [DWELL_MS]
# SERVER_PROF_BIN: exact-server built with CARGO_PROFILE_RELEASE_DEBUG=1. env: HARNESS, WORK, PORT
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
HARNESS="${HARNESS:-$ROOT/target/release/window-harness}"
label=$1; bin=$2; fixture=$3; mode=$4; dwell=${5:-4000}; port=${PORT:-4477}
dir="${WORK:-$ROOT/.local/callgrind}/$label-$fixture-$mode"; rm -rf "$dir"; mkdir -p "$dir"
study=$ROOT/lab/fixtures/$fixture/$fixture.sbnd
frames=$(python3 -c "import json;print(json.load(open('$ROOT/lab/fixtures/$fixture/metadata.json'))['frameCount'])")
valgrind --tool=callgrind --callgrind-out-file=$dir/callgrind.out --collect-atstart=yes \
  "$bin" --port $port --study "$study" --cert-pem $ROOT/server/dev-cert/cert.pem --key-pem $ROOT/server/dev-cert/key.pem \
  --stream-mode $mode --bind 127.0.0.1 > $dir/server.out 2> $dir/server.err &
vpid=$!
for _ in $(seq 1 600); do grep -q '^telemetry=' $dir/server.out 2>/dev/null && break; sleep 0.1; done
grep -q '^telemetry=' $dir/server.out || { echo "server under valgrind did not start"; tail -5 $dir/server.err; kill $vpid; exit 1; }
"$HARNESS" --url https://127.0.0.1:$port/ --mode saturate --depth 4 --read-bps 0 \
  --fill-dwell-ms $dwell --frame-count $frames --stream-mode $mode --arm cg --ipv4 --timeout-ms 120000 --json > $dir/harness.json 2> $dir/harness.err || true
kill -TERM $vpid; wait $vpid 2>/dev/null || true
python3 -c "import json;m=json.load(open('$dir/harness.json'));print('frames_on_wire',m['frames_on_wire'],'fill_frames',m['fill_frames'])"
callgrind_annotate --inclusive=no --threshold=99 $dir/callgrind.out 2>/dev/null | sed -n 1,80p > $dir/annotate_self.txt
callgrind_annotate --inclusive=yes --threshold=99 $dir/callgrind.out 2>/dev/null | sed -n 1,80p > $dir/annotate_incl.txt
echo "wrote $dir"
