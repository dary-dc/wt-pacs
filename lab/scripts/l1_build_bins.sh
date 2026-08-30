#!/usr/bin/env bash
# Build L1 binaries: shared/main server, Q server from feat/set-priority-per-frame, harness.
# Does not merge the Q branch.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="${OUT:-$ROOT/.local/r2}"
mkdir -p "$OUT"

export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-$ROOT/target}"

echo "==> harness (this tree)"
cargo build -p window-harness --release
cp -f "$CARGO_TARGET_DIR/release/window-harness" "$OUT/window-harness"

echo "==> exact-server arm S (this tree / main)"
cargo build -p exact-server --release
cp -f "$CARGO_TARGET_DIR/release/exact-server" "$OUT/bin-main-exact-server"

Q_REF="${Q_REF:-origin/feat/set-priority-per-frame}"
WORKDIR="${WORKDIR:-$OUT/q-build}"
echo "==> exact-server arm Q from $Q_REF (detached worktree, not merged)"
rm -rf "$WORKDIR"
git fetch origin feat/set-priority-per-frame 2>/dev/null || true
git worktree add --detach "$WORKDIR" "$Q_REF"
(
  cd "$WORKDIR"
  export CARGO_TARGET_DIR="$OUT/q-target"
  cargo build -p exact-server --release
  cp -f "$CARGO_TARGET_DIR/release/exact-server" "$OUT/bin-q-exact-server"
)
git worktree remove --force "$WORKDIR"
rm -rf "$OUT/q-target"

echo "bins:"
ls -la "$OUT/window-harness" "$OUT/bin-main-exact-server" "$OUT/bin-q-exact-server"
