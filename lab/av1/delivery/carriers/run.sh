#!/usr/bin/env bash
# Row CARRIERS end to end (docs/av1/profile-carriers.md §4): tools, content, mutations, rounds, tables.
#   lab/av1/delivery/carriers/run.sh [tools|content|mutate|rounds|tables ...]   default: all five, in order
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
cd "$ROOT"
BUILD="$ROOT/lab/.av1-build" P=lab/av1/.venv/bin/python W=lab/.av1-work C=lab/av1/delivery/carriers T=lab/av1/delivery/scalable/tool
SETS=(lab/av1/data/dbts_a1 lab/av1/data/dbts_b1 lab/av1/data/dbts_c1)
ROWS="$W/carriers-rows.jsonl"
PROFILES=b9e3e9e7119898e055bbf930d60ccbea2a234b48
STEPS=" ${*:-tools content mutate rounds tables} "
want() { [[ "$STEPS" == *" $1 "* ]]; }
t() { local s=$SECONDS; "$@"; echo "TIME $((SECONDS - s)) s: $*" >&2; }

if want tools; then
  t env BUILD="$BUILD" lab/av1/tools/tools.sh aom dav1d
  # encoder/build.sh's own steps, without its tools.sh call, which also builds SVT-AV1 and AVM.
  src="$BUILD/aom-3.15.1-svc-src"
  rm -rf "$src" && mkdir -p "$src" && tar -xzf "$BUILD/libaom-3.15.1.tar.gz" -C "$src" --strip-components=1
  patch -s -d "$src" -p1 < lab/av1/delivery/scalable/encoder/svc_encoder_rtc.patch
  cmake -S "$src" -B "$BUILD/aom-3.15.1-svc-b" -G Ninja -DCMAKE_BUILD_TYPE=Release -DENABLE_TESTS=0 -DENABLE_DOCS=0 -DENABLE_TOOLS=0 >/dev/null
  t cmake --build "$BUILD/aom-3.15.1-svc-b" --target svc_encoder_rtc >/dev/null
  t env BUILD="$BUILD" lab/av1/delivery/scalable/two-layer/build_wasm.sh
  client/decode/wasm/fetch_openjph.sh
  FRAMES=1 OUT_ROOT="$(mktemp -d)" lab/scripts/gen_htj2k_fixtures.sh g160 >/dev/null || true   # builds ojph_compress
  test -x lab/.openjph-build/install/bin/ojph_compress
  t lab/av1/fetch_data.sh dbts_a1 dbts_b1 dbts_c1
  git checkout "$PROFILES" -- lab/av1/profiles && git reset -q lab/av1/profiles
  $P -m pip install -q --require-hashes -r lab/av1/profiles/requirements.txt
fi
if want content; then
  t $P lab/av1/delivery/split-rule/make_frames.py "$BUILD" $W/shipped "${SETS[@]}" --preset allintra:7 --k 2 --jobs 3
  t $P $T/shapes.py "$BUILD" $W/shipped $W/preview-tool $W/carriers-shapes.tsv "${SETS[@]}" \
    --shapes three-full-m10,three-full-m20,three-full-m30
  # The layered streams must be the SVC metrics sitting's, byte for byte.
  diff <(cut -f1,3,8 $T/svc-shapes.tsv | grep three-full) <(cut -f1,3,8 $W/carriers-shapes.tsv | grep three-full)
  t $P $C/content.py "$BUILD" $W/shipped $W/preview-tool $W/carriers "${SETS[@]}"
fi
if want mutate; then
  python3 $C/roles_test.py && python3 $C/mutate.py
  for m in skip low; do $P $C/content.py "$BUILD" $W/shipped $W/preview-tool $W/carriers "${SETS[0]}" --mutate $m; done
  for m in sample truth offset skip low; do
    NODE_PATH=$(npm root -g) node $C/ask.mjs --work $W/carriers --rounds 1 --throttles 1 --sets dbts_a1 --mutate $m --out "$ROWS"
  done
fi
if want rounds; then
  for r in $(seq "${FIRST:-0}" "${LAST:-9}"); do
    NODE_PATH=$(npm root -g) node $C/ask.mjs --work $W/carriers --rounds 1 --first-round "$r" --out "$ROWS"
  done
fi
if want tables; then
  python3 $C/roles.py $W/carriers "$ROWS"
fi
