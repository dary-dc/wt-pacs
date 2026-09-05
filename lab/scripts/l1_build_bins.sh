#!/usr/bin/env bash
# Build L1 binaries from this tree only.
# Arms: S = shared, P = per-frame (no priority), Q = per-frame + --ask-priority.
# One exact-server binary; Q is selected at runtime via --ask-priority.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="${OUT:-$ROOT/.local/r2}"
mkdir -p "$OUT"

export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-$ROOT/target}"

echo "==> harness (this tree)"
cargo build -p window-harness --release
cp -f "$CARGO_TARGET_DIR/release/window-harness" "$OUT/window-harness"

echo "==> exact-server (this tree; S/P/Q via --stream-mode / --ask-priority)"
cargo build -p exact-server --release
cp -f "$CARGO_TARGET_DIR/release/exact-server" "$OUT/bin-main-exact-server"
# Same binary as main — kept for scripts that still SCP a distinct Q path.
cp -f "$CARGO_TARGET_DIR/release/exact-server" "$OUT/bin-q-exact-server"

echo "bins:"
ls -la "$OUT/window-harness" "$OUT/bin-main-exact-server" "$OUT/bin-q-exact-server"
echo "Q runtime: exact-server --stream-mode per-frame --ask-priority"
