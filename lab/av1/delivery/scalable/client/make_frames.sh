#!/usr/bin/env bash
# The scalable AV1 units the dispatch rig decodes: two spatial layers, a half-size lossy base (q 40)
# under a lossless top, one temporal unit per file, as the store holds it.
#   client/contract/av1/scalable/{l2g1,l2g8x20}/NNN.av1   every unit of a G = 1 and a G = 8 stream
#   …/NNN.sha256           the top's truth: the generator's checksum of the encoder's input
#   …/NNN.preview.sha256   the base, lossy, as native dav1d returns it at operating point 1
#   client/contract/av1/scalable/notop.av1              l2g1's unit 1 with the top's OBUs dropped
# Needs lab/av1/delivery/scalable/encoder/build.sh (the patched svc_encoder_rtc) and client/decode/wasm/dav1d/build.sh (native
# dav1d). docs/av1/adr-unit.md §6
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../../../.." && pwd)"
BUILD="${BUILD:-$ROOT/lab/.av1-build}"
PY="$BUILD/venv/bin/python"
ENC="$BUILD/aom-3.15.1-svc-b/svc_encoder_rtc"
DAV1D="$BUILD/native/tools/dav1d"
OUT="$ROOT/client/contract/av1/scalable"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# dir w h bits mode frames gop
scalable() {
  local dir=$1 w=$2 h=$3 bits=$4 mode=$5 n=$6 g=$7
  rm -rf "$dir" && mkdir -p "$dir"
  for ((i = 0; i < n; i++)); do
    "$PY" "$ROOT/lab/scripts/gen_frame_pnm.py" "$TMP/$i.pnm" "$w" "$h" 1 $(((1 << bits) - 1)) $i "$n" "$mode"
    cp "$TMP/$i.pnm.sha256" "$dir/$(printf %03d $i).sha256"
  done
  "$PY" "$(dirname "$0")/units.py" y4m "$TMP/in.y4m" "$bits" $(seq -f "$TMP/%g.pnm" 0 $((n - 1)))
  # Two spatial layers, the top predicted from the base (layering mode 5); lab/av1/delivery/scalable/two-layer/svcq.py's cell.
  "$ENC" -o "$TMP/s.ivf" -lm 5 -sl 2 -tl 1 -b 1200000 -bl 600000,600000 --min-q=0 --max-q=0 \
    --layer-q=40,0 -k "$g" -sp 7 -d "$bits" "--profile=$([[ $bits == 12 ]] && echo 2 || echo 0)" \
    --monochrome "$TMP/in.y4m" >/dev/null
  "$DAV1D" -q -i "$TMP/s.ivf" --oppoint 1 --alllayers 0 -o "$TMP/base.y4m"
  "$PY" "$(dirname "$0")/units.py" split "$TMP/s.ivf" "$TMP/base.y4m" "$dir"
  echo "$dir: $n units, $(cat "$dir"/*.av1 | wc -c) B"
}

scalable "$OUT/l2g1" 64 48 10 ct 4 1
scalable "$OUT/l2g8x20" 64 48 12 ct 20 8
"$PY" "$(dirname "$0")/units.py" drop-top "$OUT/l2g1/001.av1" "$OUT/notop.av1"
echo "$OUT/notop.av1: $(stat -c%s "$OUT/notop.av1") B"
