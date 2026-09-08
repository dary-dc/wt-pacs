#!/usr/bin/env bash
# The checks a contributor runs before pushing telemetry work — one command, fail-fast.
#
#   scripts/gate.sh            everything (the server absence check builds a default release)
#   scripts/gate.sh --quick    skip the two absence checks
#
# CARGO_TARGET_DIR is respected; set it to keep the default-feature release build out of a
# telemetry target dir you are also using for a harvest.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
quick=0
[[ "${1:-}" == "--quick" ]] && quick=1

step() { printf '\n== %s\n' "$*"; }

step "repo: comment budget"
scripts/comment_budget.sh

step "client: build bundles + unit tests"
bash client/transport-ts/build.sh >/dev/null
node client/record/test/run.mjs | tail -1

step "client: type-check (product + shared record)"
(cd client/transport-ts && npx tsc -p tsconfig.check.json)
(cd client/transport-ts && npx tsc -p ../record/tsconfig.json)

step "server: tests, default features"
cargo test -p exact-server --quiet
step "server: tests, telemetry feature"
cargo test -p exact-server --features telemetry --quiet
step "lab: window-harness tests"
cargo test -p window-harness --quiet

if [[ $quick -eq 0 ]]; then
  step "client: absence check (default bundle carries no telemetry)"
  bash client/scripts/check_telemetry_absent.sh | tail -1
  step "server: absence check (default release binary carries no Tap)"
  bash server/scripts/check_telemetry_absent.sh | tail -1
else
  step "absence checks skipped (--quick)"
fi

printf '\nGATE OK\n'
