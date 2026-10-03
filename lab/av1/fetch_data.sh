#!/usr/bin/env bash
# The AV1 phase's public series — docs/FIXTURES.md §AV1 data. Fetched, checked against the
# SHA-256s pinned in data.json, never committed.
#
#   OUT=... lab/av1/fetch_data.sh [set ...]     default OUT lab/av1/data, every set
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="${OUT:-$HERE/data}"
VENV="${VENV:-$HERE/.venv}"
if [[ ! -x "$VENV/bin/python" ]]; then
  python3 -m venv "$VENV"
  "$VENV/bin/pip" install -q --require-hashes -r "$HERE/requirements.txt"
fi
exec "$VENV/bin/python" "$HERE/fetch_data.py" "$HERE/data.json" "$OUT" "$@"
