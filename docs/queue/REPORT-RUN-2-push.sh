#!/usr/bin/env bash
# REPORT-RUN-2's companions: the all-core busy share every 5 s into rows/r2-cpu.log, the rows pushed every 15 min, and
# every Firefox profile no running Firefox holds removed each minute (bidi.mjs leaves ~108 MB in /tmp a load).
set -u
cd "$W"
R=lab/report-arms/rows
( prev=($(head -1 /proc/stat)); while :; do sleep 5; cur=($(head -1 /proc/stat))
  t=0; for i in 1 2 3 4 5 6 7 8; do t=$((t + cur[i] - prev[i])); done
  idle=$((cur[4] + cur[5] - prev[4] - prev[5])); echo "$(date +%s) $(( t ? 100 * (t - idle) / t : 0 ))" >> $R/r2-cpu.log
  prev=("${cur[@]}"); done ) &
( while :; do sleep 60; held=$(pgrep -af 'firefox' | grep -o '/tmp/report-arms-ff-[A-Za-z0-9]*' | sort -u)
  for d in /tmp/report-arms-ff-*; do [ -d "$d" ] && ! echo "$held" | grep -qx "$d" && rm -rf "$d"; done; done ) &
while :; do
  sleep 900
  git add $R/r2-* 2>/dev/null
  git -c user.name=dary-dc -c user.email=crespoydelgado@gmail.com commit -qm "lab/report-arms/rows: REPORT-RUN-2 rows" \
    && for i in 1 2 3 4; do git pull -q --rebase --autostash origin claude/report-arms && git push -q origin claude/report-arms && break; sleep $((2 ** i)); done
done
