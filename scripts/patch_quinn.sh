#!/usr/bin/env bash
# Extract crates.io quinn 0.11.11 and apply patches/quinn-0.11.11-mtu-gso.patch.
# docs/transport/why-these-changes.md §9
#
#   scripts/patch_quinn.sh --out DIR [--copy-src DIR]   from patched/quinn/build.rs
#   scripts/patch_quinn.sh --check                      apply in a temp dir (gate.sh)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VERSION=0.11.11
CHECKSUM=0c1a41e437b6bbd489372cd4971de128e85c855f56c57f283d20ff016cf7c0a8
PATCH="$ROOT/patches/quinn-0.11.11-mtu-gso.patch"
CRATE_URL="https://static.crates.io/crates/quinn/quinn-${VERSION}.crate"

OUT=""
COPY_SRC=""
CHECK=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --out) OUT="$2"; shift 2 ;;
    --copy-src) COPY_SRC="$2"; shift 2 ;;
    --check) CHECK=1; shift ;;
    *) echo "usage: $0 --out DIR [--copy-src DIR] | --check" >&2; exit 2 ;;
  esac
done

if [[ $CHECK -eq 1 ]]; then
  OUT=$(mktemp -d)
  trap 'rm -rf "$OUT"' EXIT
fi
[[ -n "$OUT" ]] || { echo "scripts/patch_quinn.sh: --out or --check required" >&2; exit 2; }
mkdir -p "$OUT"

CARGO_HOME="${CARGO_HOME:-$HOME/.cargo}"
crate="$OUT/quinn-${VERSION}.crate"

verify() {
  echo "$CHECKSUM  $1" | sha256sum -c --status
}

if [[ -f "$crate" ]] && verify "$crate"; then
  :
else
  found=""
  for f in "$CARGO_HOME"/registry/cache/*/quinn-"$VERSION".crate; do
    [[ -f "$f" ]] || continue
    if verify "$f"; then found="$f"; break; fi
  done
  if [[ -n "$found" ]]; then
    cp "$found" "$crate"
  else
    curl -fsSL "$CRATE_URL" -o "$crate"
    verify "$crate" || { echo "quinn-${VERSION}.crate checksum mismatch" >&2; exit 1; }
  fi
fi

rm -rf "$OUT/quinn-${VERSION}"
tar -xzf "$crate" -C "$OUT"
src="$OUT/quinn-${VERSION}"
patch -p1 --forward --batch --quiet -d "$src" < "$PATCH"

conn="$src/src/connection.rs"
grep -q 'fn max_transmit_segments(mtu: u16)' "$conn"
grep -q '65_527 / usize::from(mtu.max(1))' "$conn"
grep -q 'const MAX_TRANSMIT_DATAGRAMS: usize = 64' "$conn"
grep -q 'const MAX_TRANSMIT_SEGMENTS: usize = 64' "$conn"
# 1452-byte MTU → 45 segments (integer division). Earlier write-ups said 44 at 1452.
python3 -c 'assert 65_527 // 1452 == 45 and 65_527 // 1472 == 44'

if [[ -n "$COPY_SRC" ]]; then
  mkdir -p "$COPY_SRC"
  keep=$(mktemp)
  [[ -f "$COPY_SRC/lib.rs" ]] && cp "$COPY_SRC/lib.rs" "$keep"
  find "$COPY_SRC" -mindepth 1 -maxdepth 1 ! -name lib.rs -exec rm -rf {} +
  for p in "$src/src"/*; do
    base=$(basename "$p")
    [[ "$base" == lib.rs ]] && continue
    cp -a "$p" "$COPY_SRC/"
  done
  if [[ -s "$keep" ]]; then
    cp "$keep" "$COPY_SRC/lib.rs"
  fi
  rm -f "$keep"
fi

if [[ $CHECK -eq 1 ]]; then
  echo "quinn ${VERSION} patch applies (GSO cap is 65527/mtu; 45 at 1452)"
fi
