#!/usr/bin/env bash
# No tracked file defaults to one person's machine: a home directory, a key, a user's checkout.
set -euo pipefail
cd "$(dirname "$0")/.."
pattern='/home/[a-z_][a-z0-9_-]*/|/Users/[A-Za-z]|id_ed25519|:-\$HOME/|:-~/|homedir\(\)'
allowed='CARGO_HOME:-\$HOME/\.cargo'
hits="$(git grep -nIE "$pattern" -- . ':!docs/av1/queue.md' ':!docs/cloud-queue.md' ':!scripts/check_personal_paths.sh' \
  | grep -vE "$allowed" || true)"
if [[ -n "$hits" ]]; then
  echo "$hits"
  echo "a personal path above: take it from the environment, or make it relative to the repository" >&2
  exit 1
fi
echo "no personal path"
