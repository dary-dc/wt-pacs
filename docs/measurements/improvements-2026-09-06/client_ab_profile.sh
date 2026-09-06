#!/usr/bin/env bash
set -uo pipefail
S=/tmp/claude-0/-home-user-wt-pacs/4388fb8e-14c3-5912-8315-3076f7ec068b/scratchpad
ROOT=/home/user/wt-pacs; cd $ROOT; mkdir -p $S/ab/prof
swap() { cp $S/ab/$1/shell.js client/harness/shell.js; cp $S/ab/$1/session.js client/transport-ts/dist/session.js; rm -rf client/transport-wasm/pkg; cp -r $S/ab/$1/pkg client/transport-wasm/pkg; }
python3 server/dev-server.py --port 8765 --study us_cine_smoke > $S/ab_http.log 2>&1 & HPID=$!; sleep 0.5
cell() { local tag=$1 fixture=$2 frames=$3 mode=$4 query=$5
  $S/bin/head/exact-server-default --port 4433 --study lab/fixtures/$fixture/$fixture.sbnd --stream-mode $mode --bind 127.0.0.1 > $S/ab_server.out 2>&1 & local SPID=$!; sleep 0.8
  for rep in 1 2; do for v in before after; do swap $v; for arm in ts wasm; do
    timeout 200 node $S/client_profile.mjs http://127.0.0.1:8765 $arm "$query&frames=$frames" $S/ab/prof/$tag-$v-r$rep-$arm.json 150 2>&1 | head -1 | sed "s/^/$tag $v r$rep /"
  done; done; done
  kill $SPID; wait $SPID 2>/dev/null; }
cell fill250k frames_250k_live 320 shared "cell=fill&stream_mode=shared"
cell ondemand32k frames_32k 80 shared "cell=ondemand&stream_mode=shared&d=4&n=2000"
cell fill250k-perframe frames_250k_live 320 per-frame "cell=fill&stream_mode=per-frame"
kill $HPID; wait $HPID 2>/dev/null
swap after; bash client/transport-ts/build.sh >/dev/null; git checkout -- client/harness/shell.js 2>/dev/null; cp $S/ab/after/shell.js client/harness/shell.js
echo AB_DONE
