#!/usr/bin/env bash
# GSO segment cap on real hardware — netsim voids this by construction. Two binaries from
# quinn_lab_build.sh differing only in the compile-time cap. Shaping OFF, or both arms sit
# at the cap; the cost is that the path may set the ceiling, so server CPU / wall is
# reported and the throughput half is untestable below 1.0.
# Usage: REPS=5 DWELL_MS=15000 lab/scripts/r6_gso_cpu_cloud.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
source "$ROOT/lab/scripts/cloud_r6_common.sh"

FIXTURE="${FIXTURE:-frames_500x64k}"
REPS="${REPS:-5}"
DWELL_MS="${DWELL_MS:-15000}"
DEPTH="${DEPTH:-8}"
SEGS="${SEGS:-10 32}"
SHAPE="${SHAPE:-off}"          # `off`, or "delay rate loss" to shape first
OUT="${OUT:-$ROOT/.local/measurements/r6/gso_cpu.tsv}"
mkdir -p "$(dirname "$OUT")"

[ -s "$OUT" ] || printf 'seg\trep\tshape\tdwell_ms\tfill_bytes\tfill_frames\twall_s\tmbps\tsrv_cpu_s\tsrv_cpu_frac\tcpu_us_per_MB\n' > "$OUT"

r6_sync_scripts
STUDY_LOCAL="$ROOT/lab/fixtures/$FIXTURE/$FIXTURE.sbnd"

if [[ "$SHAPE" == "off" ]]; then r6_netem off >/dev/null; else r6_netem $SHAPE >/dev/null; fi

# Interleaved within each repeat: the rig is a shared VM and host drift is not common-mode.
for REP in $(seq 1 "$REPS"); do
  for SEG in $SEGS; do
    r6_upload_server "$ROOT/target/lab-arms/exact-server-seg$SEG"
    STUDY=$(r6_upload_fixture "$STUDY_LOCAL")
    PID=$(r6_start_server "$STUDY" --stream-mode shared)
    C0=$(r6_srv_cpu "$PID"); W0=$(date +%s.%N)
    timeout 180 "$HARNESS" --url "$CLOUD_URL" --mode saturate --fill-dwell-ms "$DWELL_MS" \
      --frame-count 500 --depth "$DEPTH" --stream-mode shared --read-bps 0 --rtt-ms 0 \
      --arm "seg$SEG" --json > /tmp/r6_gso.json 2>/dev/null || true
    W1=$(date +%s.%N); C1=$(r6_srv_cpu "$PID")
    python3 - "$SEG" "$REP" "$SHAPE" "$DWELL_MS" "$C0" "$C1" "$W0" "$W1" "$OUT" <<'PY'
import json,sys
seg,rep,shape,dwell,c0,c1,w0,w1,out = sys.argv[1:10]
try: m=json.load(open("/tmp/r6_gso.json"))
except Exception:
    print(f"seg{seg} rep{rep}: NO JSON"); raise SystemExit
wall=float(w1)-float(w0); cpu=float(c1)-float(c0)
fb=m["fill_bytes"]; ff=m["fill_frames"]; d=m["fill_dwell_ms"]/1000
mbps=fb*8/d/1e6 if d else 0
cpu_per_mb = cpu*1e6/(fb/1e6) if fb else 0     # microseconds of server CPU per MB
frac = cpu/wall if wall else 0
print(f"  seg{seg:<3} rep{rep}  {mbps:7.2f} Mbps  srv_cpu {cpu:6.3f}s ({frac*100:5.1f}% of wall)  "
      f"{cpu_per_mb:9.0f} us/MB  fill {fb/1e6:6.2f} MB")
open(out,"a").write("\t".join([seg,rep,shape,dwell,str(fb),str(ff),f"{wall:.2f}",
    f"{mbps:.3f}",f"{cpu:.3f}",f"{frac:.4f}",f"{cpu_per_mb:.0f}"])+"\n")
PY
  done
done
r6_stop_server || true
echo "--- $OUT"
python3 - "$OUT" <<'PY'
import sys,statistics as st
from collections import defaultdict
rows=[l.rstrip("\n").split("\t") for l in open(sys.argv[1]) if l.strip()]
h,b=rows[0],rows[1:]
d=[dict(zip(h,r)) for r in b]
by=defaultdict(list)
for r in d: by[r["seg"]].append(r)
print(f"\n{'seg':>4} {'n':>3} {'mbps med':>10} {'cpu us/MB med':>15} {'cpu frac med':>13}")
med={}
for seg in sorted(by,key=int):
    rs=by[seg]
    mb=st.median(float(r["mbps"]) for r in rs)
    cu=st.median(float(r["cpu_us_per_MB"]) for r in rs)
    cf=st.median(float(r["srv_cpu_frac"]) for r in rs)
    med[seg]=(mb,cu,cf)
    print(f"{seg:>4} {len(rs):>3} {mb:10.2f} {cu:15.0f} {cf:13.3f}")
if "10" in med and "32" in med:
    t=(med["32"][0]-med["10"][0])/med["10"][0]*100
    c=(med["32"][1]-med["10"][1])/med["10"][1]*100
    print(f"\nseg32 vs seg10:  throughput {t:+.1f} %   CPU/byte {c:+.1f} %")
    print(f"published claim: throughput +17 %      CPU/byte -21 %")
    if med["10"][2] < 0.7:
        print(f"\nNOTE: server CPU is only {med['10'][2]*100:.0f} % of wall — the ceiling here is the")
        print( "      path, not the send path. The throughput half of the claim is NOT testable")
        print( "      on this rig; read the CPU/byte column only.")
PY
