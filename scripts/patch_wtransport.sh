#!/usr/bin/env bash
# crates.io wtransport 0.7.2 with patches/wtransport-0.7.2-settings-early.patch applied, into DIR.
# Run by patched/wtransport/build.rs. docs/proposal-session-open.md §Lever 2
#
#   scripts/patch_wtransport.sh DIR
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VERSION=0.7.2
CHECKSUM=b4273ce3157a3262a68665f8d3f20a0ac0c5b8a69ffd67f05ae986832ebec036
PATCH="$ROOT/patches/wtransport-${VERSION}-settings-early.patch"
OUT="${1:?usage: $0 DIR}"

mkdir -p "$OUT"
crate="$OUT/wtransport-${VERSION}.crate"
verify() { echo "$CHECKSUM  $1" | sha256sum -c --status; }

if ! { [[ -f "$crate" ]] && verify "$crate"; }; then
  for f in "${CARGO_HOME:-$HOME/.cargo}"/registry/cache/*/wtransport-"$VERSION".crate; do
    [[ -f "$f" ]] && verify "$f" && cp "$f" "$crate" && break
  done
  [[ -f "$crate" ]] || curl -fsSL "https://static.crates.io/crates/wtransport/wtransport-${VERSION}.crate" -o "$crate"
  verify "$crate" || { echo "wtransport-${VERSION}.crate: checksum mismatch" >&2; exit 1; }
fi

src="$OUT/wtransport-${VERSION}"
rm -rf "$src"
tar -xzf "$crate" -C "$OUT"
patch -p1 --forward --batch --fuzz=0 --quiet -d "$src" < "$PATCH"

# include! makes a crate's inner `//!` and `#![..]` outer, so the body goes without them.
sed -e '/^\s*\/\/!/d' -e '/^#!\[/d' "$src/src/lib.rs" > "$src/src/lib_body.rs"
