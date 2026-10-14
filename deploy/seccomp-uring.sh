#!/usr/bin/env bash
# Writes seccomp-uring.json: Docker's default profile (moby/profiles seccomp/v0.2.3, the one Docker 29.8 ships)
# plus io_uring_setup, io_uring_enter and io_uring_register, nothing else. `--check` compares instead. deploy/README.md
set -euo pipefail
cd "$(dirname "$0")"
url=https://raw.githubusercontent.com/moby/profiles/seccomp/v0.2.3/seccomp/default.json
sum=536529b665dd0972c37bfb569f5d4ac8a53592e7b00752bc39ff063ca9864c74
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
curl -fsS -o "$tmp/default.json" "$url"
echo "$sum  $tmp/default.json" | sha256sum -c --quiet
jq --indent 1 '.syscalls += [{"names": ["io_uring_enter", "io_uring_register", "io_uring_setup"], "action": "SCMP_ACT_ALLOW"}]' \
  "$tmp/default.json" > "$tmp/seccomp-uring.json"
if [[ "${1:-}" == --check ]]; then
  cmp "$tmp/seccomp-uring.json" seccomp-uring.json && echo "seccomp-uring.json: default profile + io_uring, current"
else
  mv "$tmp/seccomp-uring.json" seccomp-uring.json
fi
