#!/usr/bin/env bash
# E0-R6b on the real path: find the reader speed at which a comparison is admissible.
# The band, the REPS guard and why SRV_EXTRA must match the campaign:
# docs/transport/measurements/r6/step-scale-calibration.md.
# Usage: DELAY=25 RATE=20 LOSS=0.1 SCALES="1 2 4 8" [REPS=3] e0_r6_calibrate_cloud.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
source "$ROOT/lab/transport/scripts/cloud_r6_common.sh"

FIXTURE="${FIXTURE:-frames_500x64k}"
TRACE="${TRACE:-$ROOT/lab/traces/radiologist_review_500.json}"
DEPTH=${DEPTH:-8}; CACHE=${CACHE:-64}
DELAY=${DELAY:-25}; RATE=${RATE:-20}; LOSS=${LOSS:-0.1}
SCALES=${SCALES:-"1 2 4 8"}
REPS=${REPS:-1}
# N0 inverts `stranded_frames > 0`, as r6_row.py's STRANDING_CELLS does.
CONTROL=${CONTROL:-0}
# Must carry whatever the campaign puts on BOTH arms, or the frozen point is not valid
# for the condition it will be used in.
SRV_EXTRA="${SRV_EXTRA:-}"
OUTDIR="${OUTDIR:-$ROOT/.local/measurements/r6/cal_cloud}"
TSV="${TSV:-$OUTDIR/calibration.tsv}"
mkdir -p "$OUTDIR"

[[ -x "$HARNESS" ]] || { echo "missing $HARNESS" >&2; exit 1; }

r6_sync_scripts
r6_upload_server
STUDY=$(r6_upload_fixture "$ROOT/lab/fixtures/$FIXTURE/$FIXTURE.sbnd")
r6_netem "$DELAY" "$RATE" "$LOSS" >/dev/null

[ -s "$TSV" ] || printf 'delay_ms\trate_mbps\tloss_pct\ttrace\tscale\trep\tlag_ms\tstrand\tcens_frac\tcdrop\tp95\tnz_n\tframes\tadmissible\n' > "$TSV"

echo "cell: rig egress netem +${DELAY} ms one-way, ${RATE} Mbps, ${LOSS}% loss; base path RTT adds on top"
echo "      depth $DEPTH, cache $CACHE, trace $(basename "$TRACE"), reps $REPS"
echo "      fixture $FIXTURE, server extra flags: ${SRV_EXTRA:-<none>}"
printf '%8s %5s %9s %8s %9s %8s %10s %8s %8s\n' scale rep lag_ms strand cens% cdrop p95 nz_n frames
for SC in $SCALES; do
  for REP in $(seq 1 "$REPS"); do
    read -r -a EXTRA <<< "$SRV_EXTRA"
    r6_start_server "$STUDY" --stream-mode shared "${EXTRA[@]}" >/dev/null
    timeout "${RUN_TIMEOUT:-600}" "$HARNESS" --url "$CLOUD_URL" --mode trace --trace "$TRACE" \
      --read-bps 0 --depth "$DEPTH" --frame-count 500 --stream-mode shared \
      --cache-frames "$CACHE" --reader-mode open --step-scale "$SC" --arm "cal_$SC" --json \
      > "$OUTDIR/cal_${LOSS}_${SC}_${REP}.json" 2>/dev/null || true
    python3 - "$SC" "$REP" "$OUTDIR/cal_${LOSS}_${SC}_${REP}.json" "$TSV" \
             "$DELAY" "$RATE" "$LOSS" "$(basename "$TRACE" .json)" "$CONTROL" <<'PY'
import json,sys
sc,rep,jf,tsv,delay,rate,loss,trace,control = sys.argv[1:10]
control = control == "1"
try: m=json.load(open(jf))
except Exception:
    print(f"{sc:>8} {rep:>5} {'NO JSON':>9}")
    open(tsv,"a").write(f"{delay}\t{rate}\t{loss}\t{trace}\t{sc}\t{rep}\tnan\t0\tnan\t0\tnan\t0\t0\tNO-JSON\n")
    raise SystemExit
nz=[x for x in m.get("wait_ms",[]) if x>0]
strand_ok = (m['stranded_frames']==0) if control else (m['stranded_frames']>0)
ok = (m['center_asks_dropped']==0 and strand_ok
      and m['censored_frac']<=0.25 and len(nz)>=30)
print(f"{sc:>8} {rep:>5} {m['reader_lag_ms']:9.0f} {m['stranded_frames']:8d} "
      f"{m['censored_frac']*100:8.1f}% {m['center_asks_dropped']:8d} {m['p95_wait_ms']:10.1f} "
      f"{len(nz):8d} {m['frames_on_wire']:8d}  "
      f"{('CONTROL-OK' if control else 'ADMISSIBLE') if ok else 'NOT-ADMISSIBLE'}")
open(tsv,"a").write("\t".join([delay,rate,loss,trace,sc,rep,
    f"{m['reader_lag_ms']:.1f}", str(m['stranded_frames']), f"{m['censored_frac']:.4f}",
    str(m['center_asks_dropped']), f"{m['p95_wait_ms']:.2f}", str(len(nz)),
    str(m['frames_on_wire']), "yes" if ok else "no"])+"\n")
PY
  done
done
echo "--- $TSV"
