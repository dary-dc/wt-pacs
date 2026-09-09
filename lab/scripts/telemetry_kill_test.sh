#!/usr/bin/env bash
# P3: a hard kill (SIGKILL — no handler can run) leaves the row file and a timer summary.
#
# Usage: SERVER_TELEMETRY=path BIND=127.0.0.1 HARNESS_IPV4=1 lab/scripts/telemetry_kill_test.sh
# Prints one JSON line: rows_in_file, frames in the last timer summary, and pass/fail.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
WORK="${WORK:-$ROOT/.local/telemetry-kill-test}"
STUDY="${STUDY:-$ROOT/lab/fixtures/queue_large/queue_large.sbnd}"
CERT="$ROOT/server/dev-cert/cert.pem"; KEY="$ROOT/server/dev-cert/key.pem"
PORT="${PORT:-4434}"
BIND="${BIND:-}"; HARNESS_IPV4="${HARNESS_IPV4:-0}"
SUMMARY_MS="${SUMMARY_MS:-1000}"
RUN_S="${RUN_S:-4}"
export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-$ROOT/target}"
[[ -n "${SERVER_TELEMETRY:-}" ]] || { echo "set SERVER_TELEMETRY" >&2; exit 1; }
HARNESS="$CARGO_TARGET_DIR/release/window-harness"
[[ -x "$HARNESS" ]] || cargo build --release -p window-harness >/dev/null

rm -rf "$WORK"; mkdir -p "$WORK"
report="$WORK/telemetry-server.json"
bind_args=(); [[ -n "$BIND" ]] && bind_args=(--bind "$BIND")
harness_args=(); [[ "$HARNESS_IPV4" == "1" ]] && harness_args=(--ipv4)

WTPACS_TELEMETRY=1 WTPACS_TELEMETRY_PATH="$report" WTPACS_TELEMETRY_SUMMARY_MS="$SUMMARY_MS" \
  "$SERVER_TELEMETRY" --port "$PORT" --study "$STUDY" --cert-pem "$CERT" --key-pem "$KEY" \
    "${bind_args[@]}" > "$WORK/server.out" 2> "$WORK/server.err" &
spid=$!
sleep 1
"$HARNESS" --url "https://127.0.0.1:$PORT/" --mode saturate --depth 4 --read-bps 0 \
  --fill-dwell-ms $(( RUN_S * 1000 + 10000 )) --frame-count 20 --json "${harness_args[@]}" \
  > "$WORK/harness.json" 2> "$WORK/harness.err" &
hpid=$!
sleep "$RUN_S"
kill -KILL "$spid"
wait "$spid" 2>/dev/null || true
kill "$hpid" 2>/dev/null || true
wait "$hpid" 2>/dev/null || true

python3 - "$WORK" "$report" <<'PY'
import json, os, sys
work, report = sys.argv[1:]
rows = os.path.join(work, "telemetry-server.rows")
out = {"bench": "kill", "rows_file_exists": os.path.exists(rows), "summary_exists": os.path.exists(report)}
if out["rows_file_exists"]:
    size = os.path.getsize(rows)
    out["rows_in_file"] = max(0, (size - 16) // 64)
if out["summary_exists"]:
    r = json.load(open(report))
    out["summary_event"] = r["run_end"]["event"]
    out["summary_frames"] = r["summary"]["frame_count"]
    out["summary_method"] = r["summary"]["percentile_method"]
out["pass"] = bool(out.get("rows_in_file", 0) > 0 and out["summary_exists"] and out.get("summary_frames", 0) > 0)
print(json.dumps(out))
PY
