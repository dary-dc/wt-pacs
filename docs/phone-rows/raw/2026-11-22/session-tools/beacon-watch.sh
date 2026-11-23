#!/bin/bash
# usage: beacon-watch.sh BEACON ROUNDLOG
tail -n +1 -F "$1" 2>/dev/null | grep --line-buffered '"kind":"verdict"' | jq --unbuffered -r '"verdict step \(.step) cell \(.cell) \(.arm): " + (if .ok then "ok" else "FAIL \(.why)" end)' &
tail -n +1 -F "$2" 2>/dev/null | grep --line-buffered -E '"event": "(load failed|host failed|not started|round done)"' | jq --unbuffered -rc '"round: \(.event) load \(.load // "-") \(.why // "")"' &
wait
