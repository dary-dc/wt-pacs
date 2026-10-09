#!/usr/bin/env bash
# The client's decoder builds from pinned sources, in a container with no network, checked against manifest.sha256.
#
#   client/decode/wasm/build/build.sh            # build into client/decode/wasm/built, refuse a hash that differs
#   UPDATE=1 client/decode/wasm/build/build.sh   # build and rewrite the manifest instead
#
# README.md beside this says what it builds and why.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../../.." && pwd)"
CACHE="${CACHE:-$HERE/.cache}"
OUT="${OUT:-$ROOT/client/decode/wasm/built}"
IMAGE=wt-pacs-decoder-build
# shellcheck source=pins.sh
source "$HERE/pins.sh"

fetch_git() {
  local url=$1 tag=$2 commit=$3 dir=$4
  [[ -d "$dir" ]] || git -c advice.detachedHead=false clone -q --depth 1 --branch "$tag" "$url" "$dir"
  [[ "$(git -C "$dir" rev-parse HEAD)" == "$commit" ]] || { echo "$dir is not $tag at $commit" >&2; exit 2; }
  [[ -z "$(git -C "$dir" status --porcelain)" ]] || { echo "$dir has local changes" >&2; exit 2; }
}
fetch_file() {
  local url=$1 sha=$2 file=$3
  [[ -f "$file" ]] || { curl -fsSL -o "$file.part" "$url" && mv "$file.part" "$file"; }
  echo "$sha  $file" | sha256sum -c --quiet || { echo "$file is not the pinned $sha" >&2; exit 2; }
}

mkdir -p "$CACHE" "$OUT"
fetch_git https://github.com/aous72/OpenJPH.git "$OPENJPH_TAG" "$OPENJPH_COMMIT" "$CACHE/openjph"
fetch_git https://github.com/videolan/dav1d.git "$DAV1D_TAG" "$DAV1D_COMMIT" "$CACHE/dav1d"
fetch_file "https://storage.googleapis.com/webassembly/emscripten-releases-builds/linux/$EMSCRIPTEN_RELEASE/wasm-binaries.tar.xz" \
  "$EMSCRIPTEN_SHA256" "$CACHE/emscripten-$EMSCRIPTEN_VERSION.tar.xz"
fetch_file "https://nodejs.org/dist/v$NODE_VERSION/node-v$NODE_VERSION-linux-x64.tar.xz" "$NODE_SHA256" \
  "$CACHE/node-v$NODE_VERSION-linux-x64.tar.xz"
python3 -m pip download -q --no-deps --only-binary :all: --platform manylinux2014_x86_64 --python-version 3.11 \
  --require-hashes -r "$HERE/requirements.txt" -d "$CACHE/wheels"
bash "$ROOT/client/decode/wasm/fetch_xxh3.sh" >/dev/null

docker build -q -t "$IMAGE" --build-arg DEBIAN_IMAGE="$DEBIAN_IMAGE" --build-arg DEBIAN_SNAPSHOT="$DEBIAN_SNAPSHOT" \
  -f "$HERE/Containerfile" "$HERE" >/dev/null
# The repository is mounted at its own path, so a clone elsewhere builds from another path; -ffile-prefix-map must hide it.
docker run --rm --network none -v "$ROOT:$ROOT" -v "$CACHE:$CACHE:ro" -w "$ROOT" "$IMAGE" \
  bash "$HERE/inside.sh" "$CACHE" "$OUT" "$(id -u):$(id -g)"

if [[ -n "${UPDATE:-}" ]]; then
  (cd "$OUT" && find . -type f ! -path './.work/*' | sed 's#^\./##' | LC_ALL=C sort | xargs sha256sum) >"$HERE/manifest.sha256"
  echo "manifest rewritten: $HERE/manifest.sha256"
else
  (cd "$OUT" && sha256sum -c --quiet "$HERE/manifest.sha256") || { echo "the build differs from manifest.sha256" >&2; exit 1; }
  echo "decoder builds in $OUT match manifest.sha256"
fi
