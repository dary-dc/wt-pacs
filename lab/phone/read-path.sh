#!/bin/sh
# Which way each series-server container reads its series, from its own log, on the laptop that runs them: README
# §The viewer on an Android phone, step 8. Exits 1 when the servers disagree, which stops docs/devices.md §7's run.
# usage: lab/phone/read-path.sh [CONTAINER...]   (default: every running srv-* container)
set -eu
names="${*:-$(podman ps --format '{{.Names}}' | grep '^srv-' || true)}"
[ -n "$names" ] || { echo "no srv-* container running" >&2; exit 1; }
paths=""
for n in $names; do
  # tracing writes its fields in colour, even into a container's log.
  log="$(podman logs "$n" 2>&1 | sed 's/\x1b\[[0-9;]*m//g')"
  fast="$(echo "$log" | sed -n 's/^read_fast_path=//p' | head -1)"
  ring="$(echo "$log" | sed -n 's/^read_ring=//p' | head -1)"
  rings="$(echo "$log" | grep 'session reads' | grep -o 'ring=[a-z]*' | sort | uniq -c | awk '{printf " %s %s", $1, $2}')"
  echo "$n read_fast_path=$fast read_ring=$ring io_uring_refused=$(echo "$log" | grep -c 'io_uring refused' || true) sessions:${rings:- none}"
  paths="$paths$fast $ring
"
done
echo "selinux $(getenforce 2>/dev/null || echo unknown)"
[ "$(printf '%s' "$paths" | sort -u | wc -l)" -le 1 ] || { echo "the servers' read paths differ: stop"; exit 1; }
