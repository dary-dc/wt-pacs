#!/bin/bash
# usage: cell3-fresh-chrome.sh ROUND_JSONL LOG_JSONL FIRST LAST
# Before each load FIRST..LAST: once round.py's after-reads of the previous load are done (its `logcat -c`), Chrome is
# force-stopped and relaunched on /next?after=<previous>, which round.py answers with the same 302 when its gap ends.
A=HOME/opt/platform-tools/adb
J=$1 LOG=$2 FIRST=$3 LAST=$4
now() { date +%s%3N; }
pending=
tail -n0 -F "$J" | while read -r l; do
  ev=$(jq -r '.event' <<<"$l")
  if [ "$ev" = "load ended" ]; then
    k=$(jq -r '.load' <<<"$l"); [ "$k" -ge $((FIRST - 1)) ] && [ "$k" -le $((LAST - 1)) ] && pending=$k || pending=
  elif [ -n "$pending" ] && [ "$ev" = adb ] && [ "$(jq -c '.args' <<<"$l")" = '["logcat","-c"]' ]; then
    k=$pending; pending=; t0=$(now)
    $A shell am force-stop com.android.chrome
    t1=$(now)
    $A shell am start -a android.intent.action.VIEW -d "http://127.0.0.1:8780/next?after=$k" \
      -e com.android.browser.application_id wtpacs.round com.android.chrome >/dev/null
    t2=$(now); pid=
    for i in $(seq 1 20); do pid=$($A shell pidof com.android.chrome | tr -d '\r'); [ -n "$pid" ] && break; sleep 0.5; done
    echo "{\"kind\":\"relaunch\",\"after\":$k,\"next\":$((k + 1)),\"stopAt\":$t0,\"stoppedAt\":$t1,\"startedAt\":$t2,\"upAt\":$(now),\"pid\":\"$pid\"}" | tee -a "$LOG"
  fi
done
