#!/usr/bin/env bash
# A/B server send-path bench on localhost: telemetry server + N saturate harnesses per cell.
# Build first: cargo build --release -p window-harness; two exact-server binaries built with
# --features telemetry (copy each aside before building the other).
# usage: sendpath_bench.sh OUT.jsonl LABEL_A BIN_A [LABEL_B BIN_B]
# env: FIXTURES="frames_32k frames_250k" MODES="shared per-frame" REPEATS=3 DWELL_MS=4000 DEPTH=4
#      SESSIONS=1 READ_BPS=0 PORT=4433
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
OUT=$1; LA=$2; BA=$3; LB=${4:-}; BB=${5:-}
FIXTURES="${FIXTURES:-frames_32k frames_250k}"
MODES="${MODES:-shared per-frame}"
REPEATS="${REPEATS:-3}"; DWELL_MS="${DWELL_MS:-4000}"; DEPTH="${DEPTH:-4}"
SESSIONS="${SESSIONS:-1}"; READ_BPS="${READ_BPS:-0}"; PORT="${PORT:-4433}"
HARNESS="${HARNESS:-$ROOT/target/release/window-harness}"
CERT=$ROOT/server/dev-cert/cert.pem; KEY=$ROOT/server/dev-cert/key.pem
CLK_TCK=$(getconf CLK_TCK)
WORK="${WORK:-$ROOT/.local/sendpath-bench}/$(basename "$OUT" .jsonl)"; mkdir -p "$WORK"

one_run() {
  local label=$1 bin=$2 fixture=$3 mode=$4 rep=$5
  local dir="$WORK/$label-$fixture-$mode-r$rep"; rm -rf "$dir"; mkdir -p "$dir"
  local report="$dir/telemetry-server.json"
  local study=$ROOT/lab/fixtures/$fixture/$fixture.sbnd
  local frames; frames=$(python3 -c "import json;print(json.load(open('$ROOT/lab/fixtures/$fixture/metadata.json'))['frameCount'])")
  WTPACS_TELEMETRY=1 WTPACS_TELEMETRY_PATH="$report" \
    "$bin" --port "$PORT" --study "$study" --cert-pem "$CERT" --key-pem "$KEY" \
      --stream-mode "$mode" --bind 127.0.0.1 > "$dir/server.out" 2> "$dir/server.err" &
  local spid=$!
  for _ in $(seq 1 50); do grep -q '^telemetry=' "$dir/server.out" 2>/dev/null && break; sleep 0.1; done
  grep -q '^telemetry=' "$dir/server.out" || { echo "server did not start: $(cat $dir/server.err)"; kill $spid; return 1; }
  local pids=()
  for i in $(seq 1 "$SESSIONS"); do
    "$HARNESS" --url "https://127.0.0.1:$PORT/" --mode saturate --depth "$DEPTH" \
      --read-bps "$READ_BPS" --fill-dwell-ms "$DWELL_MS" --frame-count "$frames" \
      --stream-mode "$mode" --arm "s$i" --ipv4 --json > "$dir/harness-$i.json" 2> "$dir/harness-$i.err" &
    pids+=($!)
  done
  local failed=0; for p in "${pids[@]}"; do wait "$p" || failed=$((failed+1)); done
  local stat utime stime vmhwm vmrss
  stat=$(cat /proc/$spid/stat); utime=$(echo "$stat" | awk '{print $14}'); stime=$(echo "$stat" | awk '{print $15}')
  vmhwm=$(awk '/VmHWM/{print $2}' /proc/$spid/status); vmrss=$(awk '/VmRSS/{print $2}' /proc/$spid/status)
  sleep 0.5; kill -TERM $spid 2>/dev/null || true; wait $spid 2>/dev/null || true
  for _ in $(seq 1 50); do [[ -f "$report" ]] && break; sleep 0.1; done
  python3 - "$dir" "$label" "$fixture" "$mode" "$rep" "$SESSIONS" "$DWELL_MS" "$utime" "$stime" "$CLK_TCK" "$vmhwm" "$vmrss" "$failed" "$report" >> "$OUT" <<'PY'
import json, sys, glob, os
d,label,fixture,mode,rep,n,dwell_ms,ut,st,tck,hwm,rss,failed,report = sys.argv[1:]
dwell_s=int(dwell_ms)/1000
fill=0.0; bits=0.0; peak=0; ok=0; frames_on_wire=0
for f in sorted(glob.glob(os.path.join(d,"harness-*.json"))):
    try: m=json.load(open(f))
    except Exception: continue
    ok+=1; fill+=m.get("fill_rate",0.0); bits+=m.get("fill_bytes",0)*8/dwell_s
    peak=max(peak,m.get("peak_outstanding",0)); frames_on_wire+=m.get("frames_on_wire",0)
cpu_s=(int(ut)+int(st))/int(tck)
row={"label":label,"fixture":fixture,"mode":mode,"rep":int(rep),"sessions":int(n),
     "harness_ok":ok,"harness_failed":int(failed),"peak_outstanding":peak,
     "agg_frames_per_s":round(fill,1),"agg_mbit_s":round(bits/1e6,1),
     "frames_on_wire":frames_on_wire,"server_cpu_s":round(cpu_s,3),
     "server_vmhwm_kb":int(hwm),"server_vmrss_kb":int(rss)}
try:
    r=json.load(open(report)); s=r["summary"]
    for k in ("prepare_us","locate_us","send_us","serve_us","overhead_us"):
        v=s.get(k) or {}
        row[k]={kk:v.get(kk) for kk in ("count","mean","p50","p95","p99","max")}
    cnt=(s.get("send_us") or {}).get("count") or 0
    row["served_frames"]=cnt
    row["server_cpu_us_per_frame"]=round(cpu_s*1e6/cnt,1) if cnt else None
    row["percentile_method"]=s.get("percentile_method")
    row["dropped"]=r.get("run_end",{}).get("dropped_records_process_total")
except Exception as e:
    row["report_error"]=str(e)
print(json.dumps(row))
PY
  tail -1 "$OUT"
}

: > "$OUT"
for rep in $(seq 1 "$REPEATS"); do
  for fixture in $FIXTURES; do
    for mode in $MODES; do
      one_run "$LA" "$BA" "$fixture" "$mode" "$rep"
      [[ -n "$LB" ]] && one_run "$LB" "$BB" "$fixture" "$mode" "$rep"
    done
  done
done
echo "wrote $OUT"
