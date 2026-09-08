#!/usr/bin/env bash
# E0 — how many datagrams go in one GSO batch, and what that does to the loss model.
# The qdisc accounting this rests on: docs/measurements/r6/r6cloud-results.md 3.2.
# Usage: LOSS=1.0 lab/scripts/e0_gso_batch_check_cloud.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
source "$ROOT/lab/scripts/cloud_r6_common.sh"

FIXTURE="${FIXTURE:-frames_500x64k}"
DELAY="${DELAY:-25}"; RATE="${RATE:-20}"; LOSS="${LOSS:-1.0}"
DWELL_MS="${DWELL_MS:-15000}"
DEPTH="${DEPTH:-8}"
OUT="${OUT:-$ROOT/.local/measurements/r6/gso_batch.tsv}"
mkdir -p "$(dirname "$OUT")"
[ -s "$OUT" ] || printf 'seg_cap\tgso\tloss_pct\tdatagrams\tbytes\tbatch_drops\tmean_bytes_per_dgram\timplied_batch\n' > "$OUT"

r6_sync_scripts
STUDY_LOCAL="$ROOT/lab/fixtures/$FIXTURE/$FIXTURE.sbnd"

probe() {   # probe <seg_cap binary suffix> <gso true|false>
  local seg=$1 gso=$2
  r6_upload_server "$ROOT/target/lab-arms/exact-server-seg$seg"
  local study; study=$(r6_upload_fixture "$STUDY_LOCAL")
  # Reinstall the qdisc so the counters start at zero for this probe only.
  r6_netem "$DELAY" "$RATE" "$LOSS" >/dev/null
  r6_start_server "$study" --stream-mode shared --segmentation-offload "$gso" >/dev/null
  timeout 120 "$HARNESS" --url "$CLOUD_URL" --mode saturate --fill-dwell-ms "$DWELL_MS" \
    --frame-count 500 --depth "$DEPTH" --stream-mode shared --read-bps 0 --rtt-ms 0 \
    --arm "gsoprobe" --json > /tmp/r6_gsoprobe.json 2>/dev/null || true
  "${SSH[@]}" "tc -s -j qdisc show dev \$(ip route show default | awk '{print \$5}' | head -1)" \
    > /tmp/r6_tc.json 2>/dev/null || true
  python3 - "$seg" "$gso" "$LOSS" "$OUT" <<'PY'
import json,sys
seg,gso,loss,out = sys.argv[1:5]
L=float(loss)/100.0
try: qs=json.load(open("/tmp/r6_tc.json"))
except Exception: print("  no tc json"); raise SystemExit
q=next((x for x in qs if x.get("kind")=="netem"), None)
if not q: print("  no netem qdisc"); raise SystemExit
dgrams=int(q.get("packets",0)); byts=int(q.get("bytes",0)); drops=int(q.get("drops",0))
mean=byts/dgrams if dgrams else 0
batch=(dgrams*L)/drops if drops else float("nan")
print(f"  seg{seg:<3} gso={gso:<5} loss={loss}%  datagrams={dgrams:7d}  bytes={byts/1e6:7.2f} MB  "
      f"batch_drops={drops:5d}  mean={mean:6.0f} B/dgram  implied batch={batch:5.1f} datagrams/skb")
open(out,"a").write("\t".join([seg,gso,loss,str(dgrams),str(byts),str(drops),
    f"{mean:.0f}",f"{batch:.2f}"])+"\n")
PY
}

echo "GSO batch probe — rig egress netem +${DELAY} ms, ${RATE} Mbps, ${LOSS}% loss"
echo "  implied batch = (datagrams x loss) / batch_drops ; expect ~1 with GSO off"
probe 10 true
probe 10 false
probe 32 true
r6_stop_server || true
echo "--- $OUT"
