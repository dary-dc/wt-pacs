#!/usr/bin/env bash
# End-to-end telemetry cost on localhost: exact-server + N saturate harnesses.
# Compares a default binary against a telemetry binary (feature + env on) at the same N.
# Localhost, unshaped, shared CPU — relative comparisons only (T2-local).
#
# Usage:
#   SERVER_DEFAULT=path SERVER_TELEMETRY=path SESSIONS="1 4 16 32" REPEATS=2 \
#     lab/scripts/telemetry_e2e_baseline.sh [out.jsonl]
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="${1:-$ROOT/.local/measurements/telemetry-e2e-$(date -u +%Y%m%dT%H%M%SZ).jsonl}"
WORK="${WORK:-$ROOT/.local/telemetry-e2e-work}"
STUDY="${STUDY:-$ROOT/lab/fixtures/queue_large/queue_large.sbnd}"
CERT="$ROOT/server/dev-cert/cert.pem"
KEY="$ROOT/server/dev-cert/key.pem"
SESSIONS="${SESSIONS:-1 4 16 32}"
REPEATS="${REPEATS:-2}"
DWELL_MS="${DWELL_MS:-5000}"
DEPTH="${DEPTH:-4}"
STREAM_MODE="${STREAM_MODE:-per-frame}"
PORT="${PORT:-4433}"
# Hosts without IPv6: BIND=127.0.0.1 HARNESS_IPV4=1
BIND="${BIND:-}"
HARNESS_IPV4="${HARNESS_IPV4:-0}"
# Extra server flags (e.g. "--send-window-bytes 1000000") and a harness read pace (0 = unpaced).
SERVER_EXTRA_ARGS="${SERVER_EXTRA_ARGS:-}"
HARNESS_READ_BPS="${HARNESS_READ_BPS:-0}"
LABEL_SUFFIX="${LABEL_SUFFIX:-}"
export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-$ROOT/target}"

mkdir -p "$(dirname "$OUT")" "$WORK"
[[ -f "$CERT" ]] || "$ROOT/server/scripts/gen_dev_cert.sh" >/dev/null

if [[ -z "${SERVER_DEFAULT:-}" || -z "${SERVER_TELEMETRY:-}" ]]; then
  echo "set SERVER_DEFAULT and SERVER_TELEMETRY to prebuilt exact-server binaries" >&2
  exit 1
fi
cargo build --release -p window-harness >/dev/null
HARNESS="$CARGO_TARGET_DIR/release/window-harness"
CLK_TCK="$(getconf CLK_TCK)"

: > "$OUT"

one_run() {
  local label=$1 bin=$2 telemetry=$3 n=$4 rep=$5
  local dir="$WORK/$label-n$n-r$rep"
  rm -rf "$dir"; mkdir -p "$dir"
  local report="$dir/telemetry-server.json"

  local bind_args=()
  [[ -n "$BIND" ]] && bind_args=(--bind "$BIND")
  # shellcheck disable=SC2206
  [[ -n "$SERVER_EXTRA_ARGS" ]] && bind_args+=($SERVER_EXTRA_ARGS)
  local harness_args=()
  [[ "$HARNESS_IPV4" == "1" ]] && harness_args=(--ipv4)
  if [[ "$telemetry" == "1" ]]; then
    WTPACS_TELEMETRY=1 WTPACS_TELEMETRY_PATH="$report" \
      "$bin" --port "$PORT" --study "$STUDY" --cert-pem "$CERT" --key-pem "$KEY" \
        --stream-mode "$STREAM_MODE" "${bind_args[@]}" > "$dir/server.out" 2> "$dir/server.err" &
  else
    "$bin" --port "$PORT" --study "$STUDY" --cert-pem "$CERT" --key-pem "$KEY" \
      --stream-mode "$STREAM_MODE" "${bind_args[@]}" > "$dir/server.out" 2> "$dir/server.err" &
  fi
  local spid=$!
  sleep 1

  local pids=()
  for i in $(seq 1 "$n"); do
    "$HARNESS" --url "https://127.0.0.1:$PORT/" --mode saturate --depth "$DEPTH" \
      --read-bps "$HARNESS_READ_BPS" --fill-dwell-ms "$DWELL_MS" --frame-count 20 \
      --stream-mode "$STREAM_MODE" --arm "s$i" --json "${harness_args[@]}" \
      > "$dir/harness-$i.json" 2> "$dir/harness-$i.err" &
    pids+=($!)
  done
  local failed=0
  for p in "${pids[@]}"; do wait "$p" || failed=$((failed+1)); done

  # Server cost while all sessions were live (read before the process exits).
  local stat vmhwm=0 vmrss=0 utime=0 stime=0 server_alive=0
  if [[ -r "/proc/$spid/stat" ]]; then
    server_alive=1
    stat="$(cat "/proc/$spid/stat" 2>/dev/null || true)"
    vmhwm="$(awk '/VmHWM/{print $2}' "/proc/$spid/status" 2>/dev/null || echo 0)"
    vmrss="$(awk '/VmRSS/{print $2}' "/proc/$spid/status" 2>/dev/null || echo 0)"
    utime="$(echo "$stat" | awk '{print $14}')"
    stime="$(echo "$stat" | awk '{print $15}')"
  fi

  # Today's report is written only when the last session drops — give it a moment.
  sleep 1.5
  kill "$spid" 2>/dev/null || true
  wait "$spid" 2>/dev/null || true

  python3 - "$dir" "$label$LABEL_SUFFIX" "$telemetry" "$n" "$rep" "$DWELL_MS" "$utime" "$stime" "$CLK_TCK" "$vmhwm" "$vmrss" "$failed" "$report" "$server_alive" >> "$OUT" <<'PY'
import json, sys, glob, os
d, label, tel, n, rep, dwell_ms, ut, st, tck, hwm, rss, failed, report, alive = sys.argv[1:]
n=int(n); rep=int(rep); dwell_s=int(dwell_ms)/1000.0
frames=0.0; bits=0.0; peak=0; ok=0
for f in sorted(glob.glob(os.path.join(d, "harness-*.json"))):
    try:
        m=json.load(open(f))
    except Exception:
        continue
    ok+=1
    frames+=m.get("fill_rate",0.0)
    bits+=m.get("fill_bytes",0)*8/dwell_s
    peak=max(peak, m.get("peak_outstanding",0))
row={
  "bench":"e2e","label":label,"telemetry":tel=="1","sessions":n,"repeat":rep,
  "harness_ok":ok,"harness_failed":int(failed),"server_alive_at_end":alive=="1",
  "agg_frames_per_s":round(frames,2),"agg_mbit_s":round(bits/1e6,2),
  "server_cpu_s":round((int(ut)+int(st))/int(tck),3),
  "server_vmhwm_kb":int(hwm),"server_vmrss_kb":int(rss),
  "dwell_ms":int(dwell_ms),"peak_outstanding":peak,
}
if tel=="1":
    try:
        r=json.load(open(report))
        s=r["summary"]
        # schema server-pipeline-v1 (serve_us / send_us, may be null) or the pre-v1 names
        serve=s.get("serve_us") or s.get("server_serve_us") or {}
        send=s.get("send_us") or s.get("server_write_us") or {}
        run_end=r.get("run_end",{})
        rows_file=os.path.join(d, r["rows_file"]) if r.get("rows_file") else None
        row["report"]={
          "schema":r.get("schema","pre-v1"),
          "percentile_method":s.get("percentile_method"),
          "sessions":s.get("sessions"),
          "rows_file_bytes":os.path.getsize(rows_file) if rows_file and os.path.exists(rows_file) else None,
          "frame_count":s["frame_count"],
          "dropped_records":run_end.get("dropped_records", run_end.get("dropped_records_process_total")),
          "serve_p50_us":serve.get("p50"),
          "serve_p95_us":serve.get("p95"),
          "serve_p99_us":serve.get("p99"),
          "write_p50_us":send.get("p50"),
          "write_p99_us":send.get("p99"),
          "report_bytes":os.path.getsize(report),
        }
    except Exception as e:
        row["report"]={"error":str(e)}
print(json.dumps(row))
PY
  tail -1 "$OUT"
}

for rep in $(seq 1 "$REPEATS"); do
  for n in $SESSIONS; do
    one_run default "$SERVER_DEFAULT" 0 "$n" "$rep"
    one_run telemetry "$SERVER_TELEMETRY" 1 "$n" "$rep"
  done
done

echo "wrote $OUT"
