#!/usr/bin/env bash
# Builds one lossless 10-bit grey AV1 sequence, remuxes it into each container, and prints each one's frame table.
# docs/video-containers/guide.md walks through the output.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
out=${OUT:-$here/out}
frames=${FRAMES:-160}
mkdir -p "$out/j2k"
cd "$out"

src="testsrc2=size=256x256:rate=10,format=gray10le"
# -lag-in-frames 0: libaom 3.8 in good mode asserts past ~32 lossless keyframes without it.
ffmpeg -hide_banner -loglevel error -y -f lavfi -i "$src" -frames:v "$frames" \
  -c:v libaom-av1 -cpu-used 8 -lag-in-frames 0 -aom-params lossless=1 -pix_fmt gray10le -g 1 -keyint_min 1 src.ivf

remux() { ffmpeg -hide_banner -loglevel error -y -i src.ivf -c copy "$@"; }
remux -f obu raw.obu
remux plain.mp4
remux -movflags +faststart faststart.mp4
remux -movflags +frag_every_frame+empty_moov+default_base_moof frag.mp4
remux plain.mkv
remux -cues_to_front 1 cuesfront.mkv
remux plain.webm

want=$(ffmpeg -v error -f lavfi -i "$src" -frames:v "$frames" -f rawvideo - | sha256sum | cut -c1-16)
for f in src.ivf raw.obu ./*.mp4 ./*.mkv ./*.webm; do
  got=$(ffmpeg -v error -i "$f" -f rawvideo -pix_fmt gray10le - | sha256sum | cut -c1-16)
  [[ $got == "$want" ]] || { echo "not exact: $f" >&2; exit 1; }
done
echo "every file decodes to the source samples ($want)"
ffmpeg -v error -f lavfi -i "$src" -frames:v "$frames" -f rawvideo - > source.gray10le

python3 -I "$here/frame_table.py" src.ivf raw.obu plain.mp4 faststart.mp4 frag.mp4 plain.mkv cuesfront.mkv plain.webm
echo; python3 -I "$here/mp4_walk.py" faststart.mp4
echo; python3 -I "$here/ebml_walk.py" cuesfront.mkv | grep -v 'Cluster @'

ffmpeg -hide_banner -loglevel error -y -f lavfi -i "testsrc2=size=256x256:rate=10,format=gray12le" -frames:v 16 \
  -c:v jpeg2000 -pred 1 -format j2k -pix_fmt gray12le j2k/f%03d.j2k
echo; python3 -I "$here/dicom_eot.py" j2k multiframe.dcm
