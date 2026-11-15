#!/usr/bin/env bash
# Fetch the parser at the pinned commit and build its directory output, ESIPFfiled, with its own CMakeLists.txt.
#   lab/metadata-store/parser-output/build.sh DIR     DIR/DECK_WebTransport, DIR/cmake, DIR/build/ESIPFfiled
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
dir=$(mkdir -p "$1" && cd "$1" && pwd)
commit=a65abe282b6d75210be0430da2e804991445f28f

if [[ ! -d "$dir/DECK_WebTransport" ]]; then
  git clone --quiet https://github.com/opendicom/DECK_WebTransport.git "$dir/DECK_WebTransport"
fi
git -C "$dir/DECK_WebTransport" checkout --quiet "$commit"

[[ -x "$dir/cmake/bin/cmake" ]] || python3 -m venv "$dir/cmake"
"$dir/cmake/bin/pip" install --quiet --require-hashes -r "$here/requirements.txt"

"$dir/cmake/bin/cmake" -S "$dir/DECK_WebTransport/DICMele2deck" -B "$dir/build" -DCMAKE_BUILD_TYPE=Release > /dev/null
"$dir/cmake/bin/cmake" --build "$dir/build" --target ESIPFfiled -j "$(nproc)" > "$dir/build.log" 2>&1 \
  || { tail -20 "$dir/build.log"; exit 1; }
echo "$dir/build/ESIPFfiled"
