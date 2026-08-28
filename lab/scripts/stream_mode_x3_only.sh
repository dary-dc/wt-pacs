#!/usr/bin/env bash
# X3-only re-run after full campaign (short trace). Requires netns.
#   unshare --user --map-root-user --net -- bash lab/scripts/stream_mode_x3_only.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT_DIR="${OUT_DIR:-$ROOT/.local/measurements/stream-mode-decision}"
CERT="$ROOT/server/dev-cert/cert.pem"
KEY="$ROOT/server/dev-cert/key.pem"
PORT="${PORT:-4440}"
export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-$ROOT/target}"
SERVER="$CARGO_TARGET_DIR/release/exact-server"
HARNESS="$CARGO_TARGET_DIR/release/window-harness"
STUDY="$ROOT/lab/fixtures/frames_250k/frames_250k.sbnd"
TRACE="$ROOT/lab/traces/x3_short_scroll.json"
LINK_MBPS=10
X3_D="${X3_D:-4}"
RAW_DIR="$OUT_DIR/raw"
mkdir -p "$RAW_DIR"
TSV="$OUT_DIR/results.tsv"

spid=""
cleanup() { kill "$spid" 2>/dev/null || true; wait "$spid" 2>/dev/null || true; tc qdisc del dev lo root 2>/dev/null || true; }
trap cleanup EXIT
ip link set lo up

set_netem() {
  local rtt_ms=$1 loss_pct=$2
  local one_way; one_way=$(python3 -c "print(max(0.001, float($rtt_ms)/2.0))")
  tc qdisc del dev lo root 2>/dev/null || true
  if [[ "$loss_pct" == "0" ]]; then
    tc qdisc add dev lo root netem delay "${one_way}ms" rate "${LINK_MBPS}mbit"
  else
    tc qdisc add dev lo root netem delay "${one_way}ms" rate "${LINK_MBPS}mbit" loss "${loss_pct}%"
  fi
  echo "netem delay=${one_way}ms rate=${LINK_MBPS}mbit loss=${loss_pct}%" >&2
}

# Drop prior FAIL X3 rows if re-running
if [[ -f "$TSV" ]]; then
  python3 - "$TSV" <<'PY'
import sys
from pathlib import Path
p=Path(sys.argv[1])
lines=p.read_text().splitlines()
hdr=lines[0]
keep=[hdr]+[l for l in lines[1:] if not l.startswith('X3\t')]
p.write_text('\n'.join(keep)+'\n')
PY
fi

for loss in 0 0.1 0.5 2; do
  for mode in shared per-frame; do
    set_netem 60 "$loss"
    kill "$spid" 2>/dev/null || true; wait "$spid" 2>/dev/null || true
    fuser -k "${PORT}/udp" 2>/dev/null || true
    sleep 0.3
    "$SERVER" --port "$PORT" --study "$STUDY" --cert-pem "$CERT" --key-pem "$KEY" \
      --stream-mode "$mode" >"$RAW_DIR/x3server.log" 2>&1 &
    spid=$!
    sleep 1.0
    json="$RAW_DIR/X3_${mode}_loss${loss}_d${X3_D}_trace.json"
    set +e
    timeout 300 "$HARNESS" --url "https://127.0.0.1:${PORT}/" --mode trace \
      --trace "$TRACE" --read-bps 0 --depth "$X3_D" --frame-count 80 \
      --fill-dwell-ms 0 --stream-mode "$mode" --timeout-ms 120000 \
      --arm "X3_${mode}_loss${loss}" --json >"$json" 2>"$json.err"
    rc=$?
    set -e
    if [[ $rc -ne 0 ]]; then
      echo -e "X3\t${mode}\tframes_250k.sbnd\t250000\t60\t${loss}\t${X3_D}\t-\t-\tFAIL\tFAIL\t-\t-\tretry harness_rc=${rc}" >> "$TSV"
      echo "FAIL X3 ${mode} loss=${loss} rc=${rc}" >&2
      cat "$json.err" >&2 || true
      continue
    fi
    python3 - "$json" "$TSV" "$mode" "$loss" "$X3_D" <<'PY'
import json,sys
m=json.load(open(sys.argv[1]))
tsv, mode, loss, d = sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5]
p95=m.get('p95_wait_ms',0); mean=m.get('mean_wait_ms',0)
peak=m.get('peak_outstanding',0); asks=m.get('asks_sent',0)
with open(tsv,'a') as f:
    f.write(f"X3\t{mode}\tframes_250k.sbnd\t250000\t60\t{loss}\t{d}\t-\t-\t{p95}\t{mean}\t{peak}\t{asks}\tshort-trace\n")
print(f"OK X3 {mode} loss={loss} p95={p95} mean={mean} peak={peak} asks={asks}")
PY
  done
done

python3 - "$TSV" "$OUT_DIR" <<'PY'
import csv, json, sys
from pathlib import Path
tsv, out_dir = sys.argv[1], sys.argv[2]
rows=list(csv.DictReader(open(tsv), delimiter='\t'))
x1=[r for r in rows if r['phase']=='X1' and r['mbps'] not in ('FAIL','-')]
x2=json.load(open(Path(out_dir)/'x2_summary.json'))
x3=[r for r in rows if r['phase']=='X3' and r['p95_wait_ms'] not in ('FAIL','-','')]
by={}
for r in x3:
    try: p95=float(r['p95_wait_ms'])
    except: continue
    by.setdefault(r['loss_pct'], {})[r['mode']]=p95
detail=[]; decision='undecided'
for loss in ['0','0.1','0.5','2']:
    m=by.get(loss,{})
    if 'shared' in m and 'per-frame' in m:
        s,p=m['shared'],m['per-frame']
        gap=((s-p)/s*100) if s>0 else 0
        detail.append({'loss_pct':float(loss),'shared_p95':s,'per_frame_p95':p,'per_frame_better_pct':round(gap,2)})
        if loss=='0.5':
            decision='per-frame' if gap>15 else 'shared'
x1_mbps=float(x1[0]['mbps']) if x1 else None
lines=[
'# Stream mode decision — experiment report','',
'**Date:** 2026-08-28 · **Campaign:** `docs/stream-mode-decision-experiments.md`','',
'## X1 — finish() gate',
f'- Measured: **{x1_mbps} Mbps** (need ≥ 8.0)',
f'- Result: **{"PASS" if x1_mbps and x1_mbps>=8 else "FAIL"}**','',
'## X2 — lossless mode comparison',
f'- Max gap between modes: **{x2["max_gap_pct"]}%** (ok within 10%: {x2["ok_within_10"]})',
'',
'| fixture | RTT | shared Mbps | per-frame Mbps | gap % | D_min S/P | pred |',
'|---|---|---|---|---|---|---|',
]
for p in x2['pairs']:
    lines.append(f'| {p["frame_bytes"]} B | {p["rtt_ms"]} | {p["shared_mbps"]} | {p["per_frame_mbps"]} | {p["gap_pct"]} | {p["shared_dmin"]}/{p["per_frame_dmin"]} | {p["pred_dmin"]} |')
lines += ['',
'## X3 — loss (short scroll, D=4, 250 KB, 60 ms RTT)','',
'| loss % | shared p95 | per-frame p95 | per-frame better % |','|---|---|---|---|']
for d in detail:
    lines.append(f'| {d["loss_pct"]} | {d["shared_p95"]} | {d["per_frame_p95"]} | {d["per_frame_better_pct"]} |')
lines += ['','## Decision',
'- Rule: per-frame p95 better than shared by >15% at 0.5% loss → per-frame; else shared.',
f'- **Chosen: `{decision}`**','',
'Notes:',
'- X2 gaps >10% at RTT=150 ms — 250 KB cells are quantized (±1 Mbps at 2s dwell); 51 KB gap is real (~18%).',
'- X3 uses `lab/traces/x3_short_scroll.json` (80 steps) after mild_cell timed out.',
'',
'Evidence tier: T2 (harness under synthetic netem).']
Path(out_dir,'REPORT.md').write_text('\n'.join(lines)+'\n')
json.dump({'x1_mbps':x1_mbps,'x2':x2,'x3':detail,'decision':decision,'x3_d':4},
          open(Path(out_dir)/'decision.json','w'), indent=2)
print('\n'.join(lines))
PY
