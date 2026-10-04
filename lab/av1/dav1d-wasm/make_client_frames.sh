#!/usr/bin/env bash
# The AV1 frames the client ships and tests with: one temporal unit each, as the store holds it.
#
#   client/downloader/warmup/{colour-8,grey-12}.av1     160x160 warm-ups, one per shape
#   client/conformance/av1/{g8,g10,g12,c8,c10,c12}.av1  90x70, with the generator's .sha256
#   client/conformance/av1/inter.av1                    a frame of a group: must not decode alone
#   client/conformance/av1/{s13,n13,n16}.av1            grey split top10+low: 13-bit, 13 and 16 signed
#   client/conformance/av1/r8.av1                       8-bit RGB as its reversible colour transform
#   client/conformance/av1/{yuv420,yuv444}.av1          colour as YUV: must be refused, not returned
#   client/conformance/av1/{g8x20,whole12}/NNN.av1      every unit of a G = 8 and a one-group stream
#
# Intra-only, which libaom 3.8.2 codes exactly at every depth; the groups without alt-ref frames,
# which it then codes exactly too — lab/av1/dav1d-wasm/README.md.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
BUILD="${BUILD:-$ROOT/lab/.av1-build}"
PY="$BUILD/venv/bin/python"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# raw pix_fmt w h channels gop keep out [yuv pix_fmt]: the raw frames coded lossless, unit `keep`
# kept; with a yuv pix_fmt, converted to it and tagged BT.709 — colour no decoder here returns as RGB
encode() {
  local raw=$1 fmt=$2 w=$3 h=$4 ch=$5 g=$6 keep=$7 out=$8 yuv=${9:-}
  local space=unknown
  [[ $ch == 3 ]] && space=rgb
  [[ -n $yuv ]] && space=bt709
  ffmpeg -v error -y -f rawvideo -pix_fmt "$fmt" -s "${w}x$h" -r 25 -i "$raw" ${yuv:+-pix_fmt "$yuv"} \
    -c:v libaom-av1 -aom-params lossless=1 -cpu-used 6 -g "$g" -keyint_min "$g" \
    -colorspace "$space" "$TMP/s.ivf"
  "$PY" - "$TMP/s.ivf" "$keep" "$out" <<'PY'
import struct, sys
buf, keep = open(sys.argv[1], "rb").read(), int(sys.argv[2])
at = struct.unpack_from("<H", buf, 6)[0]
for i in range(keep + 1):
    size = struct.unpack_from("<I", buf, at)[0]
    unit = buf[at + 12: at + 12 + size]
    at += 12 + size
open(sys.argv[3], "wb").write(unit)
PY
}

# out w h channels maxval mode frames gop [index of the unit kept]
frame() {
  local out=$1 w=$2 h=$3 ch=$4 maxval=$5 mode=$6 n=${7:-1} g=${8:-1} keep=${9:-0}
  local fmt
  case "$ch/$maxval" in
    1/255) fmt=gray ;; 1/1023) fmt=gray10le ;; 1/4095) fmt=gray12le ;;
    3/255) fmt=gbrp ;; 3/1023) fmt=gbrp10le ;; 3/4095) fmt=gbrp12le ;;
  esac
  : >"$TMP/in.raw"
  for ((i = 0; i < n; i++)); do
    "$PY" "$ROOT/lab/scripts/gen_frame_pnm.py" "$TMP/f.pnm" "$w" "$h" "$ch" "$maxval" $i "$n" "$mode"
    "$PY" "$(dirname "$0")/pnm_planar.py" "$TMP/f.pnm" >>"$TMP/in.raw"
    [[ $i -eq $keep ]] && cp "$TMP/f.pnm.sha256" "$TMP/kept.sha256"
  done
  encode "$TMP/in.raw" "$fmt" "$w" "$h" "$ch" "$g" "$keep" "$out"
  echo "$out: $(stat -c%s "$out") B"
}

W="$ROOT/client/downloader/warmup"
C="$ROOT/client/conformance/av1"
mkdir -p "$C"
frame "$W/colour-8.av1" 160 160 3 255 field
frame "$W/grey-12.av1" 160 160 1 4095 ct
for cell in "g8 1 255 ct" "g10 1 1023 ct" "g12 1 4095 ct" "c8 3 255 field" "c10 3 1023 field" "c12 3 4095 field"; do
  read -r name ch maxval mode <<<"$cell"
  frame "$C/$name.av1" 90 70 "$ch" "$maxval" "$mode"
  cp "$TMP/kept.sha256" "$C/$name.sha256"
done
frame "$C/inter.av1" 90 70 3 255 field 2 8 1

# out maxval offset split: a grey source as [u32le top length][top10 unit][low unit]
split() {
  local out=$1 maxval=$2 offset=$3 split=$4
  "$PY" "$ROOT/lab/scripts/gen_frame_pnm.py" "$TMP/f.pnm" 90 70 1 "$maxval" 0 1 ct
  "$PY" "$(dirname "$0")/split_planes.py" "$TMP/f.pnm" "$offset" "$split" "$TMP/p"
  encode "$TMP/p.top" gray10le 90 70 1 1 0 "$TMP/top.av1"
  encode "$TMP/p.low" gray 90 70 1 1 0 "$TMP/low.av1"
  "$PY" -c 'import struct,sys; t,l=(open(f,"rb").read() for f in sys.argv[1:3]); open(sys.argv[3],"wb").write(struct.pack("<I",len(t))+t+l)' \
    "$TMP/top.av1" "$TMP/low.av1" "$out"
  cp "$TMP/p.sha256" "${out%.av1}.sha256"
  echo "$out: $(stat -c%s "$out") B"
}
split "$C/s13.av1" 8191 0 3
split "$C/n13.av1" 8191 4096 3
split "$C/n16.av1" 65535 32768 6
"$PY" "$ROOT/lab/scripts/gen_frame_pnm.py" "$TMP/f.pnm" 90 70 3 255 0 1 field
"$PY" "$(dirname "$0")/rct_planes.py" "$TMP/f.pnm" >"$TMP/in.raw"
encode "$TMP/in.raw" gbrp10le 90 70 3 1 0 "$C/r8.av1"
cp "$TMP/f.pnm.sha256" "$C/r8.sha256"
echo "$C/r8.av1: $(stat -c%s "$C/r8.av1") B"
"$PY" "$ROOT/lab/scripts/gen_frame_pnm.py" "$TMP/f.pnm" 90 70 3 255 0 1 field
"$PY" "$(dirname "$0")/pnm_planar.py" "$TMP/f.pnm" >"$TMP/in.raw"
for yuv in yuv420 yuv444; do
  encode "$TMP/in.raw" gbrp 90 70 3 1 0 "$C/$yuv.av1" "${yuv}p"
  echo "$C/$yuv.av1: $(stat -c%s "$C/$yuv.av1") B"
done

# dir w h channels maxval mode frames gop: every unit as NNN.av1 beside its source's NNN.sha256
group() {
  local dir=$1 w=$2 h=$3 ch=$4 maxval=$5 mode=$6 n=$7 g=$8
  local fmt
  case "$ch/$maxval" in 1/4095) fmt=gray12le ;; 3/255) fmt=gbrp ;; esac
  rm -rf "$dir" && mkdir -p "$dir"
  : >"$TMP/in.raw"
  for ((i = 0; i < n; i++)); do
    "$PY" "$ROOT/lab/scripts/gen_frame_pnm.py" "$TMP/f.pnm" "$w" "$h" "$ch" "$maxval" $i "$n" "$mode"
    "$PY" "$(dirname "$0")/pnm_planar.py" "$TMP/f.pnm" >>"$TMP/in.raw"
    cp "$TMP/f.pnm.sha256" "$dir/$(printf %03d $i).sha256"
  done
  ffmpeg -v error -y -f rawvideo -pix_fmt "$fmt" -s "${w}x$h" -r 25 -i "$TMP/in.raw" \
    -c:v libaom-av1 -aom-params lossless=1 -cpu-used 6 -g "$g" -keyint_min "$g" -auto-alt-ref 0 \
    -colorspace "$([[ $ch == 3 ]] && echo rgb || echo unknown)" "$TMP/s.ivf"
  "$PY" - "$TMP/s.ivf" "$dir" <<'PY'
import struct, sys
buf, i = open(sys.argv[1], "rb").read(), 0
at = struct.unpack_from("<H", buf, 6)[0]
while at < len(buf):
    size = struct.unpack_from("<I", buf, at)[0]
    open(f"{sys.argv[2]}/{i:03d}.av1", "wb").write(buf[at + 12: at + 12 + size])
    at, i = at + 12 + size, i + 1
PY
  echo "$dir: $n units, $(cat "$dir"/*.av1 | wc -c) B"
}
group "$C/g8x20" 64 48 3 255 cine 20 8
group "$C/whole12" 64 48 1 4095 ct 12 12
