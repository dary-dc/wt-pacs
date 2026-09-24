#!/usr/bin/env bash
# A crates.io crate with its patch from patches/ applied, into DIR. Run by patched/CRATE/build.rs;
# why each patch exists: docs/proposal-session-open.md §Lever 2 and §What lever 2 costs.
#
#   scripts/patch_crate.sh CRATE DIR
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CRATE="${1:?usage: $0 CRATE DIR}"
OUT="${2:?usage: $0 CRATE DIR}"
case "$CRATE" in
  wtransport) VERSION=0.7.2 WHAT=settings-early
    CHECKSUM=b4273ce3157a3262a68665f8d3f20a0ac0c5b8a69ffd67f05ae986832ebec036 ;;
  quinn-proto) VERSION=0.11.18 WHAT=probe-every-space
    CHECKSUM=a9746dbde176634f4f2f1faf2404e30a31b2bc1e9cafb5329c95d8177a18c9fc ;;
  *) echo "no patch for $CRATE" >&2; exit 2 ;;
esac
PATCH="$ROOT/patches/${CRATE}-${VERSION}-${WHAT}.patch"

mkdir -p "$OUT"
crate="$OUT/${CRATE}-${VERSION}.crate"
verify() { echo "$CHECKSUM  $1" | sha256sum -c --status; }

if ! { [[ -f "$crate" ]] && verify "$crate"; }; then
  for f in "${CARGO_HOME:-$HOME/.cargo}"/registry/cache/*/"${CRATE}-${VERSION}".crate; do
    [[ -f "$f" ]] && verify "$f" && cp "$f" "$crate" && break
  done
  [[ -f "$crate" ]] || curl -fsSL "https://static.crates.io/crates/${CRATE}/${CRATE}-${VERSION}.crate" -o "$crate"
  verify "$crate" || { echo "${CRATE}-${VERSION}.crate: checksum mismatch" >&2; exit 1; }
fi

src="$OUT/${CRATE}-${VERSION}"
rm -rf "$src"
tar -xzf "$crate" -C "$OUT"
patch -p1 --forward --batch --fuzz=0 --quiet -d "$src" < "$PATCH"

# include! makes a crate's inner `//!` and `#![..]` outer, so the body goes without them.
sed -e '/^\s*\/\/!/d' -e '/^#!\[/d' "$src/src/lib.rs" > "$src/src/lib_body.rs"
