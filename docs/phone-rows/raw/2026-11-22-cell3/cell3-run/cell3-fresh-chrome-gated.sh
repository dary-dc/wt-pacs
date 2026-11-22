#!/bin/bash
# usage: cell3-fresh-chrome-gated.sh ROUND_JSONL BEACON LOG_JSONL
# A fresh Chrome before every load after the first: once round.py's after-reads of load k are done (its `logcat -c`),
# and load k's verdict is in BEACON with the file quiet for 2 s, Chrome is force-stopped and relaunched on
# /next?after=k, which round.py answers with its cached 302 when the gap ends. No verdict within 8 s: no relaunch, logged.
A=HOME/opt/platform-tools/adb
J=$1 B=$2 LOG=$3
ms() { date +%s%3N; }
pending= ended=
tail -n0 -F "$J" | while read -r l; do
  ev=$(jq -r '.event' <<<"$l")
  if [ "$ev" = "load ended" ]; then pending=$(jq -r '.load' <<<"$l"); ended=$(ms)
  elif [ "$ev" = "round ended" ]; then exit 0
  elif [ -n "$pending" ] && [ "$ev" = adb ] && [ "$(jq -c '.args' <<<"$l")" = '["logcat","-c"]' ]; then
    k=$pending; pending=
    verdict=; quiet=
    while [ $(( $(ms) - ended )) -lt 8000 ]; do
      if [ -z "$verdict" ] && grep '"kind":"verdict"' "$B" | jq -e --argjson k "$k" 'select(.step == $k)' >/dev/null 2>&1; then verdict=$(ms); fi
      if [ -n "$verdict" ]; then
        s1=$(stat -c %s "$B"); sleep 2; s2=$(stat -c %s "$B")
        [ "$s1" = "$s2" ] && { quiet=$(ms); break; }
      else sleep 0.2; fi
    done
    if [ -z "$quiet" ]; then
      echo "{\"kind\":\"relaunch\",\"after\":$k,\"skipped\":\"$([ -n "$verdict" ] && echo 'beacon not quiet' || echo 'no verdict') within 8 s of load ended\"}" | tee -a "$LOG"
      continue
    fi
    t0=$(ms); $A shell am force-stop com.android.chrome; t1=$(ms)
    $A shell am start -a android.intent.action.VIEW -d "http://127.0.0.1:8780/next?after=$k" \
      -e com.android.browser.application_id wtpacs.round com.android.chrome >/dev/null
    t2=$(ms); pid=
    for i in $(seq 1 20); do pid=$($A shell pidof com.android.chrome | tr -d '\r'); [ -n "$pid" ] && break; sleep 0.5; done
    echo "{\"kind\":\"relaunch\",\"after\":$k,\"endedAt\":$ended,\"verdictAt\":$verdict,\"quietAt\":$quiet,\"stopAt\":$t0,\"stoppedAt\":$t1,\"startedAt\":$t2,\"upAt\":$(ms),\"pid\":\"$pid\"}" | tee -a "$LOG"
  fi
done
