#!/usr/bin/env bash
# The product carries no lab code: nothing of lab/ in the server image, its default build or the web image, and
# no check module in the web image. head.js's lab gate is the one path to lab/. docs/lines/coordination.md §Decisions
# Prints every breach, then fails if there was one.
set -euo pipefail
cd "$(dirname "$0")/.."
breaches=0
breach() { echo "FAIL: $*"; breaches=$((breaches + 1)); }

copies=$(grep -HnE '^COPY +([^ ]+ +)*lab/' deploy/Containerfile deploy/Containerfile.prebuilt || true)
[[ -z "$copies" ]] || breach "the server image copies lab/:"$'\n'"$copies"

members=$(sed -n '/^default-members/,/]/p' Cargo.toml | grep -oE '"lab/[^"]*"' || true)
[[ -z "$members" ]] || breach "the default workspace builds a lab crate: $members"

cargo build --release -q -p series-server
target_dir="${CARGO_TARGET_DIR:-$(cargo metadata --format-version 1 --no-deps | python3 -c 'import json,sys; print(json.load(sys.stdin)["target_directory"])')}"
sources=$(tr ' ' '\n' <"$target_dir/release/series-server.d" | grep / | xargs realpath -m | grep -E "^$PWD/lab/" || true)
[[ -z "$sources" ]] || breach "the default series-server compiles lab sources: $(echo $sources)"

web="$(mktemp -d)"
trap 'rm -rf "$web"' EXIT
deploy/web-files.sh "$web" >/dev/null
shipped=$(cd "$web" && find client -type f \( -name 'check*.js' -o -path '*/lab/*' \) | sort)
[[ -z "$shipped" ]] || breach "the web image ships check or lab modules: $(echo $shipped)"
named=$(cd "$web" && grep -rlE "[\"'\`]([./]*)/?lab/[A-Za-z0-9_./-]+\.m?js[\"'\`]" client | grep -vx client/viewer/head.js | sort || true)
[[ -z "$named" ]] || breach "a web image module other than head.js names a lab/ module: $(echo $named)"

[[ $breaches -eq 0 ]] || { echo "$breaches breach(es) of the lab rule" >&2; exit 1; }
echo "OK: no lab crate, source or module in the images or the default build; lab/ only through head.js's gate"
