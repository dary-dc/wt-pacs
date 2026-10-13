#!/usr/bin/env bash
# Row NETMEASURE's timed campaigns, each a protocol of docs/decode/README.md §Not yet tried, *Net protocols*: n rounds,
# each after /proc/stat's steal reads ≤ 2 % over 10 s, the fill and the cold ask in an order that alternates by round.
#
#   lab/decode-bench/netrules/run.sh emsdk-frame|emsdk-net|start-net|copy-frame|copy-memory|copy-net ROUNDS [FIRST] [TAG]
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$ROOT"
WHAT=$1 ROUNDS=$2 FIRST=${3:-0} TAG=${4:-$1}
RAW=lab/decode-bench/netrules/raw W=lab/.av1-work/netrules
mkdir -p "$RAW"
export NODE_PATH=$(npm root -g)

steal_ok() {
  local a b
  a=($(awk '/^cpu /{s=0; for (i=2;i<=NF;i++) s+=$i; print $9, s}' /proc/stat)); sleep 10
  b=($(awk '/^cpu /{s=0; for (i=2;i<=NF;i++) s+=$i; print $9, s}' /proc/stat))
  awk -v d=$((b[0]-a[0])) -v t=$((b[1]-a[1])) 'BEGIN { exit !(d <= 0.02 * t) }'
}
gate() { until steal_ok; do echo "round $1: steal over 2 %, waiting" >&2; done; }

NET=(--links n100000,n300000 --frames $W)
for ((r = FIRST; r < FIRST + ROUNDS; r++)); do
  gate "$r"
  case $WHAT in
    emsdk-frame) node lab/av1/tools/newer/decode.mjs --rounds 1 --throttles 1,4 --browsers 141 --first-round "$r" --frames $W \
        --variants ojph-del-3.1.74,ojph-delcopy-3.1.74,ojph-em6-6.0.11 --sets g512,dbt12_ea1141,dbt12_c,dbtproj_ge,syn2d_d,ffdm_d \
        --out "$RAW/$TAG-$r.json" > /dev/null ;;
    copy-frame) for e in $( ((r % 2)) && echo firefox chromium || echo chromium firefox); do
        node lab/decode-bench/copy/run.mjs --engine "$e" --first-round "$r" --rounds 1 --throttles 1,4 --frames $W --variants del,delcopy,pt,copy \
          --sets c512,usrgb_aml,usrgb_apollo,usrgb_crc,usrgb_lca,usrgb_mel,usrgb_stad,dbt12_ea1141,dbt12_c,dbtproj_ge,syn2d_d,ffdm_d \
          --out "$RAW/$TAG-$e-$r.json"
      done ;;
    copy-memory) for e in $( ((r % 2)) && echo firefox chromium || echo chromium firefox); do
        node lab/decode-bench/copy/run.mjs --engine "$e" --memory --first-round "$r" --rounds 1 --frames $W --variants del,delcopy,pt,copy \
          --sets c512,usrgb_aml,usrgb_apollo,usrgb_crc,usrgb_lca,usrgb_mel,usrgb_stad,dbt12_ea1141,dbt12_c,dbtproj_ge,syn2d_d,ffdm_d \
          --out "$RAW/$TAG-$e-$r.json"
      done ;;
    emsdk-net|start-net|copy-net)
      case $WHAT in
        emsdk-net) A=(--sets dbt12_ea1141,dbtproj_ge,ffdm_d --throttles 1,4 --variants del,delcopy,em6) ;;
        start-net) A=(--sets dbt12_ea1141,dbtproj_ge,ffdm_d --throttles 1,4 --variants del,delname,need) ;;
        copy-net) A=(--sets usrgb_mel,ffdm_d --throttles 4 --variants del,delcopy,copy) ;;
      esac
      for mode in $( ((r % 2)) && echo ask fill || echo fill ask); do
        M=(); [[ $mode == ask ]] && M=(--fill 0 --asks-after 1)
        node lab/av1/delivery/total-time/run.mjs "${NET[@]}" "${A[@]}" "${M[@]}" --rounds 1 --first-round "$r" \
          --out "$RAW/$TAG-$mode.jsonl" 2>&1 | grep -E 'VOID|exact 0/|failed|Error' | grep -v 'VOID, dropped' || true
      done ;;
    *) echo "unknown campaign $WHAT" >&2; exit 2 ;;
  esac
  echo "$(date -u +%H:%M) $WHAT round $r done" >&2
done
