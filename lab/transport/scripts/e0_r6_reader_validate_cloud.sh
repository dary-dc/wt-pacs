#!/usr/bin/env bash
# E0-R6a on the real path — can this path still generate head-of-line blocking? Its absence
# invalidated four campaigns, so a failure voids the campaign before it runs. Passes only if,
# in one cell, --reader-mode open shows lag and stranded bytes where closed shows neither.
# Usage: DELAY=25 RATE=20 LOSS=0.1 lab/transport/scripts/e0_r6_reader_validate_cloud.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
source "$ROOT/lab/transport/scripts/cloud_r6_common.sh"

FIXTURE="${FIXTURE:-frames_500x64k}"
TRACE="${TRACE:-$ROOT/lab/traces/radiologist_review_500.json}"
DEPTH=${DEPTH:-8}; CACHE=${CACHE:-64}
DELAY=${DELAY:-25}; RATE=${RATE:-20}; LOSS=${LOSS:-0.1}
SCALE=${SCALE:-1}
OUTDIR="${OUTDIR:-$ROOT/.local/measurements/r6/e0_cloud}"
mkdir -p "$OUTDIR"

[[ -x "$HARNESS" ]] || { echo "missing $HARNESS — cargo build --release -p window-harness" >&2; exit 1; }

r6_sync_scripts
r6_upload_server
STUDY=$(r6_upload_fixture "$ROOT/lab/fixtures/$FIXTURE/$FIXTURE.sbnd")
r6_netem "$DELAY" "$RATE" "$LOSS" >/dev/null

run_one() {
  local mode=$1 sm=$2
  r6_start_server "$STUDY" --stream-mode "$sm" >/dev/null
  timeout "${RUN_TIMEOUT:-300}" "$HARNESS" --url "$CLOUD_URL" --mode trace --trace "$TRACE" \
    --read-bps 0 --depth "$DEPTH" --frame-count 500 --stream-mode "$sm" \
    --cache-frames "$CACHE" --reader-mode "$mode" --step-scale "$SCALE" \
    --arm "e0r6_${mode}_${sm}" --json \
    > "$OUTDIR/e0r6_${mode}_${sm}.json" 2>/dev/null || echo "  (harness exit $?)"
  python3 - "$OUTDIR/e0r6_${mode}_${sm}.json" "$mode" "$sm" <<'PY'
import json,sys
try: m=json.load(open(sys.argv[1]))
except Exception as e: print(f"  {sys.argv[2]:6s} {sys.argv[3]:9s} NO JSON: {e}"); raise SystemExit
nz=[x for x in m.get("wait_ms",[]) if x>0]
print(f"  {sys.argv[2]:6s} {sys.argv[3]:9s} "
      f"lag={m['reader_lag_ms']:9.0f}ms strand={m['stranded_frames']:5d}f/{m['stranded_bytes']/1e6:6.2f}MB "
      f"cens={m['censored_waits']:4d}({m['censored_frac']*100:5.1f}%) cdrop={m['center_asks_dropped']:4d} "
      f"p95={m['p95_wait_ms']:8.1f} nz_n={len(nz):4d} peak={m['peak_outstanding']:3d} "
      f"frames={m['frames_on_wire']}")
PY
}

echo "path: rig $CLOUD_HOST, netem +${DELAY} ms one-way egress, ${RATE} Mbps, ${LOSS}% loss (egress only)"
echo "cell: depth $DEPTH, cache $CACHE, step-scale $SCALE, trace $(basename "$TRACE")"
echo "shared stream:"
run_one closed shared
run_one open   shared
echo "per-frame streams:"
run_one closed per-frame
run_one open   per-frame

echo
python3 - "$OUTDIR" <<'PY'
import json,os,sys
d=sys.argv[1]
def g(f):
    try: return json.load(open(os.path.join(d,f)))
    except Exception: return None
ok=True
for sm in ("shared","per-frame"):
    c=g(f"e0r6_closed_{sm}.json"); o=g(f"e0r6_open_{sm}.json")
    if not c or not o: print(f"GATE {sm}: missing run"); ok=False; continue
    cs, os_ = c["stranded_bytes"], o["stranded_bytes"]
    good = cs==0 and os_>0
    ok &= good
    print(f"GATE {sm:9s}: closed={cs/1e6:.2f} MB  open={os_/1e6:.2f} MB  -> {'PASS' if good else 'FAIL'}")
print()
print("E0-R6a PASS — the real path produces head-of-line blocking; arm comparison admissible"
      if ok else
      "E0-R6a FAIL — STOP. The reader is not outrunning the transport here; no arm comparison is admissible.")
raise SystemExit(0 if ok else 1)
PY
