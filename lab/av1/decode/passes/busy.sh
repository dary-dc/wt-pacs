#!/usr/bin/env bash
# The host's CPUs while run.mjs runs, one line a second: epoch s, busy and total jiffies over every CPU (/proc/stat).
#   lab/av1/decode/passes/busy.sh > busy.log &   (started after run.mjs; stops with it)
while pgrep -f "passes/run.mjs" >/dev/null; do
  read -r _ u n s i w q sq st _ < /proc/stat
  echo "$(date +%s.%N) $((u+n+s+q+sq+st)) $((u+n+s+i+w+q+sq+st))"
  sleep 1
done
