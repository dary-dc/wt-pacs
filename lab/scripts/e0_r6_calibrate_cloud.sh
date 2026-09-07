#!/usr/bin/env bash
# E0-R6b on the REAL PATH — find the reader speed at which a stream-shape comparison is
# admissible in a given cell, on the rig rather than in netsim.
#
# The operating point is not a free parameter to be chosen after seeing arm results. It is
# calibrated ONCE per cell on the incumbent arm (shared stream) and then FROZEN across
# every arm. Tuning it per-arm would let the rig be shaped to fit whichever answer had
# started to look right — which is how three previous campaigns went wrong.
#
# Admissible band, fixed in docs/lanes/R6-preregistration.md before any arm runs:
#   center_asks_dropped == 0     the frame being measured was always actually asked for
#   stranded_frames     >  0     something arrived that the reader no longer wanted
#   censored_frac       <= 0.25  the arm did not simply collapse
#   nz_n                >= 30    there is a tail to take a percentile of
#
# E0-R6c, TRANSLATED FOR THIS INSTRUMENT. Under netsim the lesson was "re-check the chosen
# scale at every campaign SEED", because netsim's loss is a seeded PRNG and scale 6 was
# clean at seed 4242 and then voided 4 of 9 campaign rows. sch_netem has no seed: its loss
# is drawn from kernel randomness and every run is already an independent realisation. The
# guard therefore becomes REPS — re-run the chosen scale N times and require the band to
# hold in EVERY repetition, not just the first. Same guard, same failure it catches.
#
# Usage: DELAY=25 RATE=20 LOSS=0.1 SCALES="1 2 4 8" lab/scripts/e0_r6_calibrate_cloud.sh
#        DELAY=25 RATE=20 LOSS=1.0 SCALES="4" REPS=3 lab/scripts/e0_r6_calibrate_cloud.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
source "$ROOT/lab/scripts/cloud_r6_common.sh"

FIXTURE="${FIXTURE:-frames_500x64k}"
TRACE="${TRACE:-$ROOT/lab/traces/radiologist_review_500.json}"
DEPTH=${DEPTH:-8}; CACHE=${CACHE:-64}
DELAY=${DELAY:-25}; RATE=${RATE:-20}; LOSS=${LOSS:-0.1}
SCALES=${SCALES:-"1 2 4 8"}
REPS=${REPS:-1}
# N0 is the negative control: its whole job is that the reader does NOT outrun the link,
# so `stranded_frames > 0` is inverted there rather than dropped. r6_row.py encodes the
# same asymmetry (STRANDING_CELLS = {X1, X2}); without this flag the control's own passing
# rows print as NOT-ADMISSIBLE, which is exactly the kind of label that gets misread later.
CONTROL=${CONTROL:-0}
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
printf '%8s %5s %9s %8s %9s %8s %10s %8s %8s\n' scale rep lag_ms strand cens% cdrop p95 nz_n frames
for SC in $SCALES; do
  for REP in $(seq 1 "$REPS"); do
    r6_start_server "$STUDY" --stream-mode shared >/dev/null
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
