#!/usr/bin/env bash
# A crates.io crate with its patch from patches/ applied, into DIR. Run by patched/CRATE/build.rs;
# why each patch exists: docs/ARCHITECTURE.md §Early SETTINGS and §What early SETTINGS cost, and for quinn
# docs/transport/transport-conclusions.md §4.
#
#   scripts/patch_crate.sh CRATE DIR [--copy-src SRC]   SRC receives the patched modules
#   scripts/patch_crate.sh CRATE --check                 apply in a temp dir (gate.sh)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
usage="usage: $0 CRATE DIR [--copy-src SRC] | CRATE --check"
CRATE="${1:?$usage}"
case "$CRATE" in
  wtransport) VERSION=0.7.2 WHAT=settings-early
    CHECKSUM=b4273ce3157a3262a68665f8d3f20a0ac0c5b8a69ffd67f05ae986832ebec036 ;;
  quinn-proto) VERSION=0.11.18 WHAT=probe-every-space
    CHECKSUM=a9746dbde176634f4f2f1faf2404e30a31b2bc1e9cafb5329c95d8177a18c9fc ;;
  quinn) VERSION=0.11.11 WHAT=mtu-gso
    CHECKSUM=0c1a41e437b6bbd489372cd4971de128e85c855f56c57f283d20ff016cf7c0a8 ;;
  *) echo "no patch for $CRATE" >&2; exit 2 ;;
esac
PATCH="$ROOT/patches/${CRATE}-${VERSION}-${WHAT}.patch"

COPY_SRC=""
case "${2:?$usage}" in
  --check) OUT="$(mktemp -d)"; trap 'rm -rf "$OUT"' EXIT ;;
  *) OUT="$2"
    if [[ $# -gt 2 ]]; then
      [[ "$3" == --copy-src ]] || { echo "$usage" >&2; exit 2; }
      COPY_SRC="${4:?$usage}"
    fi ;;
esac

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

if [[ -n "$COPY_SRC" ]]; then
  find "$COPY_SRC" -mindepth 1 -maxdepth 1 ! -name lib.rs -exec rm -rf {} +
  find "$src/src" -mindepth 1 -maxdepth 1 ! -name lib.rs ! -name lib_body.rs -exec cp -a {} "$COPY_SRC/" \;
fi
[[ "$2" != --check ]] || echo "${CRATE} ${VERSION}: ${WHAT} applies"
