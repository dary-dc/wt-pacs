#!/usr/bin/env bash
# Rebuild `exact-server` against a quinn whose GSO segment cap is settable.
#
# quinn hard-codes `MAX_TRANSMIT_SEGMENTS = 10` — the number of datagrams it will pack
# into one `sendmsg` — with the comment "benchmarks have shown that numbers around 10 are
# a good compromise". On this host the kernel reports 64, and 32 measures 17% faster at
# 250 KB frames for 21% less CPU. See docs/quic-transport-optimization.md §2.
#
# This vendors quinn OUTSIDE the tree and patches it via a temporary `[patch.crates-io]`,
# because a forked quinn is not something to ship. Nothing here is left behind.
#
# Usage: gso_cap_experiment.sh <segments...>      e.g. gso_cap_experiment.sh 10 32 44
#   Writes ./target/gso-arms/exact-server-<n> for each value.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
WORK="${WORK:-${TMPDIR:-/tmp}/wt-pacs-gso}"
OUT_DIR="$ROOT/target/gso-arms"
QUINN_VER="${QUINN_VER:-0.11.11}"
SEGMENTS=("${@:-10 32 44}")

SRC=$(find ~/.cargo/registry/src -maxdepth 2 -type d -name "quinn-$QUINN_VER" | head -1)
[ -n "$SRC" ] || { echo "quinn-$QUINN_VER not in the cargo registry; cargo fetch first" >&2; exit 1; }

rm -rf "$WORK"; mkdir -p "$WORK" "$OUT_DIR"
cp -r "$SRC" "$WORK/quinn"; chmod -R u+w "$WORK/quinn"

python3 - "$WORK/quinn/src/connection.rs" <<'PY'
import sys
p = sys.argv[1]
s = open(p).read()
old = "const MAX_TRANSMIT_SEGMENTS: usize = 10;"
assert old in s, "quinn's MAX_TRANSMIT_SEGMENTS constant moved — update this script"
s = s.replace(old, """const MAX_TRANSMIT_SEGMENTS: usize = match option_env!("QUINN_MAX_TRANSMIT_SEGMENTS") {
    Some(s) => match konst_parse(s) { 0 => 10, n => n },
    None => 10,
};

const fn konst_parse(s: &str) -> usize {
    let b = s.as_bytes();
    let (mut i, mut acc) = (0, 0usize);
    while i < b.len() {
        if b[i] < b'0' || b[i] > b'9' { return 0; }
        acc = acc * 10 + (b[i] - b'0') as usize;
        i += 1;
    }
    acc
}""")
open(p, "w").write(s)
PY

RESTORE=$(mktemp)
cp "$ROOT/Cargo.toml" "$RESTORE"
cp "$ROOT/Cargo.lock" "$RESTORE.lock"
cleanup() { cp "$RESTORE" "$ROOT/Cargo.toml"; cp "$RESTORE.lock" "$ROOT/Cargo.lock"; rm -f "$RESTORE" "$RESTORE.lock"; }
trap cleanup EXIT

cat >> "$ROOT/Cargo.toml" <<PATCH

[patch.crates-io]
quinn = { path = "$WORK/quinn" }
PATCH

for n in "${SEGMENTS[@]}"; do
  echo "building segments=$n ($((n * 1452)) B per sendmsg at a 1452-byte MTU)"
  QUINN_MAX_TRANSMIT_SEGMENTS="$n" cargo build --release -p exact-server --target-dir "$ROOT/target/gso" >/dev/null
  cp "$ROOT/target/gso/release/exact-server" "$OUT_DIR/exact-server-$n"
  touch "$ROOT/server/src/main.rs"   # force a rebuild; the env var is not a fingerprint input
done
echo "arms in $OUT_DIR"
