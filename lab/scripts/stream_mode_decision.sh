#!/usr/bin/env bash
# Stream-mode decision campaign (docs/stream-mode-decision-experiments.md).
# Must run inside: unshare --user --map-root-user --net -- bash
#
# Usage:
#   unshare --user --map-root-user --net -- bash lab/scripts/stream_mode_decision.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT_DIR="${OUT_DIR:-$ROOT/.local/measurements/stream-mode-decision}"
CERT="$ROOT/server/dev-cert/cert.pem"
KEY="$ROOT/server/dev-cert/key.pem"
PORT="${PORT:-4439}"
export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-$ROOT/target}"
FILL_DWELL_MS="${FILL_DWELL_MS:-2000}"
LINK_MBPS=10
LINK_BPS=$((LINK_MBPS * 1000000))

STUDY_250="$ROOT/lab/fixtures/frames_250k/frames_250k.sbnd"
STUDY_250_LIVE="$ROOT/lab/fixtures/frames_250k_live/frames_250k_live.sbnd"
STUDY_51="$ROOT/lab/fixtures/queue_large/queue_large.sbnd"
TRACE="${TRACE:-$ROOT/lab/traces/x3_short_scroll.json}"

mkdir -p "$OUT_DIR"
TSV="$OUT_DIR/results.tsv"
REPORT="$OUT_DIR/REPORT.md"
RAW_DIR="$OUT_DIR/raw"
mkdir -p "$RAW_DIR"

[[ -f "$CERT" ]] || bash "$ROOT/server/scripts/gen_dev_cert.sh"
[[ -f "$STUDY_250" ]] || bash "$ROOT/lab/scripts/gen_tf_fixtures.sh"

echo "Building binaries…"
cargo build -p exact-server -p window-harness --release >/dev/null

SERVER="$CARGO_TARGET_DIR/release/exact-server"
HARNESS="$CARGO_TARGET_DIR/release/window-harness"

spid=""
cleanup() {
  kill "$spid" 2>/dev/null || true
  wait "$spid" 2>/dev/null || true
  tc qdisc del dev lo root 2>/dev/null || true
}
trap cleanup EXIT

ip link set lo up

set_netem() {
  local rtt_ms=$1 loss_pct=${2:-0}
  local one_way
  one_way=$(python3 -c "print(max(0.001, float($rtt_ms) / 2.0))")
  tc qdisc del dev lo root 2>/dev/null || true
  if [[ "$loss_pct" == "0" || "$loss_pct" == "0.0" ]]; then
    tc qdisc add dev lo root netem delay "${one_way}ms" rate "${LINK_MBPS}mbit"
  else
    tc qdisc add dev lo root netem delay "${one_way}ms" rate "${LINK_MBPS}mbit" loss "${loss_pct}%"
  fi
  echo "netem: delay=${one_way}ms rate=${LINK_MBPS}mbit loss=${loss_pct}% (RTT≈${rtt_ms}ms)" >&2
  # Confirm RTT once at setup of 60 ms cell
  if [[ "$rtt_ms" == "60" && "$loss_pct" == "0" ]]; then
    ping -c 3 -W 1 127.0.0.1 2>&1 | tail -2 >&2 || true
  fi
}

start_server() {
  local study=$1 mode=$2
  kill "$spid" 2>/dev/null || true
  wait "$spid" 2>/dev/null || true
  spid=""
  # Ensure prior listener is gone before rebinding.
  fuser -k "${PORT}/udp" 2>/dev/null || true
  fuser -k "${PORT}/tcp" 2>/dev/null || true
  sleep 0.4
  "$SERVER" --port "$PORT" --study "$study" \
    --cert-pem "$CERT" --key-pem "$KEY" \
    --stream-mode "$mode" \
    >"$RAW_DIR/server-${mode}.log" 2>&1 &
  spid=$!
  sleep 1.2
  if ! kill -0 "$spid" 2>/dev/null; then
    echo "FATAL: server failed to start" >&2
    cat "$RAW_DIR/server-${mode}.log" >&2
    exit 2
  fi
}

# Compute Mbps from fill_bytes / dwell; harness link_util is void when read-bps=0.
parse_saturate() {
  local json_file=$1
  python3 - "$LINK_MBPS" "$json_file" <<'PY'
import json, sys
link_mbps = float(sys.argv[1])
m = json.load(open(sys.argv[2]))
dwell_ms = max(1, int(m.get("fill_dwell_ms") or 1))
fill_bytes = int(m.get("fill_bytes") or 0)
mbps = (fill_bytes * 8.0 / (dwell_ms / 1000.0)) / 1_000_000.0
util = mbps / link_mbps if link_mbps else 0.0
print(
    f"{mbps:.3f}\t{util:.4f}\t{m.get('peak_outstanding',0)}\t{m.get('asks_sent',0)}"
    f"\t{m.get('fill_frames',0)}\t{m.get('fill_bytes',0)}\t{m.get('stream_mode','?')}"
    f"\t{m.get('p95_wait_ms',0)}\t{m.get('mean_wait_ms',0)}"
)
PY
}

parse_trace() {
  local json_file=$1
  python3 - "$json_file" <<'PY'
import json, sys
m = json.load(open(sys.argv[1]))
print(
    f"{m.get('p95_wait_ms',0):.2f}\t{m.get('mean_wait_ms',0):.2f}"
    f"\t{m.get('peak_outstanding',0)}\t{m.get('asks_sent',0)}"
    f"\t{m.get('stream_mode','?')}\t{m.get('wanted_received',False)}"
    f"\t{m.get('frames_on_wire',0)}"
)
PY
}

echo -e "phase\tmode\tfixture\tframe_bytes\trtt_ms\tloss_pct\tdepth\tmbps\tutil\tp95_wait_ms\tmean_wait_ms\tpeak_outstanding\tasks_sent\tnotes" > "$TSV"

run_saturate() {
  local phase=$1 mode=$2 study=$3 frame_bytes=$4 frame_count=$5 rtt_ms=$6 loss=$7 depth=$8 notes=${9:-}
  set_netem "$rtt_ms" "$loss"
  start_server "$study" "$mode"
  local json_file="$RAW_DIR/${phase}_${mode}_fb${frame_bytes}_rtt${rtt_ms}_loss${loss}_d${depth}.json"
  set +e
  timeout 90 "$HARNESS" --url "https://127.0.0.1:${PORT}/" --mode saturate \
    --read-bps 0 --depth "$depth" --frame-count "$frame_count" \
    --fill-dwell-ms "$FILL_DWELL_MS" --stream-mode "$mode" \
    --arm "${phase}_${mode}_d${depth}" --json >"$json_file" 2>"$json_file.err"
  local rc=$?
  set -e
  if [[ $rc -ne 0 ]]; then
    echo -e "${phase}\t${mode}\t$(basename "$study")\t${frame_bytes}\t${rtt_ms}\t${loss}\t${depth}\tFAIL\tFAIL\t-\t-\t-\t-\t${notes} harness_rc=${rc}" >> "$TSV"
    echo "FAIL ${phase} ${mode} d=${depth} rtt=${rtt_ms} loss=${loss} rc=${rc}" >&2
    cat "$json_file.err" >&2 || true
    return 1
  fi
  local parsed
  parsed=$(parse_saturate "$json_file")
  IFS=$'\t' read -r mbps util peak asks fill_frames fill_bytes stream_mode p95 mean <<<"$parsed"
  echo -e "${phase}\t${mode}\t$(basename "$study")\t${frame_bytes}\t${rtt_ms}\t${loss}\t${depth}\t${mbps}\t${util}\t${p95}\t${mean}\t${peak}\t${asks}\t${notes}" >> "$TSV"
  echo "OK ${phase} ${mode} d=${depth} rtt=${rtt_ms} loss=${loss} → ${mbps} Mbps util=${util}" >&2
  printf '%s' "$mbps"
}

run_trace() {
  local phase=$1 mode=$2 study=$3 frame_bytes=$4 frame_count=$5 rtt_ms=$6 loss=$7 depth=$8 notes=${9:-}
  set_netem "$rtt_ms" "$loss"
  start_server "$study" "$mode"
  local json_file="$RAW_DIR/${phase}_${mode}_fb${frame_bytes}_rtt${rtt_ms}_loss${loss}_d${depth}_trace.json"
  set +e
  timeout 600 "$HARNESS" --url "https://127.0.0.1:${PORT}/" --mode trace \
    --trace "$TRACE" --read-bps 0 --depth "$depth" --frame-count "$frame_count" \
    --fill-dwell-ms 0 --stream-mode "$mode" --timeout-ms 120000 \
    --arm "${phase}_${mode}_d${depth}" --json >"$json_file" 2>"$json_file.err"
  local rc=$?
  set -e
  if [[ $rc -ne 0 ]]; then
    echo -e "${phase}\t${mode}\t$(basename "$study")\t${frame_bytes}\t${rtt_ms}\t${loss}\t${depth}\t-\t-\tFAIL\tFAIL\t-\t-\t${notes} harness_rc=${rc}" >> "$TSV"
    echo "FAIL TRACE ${phase} ${mode} d=${depth} loss=${loss} rc=${rc}" >&2
    cat "$json_file.err" >&2 || true
    return 1
  fi
  local parsed
  parsed=$(parse_trace "$json_file")
  IFS=$'\t' read -r p95 mean peak asks stream_mode wanted frames <<<"$parsed"
  echo -e "${phase}\t${mode}\t$(basename "$study")\t${frame_bytes}\t${rtt_ms}\t${loss}\t${depth}\t-\t-\t${p95}\t${mean}\t${peak}\t${asks}\t${notes}" >> "$TSV"
  echo "OK TRACE ${phase} ${mode} d=${depth} loss=${loss} → p95=${p95} mean=${mean}" >&2
  printf '%s' "$p95"
}

# ─── X1 ───────────────────────────────────────────────────────────────
echo "======== X1: finish() gate (per-frame, 250KB, 60ms RTT, D=4) ========" >&2
X1_MBPS=$(run_saturate X1 per-frame "$STUDY_250" 250000 80 60 0 4 "gate")
python3 -c "
mbps=float('$X1_MBPS')
print(f'X1 measured {mbps:.2f} Mbps')
if mbps < 8.0:
    raise SystemExit('X1 FAIL: below 8.0 Mbps ceiling — finish() still inline')
print('X1 PASS')
"

# ─── X2 ───────────────────────────────────────────────────────────────
echo "======== X2: fair lossless shared vs per-frame ========" >&2
# fixtures: 250k (80 frames), 51k (20 frames as queue_large)
# RTT: 20,60,150  D: 1,2,3,5,8
for fixture_spec in "250000:$STUDY_250:80" "51000:$STUDY_51:20"; do
  IFS=: read -r fb study fc <<<"$fixture_spec"
  for rtt in 20 60 150; do
    for mode in shared per-frame; do
      for d in 1 2 3 5 8; do
        run_saturate X2 "$mode" "$study" "$fb" "$fc" "$rtt" 0 "$d" || true
      done
    done
  done
done

# Derive D_min (smallest D reaching 95% of that mode's max util in cell) and compare modes
python3 - "$TSV" "$OUT_DIR/x2_summary.json" <<'PY'
import csv, json, math, sys
from collections import defaultdict
path, out = sys.argv[1], sys.argv[2]
rows=[]
with open(path) as f:
    for r in csv.DictReader(f, delimiter='\t'):
        if r['phase']!='X2' or r['mbps'] in ('FAIL','-'): continue
        rows.append(r)

cells=defaultdict(list)
for r in rows:
    key=(r['fixture'], r['frame_bytes'], r['rtt_ms'], r['mode'])
    cells[key].append(r)

summary=[]
for (fixture, fb, rtt, mode), rs in sorted(cells.items()):
    rs=sorted(rs, key=lambda x: int(x['depth']))
    max_mbps=max(float(x['mbps']) for x in rs)
    ceiling=0.95*max_mbps
    dmin=None
    for x in rs:
        if float(x['mbps']) >= ceiling:
            dmin=int(x['depth']); break
    fb_i, rtt_i = int(fb), int(rtt)
    tf_ms = fb_i*8/(10_000_000)*1000
    pred=max(1, math.ceil(0.95*(1.0 + rtt_i/tf_ms))) if tf_ms else 1
    summary.append({
        'fixture': fixture, 'frame_bytes': fb_i, 'rtt_ms': rtt_i, 'mode': mode,
        'max_mbps': round(max_mbps,3), 'dmin': dmin, 'pred_dmin': pred, 'tf_ms': round(tf_ms,2),
        'depths': {x['depth']: float(x['mbps']) for x in rs},
    })

# Pair shared vs per-frame
pairs=[]
by=defaultdict(dict)
for s in summary:
    by[(s['fixture'], s['frame_bytes'], s['rtt_ms'])][s['mode']]=s
for key, modes in sorted(by.items()):
    if 'shared' in modes and 'per-frame' in modes:
        a,b=modes['shared']['max_mbps'], modes['per-frame']['max_mbps']
        mid=(a+b)/2 or 1
        gap=abs(a-b)/mid*100
        pairs.append({
            'fixture': key[0], 'frame_bytes': key[1], 'rtt_ms': key[2],
            'shared_mbps': a, 'per_frame_mbps': b, 'gap_pct': round(gap,2),
            'shared_dmin': modes['shared']['dmin'], 'per_frame_dmin': modes['per-frame']['dmin'],
            'pred_dmin': modes['shared']['pred_dmin'],
        })

result={'cells': summary, 'pairs': pairs,
        'max_gap_pct': max((p['gap_pct'] for p in pairs), default=0),
        'ok_within_10': all(p['gap_pct']<=10 for p in pairs)}
json.dump(result, open(out,'w'), indent=2)
print(f"X2 max gap {result['max_gap_pct']:.1f}% within_10={result['ok_within_10']}")
for p in pairs:
    print(f"  rtt={p['rtt_ms']} fb={p['frame_bytes']}: shared={p['shared_mbps']} per-frame={p['per_frame_mbps']} gap={p['gap_pct']}% dmin S/P={p['shared_dmin']}/{p['per_frame_dmin']} pred={p['pred_dmin']}")
PY

# D_min for X3 cell: 250KB @ 60ms — use max of the two modes' dmin, fallback 4
X3_D=$(python3 -c '
import json
s=json.load(open("'"$OUT_DIR"'/x2_summary.json"))
d=4
for p in s["pairs"]:
    if p["frame_bytes"]==250000 and p["rtt_ms"]==60:
        vals=[x for x in (p["shared_dmin"], p["per_frame_dmin"]) if x]
        d=max(vals) if vals else 4
print(d)
')
echo "X3 depth from X2 D_min @ 250KB/60ms: D=$X3_D" >&2

# ─── X3 ───────────────────────────────────────────────────────────────
echo "======== X3: loss comparison (p95 TTD) ========" >&2
if [[ ! -f "$TRACE" ]]; then
  echo "WARN: trace missing at $TRACE — falling back to saturate mean wait unavailable; using saturate for loss util only" >&2
  for loss in 0 0.1 0.5 2; do
    for mode in shared per-frame; do
      run_saturate X3 "$mode" "$STUDY_250_LIVE" 250000 320 60 "$loss" "$X3_D" "loss-util-fallback" || true
    done
  done
else
  for loss in 0 0.1 0.5 2; do
    for mode in shared per-frame; do
      run_trace X3 "$mode" "$STUDY_250_LIVE" 250000 320 60 "$loss" "$X3_D" "decider" || true
    done
  done
fi

# Decision
python3 - "$TSV" "$OUT_DIR" "$X3_D" "$REPORT" <<'PY'
import csv, json, sys
from pathlib import Path
tsv, out_dir, x3_d, report = sys.argv[1:5]
rows=list(csv.DictReader(open(tsv), delimiter='\t'))
x1=[r for r in rows if r['phase']=='X1']
x2=json.load(open(Path(out_dir)/'x2_summary.json'))
x3=[r for r in rows if r['phase']=='X3' and r['p95_wait_ms'] not in ('FAIL','-','')]

by_loss={}
for r in x3:
    try:
        p95=float(r['p95_wait_ms'])
    except ValueError:
        continue
    by_loss.setdefault(r['loss_pct'], {})[r['mode']]=p95

decision='undecided'
detail=[]
for loss in ['0','0.1','0.5','2']:
    m=by_loss.get(loss, {})
    if 'shared' in m and 'per-frame' in m:
        s,p=m['shared'], m['per-frame']
        # lower p95 is better
        if s<=0: gap=0
        else: gap=(s-p)/s*100  # positive => per-frame better
        detail.append({'loss_pct': float(loss), 'shared_p95': s, 'per_frame_p95': p, 'per_frame_better_pct': round(gap,2)})
        if loss=='0.5':
            if gap > 15:
                decision='per-frame'
            elif abs(gap) <= 15:
                decision='shared'
            else:
                decision='shared'  # shared better by >15% still chooses shared (viewer target)

x1_mbps=float(x1[0]['mbps']) if x1 and x1[0]['mbps'] not in ('FAIL','-') else None

lines=[]
lines.append('# Stream mode decision — experiment report')
lines.append('')
lines.append('**Date:** 2026-08-28 · **Campaign:** `docs/stream-mode-decision-experiments.md`')
lines.append('')
lines.append('## X1 — finish() gate')
lines.append(f'- Measured: **{x1_mbps} Mbps** (need ≥ 8.0)')
lines.append(f'- Result: **{"PASS" if x1_mbps and x1_mbps>=8 else "FAIL"}**')
lines.append('')
lines.append('## X2 — lossless mode comparison')
lines.append(f'- Max gap between modes: **{x2["max_gap_pct"]}%** (ok within 10%: {x2["ok_within_10"]})')
lines.append('')
lines.append('| fixture | RTT | shared Mbps | per-frame Mbps | gap % | D_min S/P | pred |')
lines.append('|---|---|---|---|---|---|---|')
for p in x2['pairs']:
    lines.append(f'| {p["frame_bytes"]} B | {p["rtt_ms"]} | {p["shared_mbps"]} | {p["per_frame_mbps"]} | {p["gap_pct"]} | {p["shared_dmin"]}/{p["per_frame_dmin"]} | {p["pred_dmin"]} |')
lines.append('')
lines.append(f'## X3 — loss (D={x3_d}, 250 KB, 60 ms RTT)')
lines.append('')
lines.append('| loss % | shared p95 | per-frame p95 | per-frame better % |')
lines.append('|---|---|---|---|')
for d in detail:
    lines.append(f'| {d["loss_pct"]} | {d["shared_p95"]} | {d["per_frame_p95"]} | {d["per_frame_better_pct"]} |')
lines.append('')
lines.append(f'## Decision')
lines.append(f'- Rule: per-frame p95 better than shared by >15% at 0.5% loss → per-frame; else shared.')
lines.append(f'- **Chosen: `{decision}`**')
lines.append('')
lines.append('Evidence tier: T2 (harness under synthetic netem).')
Path(report).write_text('\n'.join(lines)+'\n')
json.dump({'x1_mbps': x1_mbps, 'x2': x2, 'x3': detail, 'decision': decision, 'x3_d': int(x3_d)},
          open(Path(out_dir)/'decision.json','w'), indent=2)
print('\n'.join(lines))
print(f'\nWrote {report}')
PY

echo "Done. Results in $OUT_DIR" >&2
