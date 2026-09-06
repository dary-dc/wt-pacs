#!/usr/bin/env bash
# Build `exact-server` against a quinn/quinn-proto patched to expose two knobs the
# product does not: the congestion controller's initial window, and the GSO segment cap.
#
# Both are upstream constants, not server code. This vendors the crates OUTSIDE the tree
# and patches them through a temporary `[patch.crates-io]`, so nothing in `server/` is
# touched and no fork is committed. Cargo.toml/Cargo.lock are restored on exit.
#
#   QUINN_INITIAL_WINDOW   bytes, read at RUNTIME (so one binary serves every arm)
#   QUINN_MAX_TRANSMIT_SEGMENTS  compile-time, so one binary per value
#
# Usage: quinn_lab_build.sh [segments...]     default: just 10 (upstream)
#   -> target/lab-arms/exact-server-seg<N>
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
WORK="${WORK:-${TMPDIR:-/tmp}/wt-pacs-quinn-lab}"
OUT_DIR="$ROOT/target/lab-arms"
SEGMENTS=("${@:-10}")

find_src() { find ~/.cargo/registry/src -maxdepth 2 -type d -name "$1" | head -1; }
QUINN=$(find_src "quinn-0.11.11"); PROTO=$(find_src "quinn-proto-0.11.17")
[ -n "$QUINN" ] && [ -n "$PROTO" ] || { echo "quinn sources not in registry; cargo fetch first" >&2; exit 1; }

rm -rf "$WORK"; mkdir -p "$WORK" "$OUT_DIR"
cp -r "$QUINN" "$WORK/quinn"; cp -r "$PROTO" "$WORK/quinn-proto"; chmod -R u+w "$WORK"

# --- quinn: make the GSO segment cap settable at build time ---
python3 - "$WORK/quinn/src/connection.rs" <<'PY'
import sys
p = sys.argv[1]; s = open(p).read()
old = "const MAX_TRANSMIT_SEGMENTS: usize = 10;"
assert old in s, "quinn MAX_TRANSMIT_SEGMENTS moved — update this script"
s = s.replace(old, '''const MAX_TRANSMIT_SEGMENTS: usize = match option_env!("QUINN_MAX_TRANSMIT_SEGMENTS") {
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
}''')
open(p, "w").write(s)
PY

# --- quinn-proto: make each controller's initial window settable at runtime ---
python3 - "$WORK/quinn-proto/src/congestion/cubic.rs" "$WORK/quinn-proto/src/congestion/bbr/mod.rs" <<'PY'
import sys
helper = '''
/// LAB PATCH (wt-pacs): initial window from `QUINN_INITIAL_WINDOW` (bytes) at runtime,
/// so one binary serves every arm of the initial-window sweep. Upstream has no such knob
/// on `Default`; the builder setter exists but the server does not expose it.
fn lab_initial_window(default: u64) -> u64 {
    match std::env::var("QUINN_INITIAL_WINDOW") {
        Ok(v) => v.parse::<u64>().unwrap_or(default).max(2 * 1200),
        Err(_) => default,
    }
}
'''
cubic, bbr = sys.argv[1], sys.argv[2]

s = open(cubic).read()
old = "            initial_window: 14720.clamp(2 * BASE_DATAGRAM_SIZE, 10 * BASE_DATAGRAM_SIZE),"
assert old in s, "cubic initial_window default moved"
s = s.replace(old, "            initial_window: lab_initial_window(14720.clamp(2 * BASE_DATAGRAM_SIZE, 10 * BASE_DATAGRAM_SIZE)),")
open(cubic, "w").write(s + helper)

s = open(bbr).read()
old = "            initial_window: K_MAX_INITIAL_CONGESTION_WINDOW * BASE_DATAGRAM_SIZE,"
assert old in s, "bbr initial_window default moved"
s = s.replace(old, "            initial_window: lab_initial_window(K_MAX_INITIAL_CONGESTION_WINDOW * BASE_DATAGRAM_SIZE),")
open(bbr, "w").write(s + helper.replace("fn lab_initial_window", "fn lab_initial_window"))
PY

RESTORE=$(mktemp); cp "$ROOT/Cargo.toml" "$RESTORE"; cp "$ROOT/Cargo.lock" "$RESTORE.lock"
cleanup() { cp "$RESTORE" "$ROOT/Cargo.toml"; cp "$RESTORE.lock" "$ROOT/Cargo.lock"; rm -f "$RESTORE" "$RESTORE.lock"; }
trap cleanup EXIT

cat >> "$ROOT/Cargo.toml" <<PATCH

[patch.crates-io]
quinn = { path = "$WORK/quinn" }
quinn-proto = { path = "$WORK/quinn-proto" }
PATCH

for n in "${SEGMENTS[@]}"; do
  echo "building seg=$n"
  QUINN_MAX_TRANSMIT_SEGMENTS="$n" cargo build --release -p exact-server --target-dir "$ROOT/target/lab" >/dev/null 2>&1 \
    || { QUINN_MAX_TRANSMIT_SEGMENTS="$n" cargo build --release -p exact-server --target-dir "$ROOT/target/lab"; exit 1; }
  cp "$ROOT/target/lab/release/exact-server" "$OUT_DIR/exact-server-seg$n"
  touch "$ROOT/server/src/main.rs"
done
echo "arms in $OUT_DIR"
