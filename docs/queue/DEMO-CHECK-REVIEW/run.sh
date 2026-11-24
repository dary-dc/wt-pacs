# run.sh CHECK CONTROLLER SERIES VIEW TAG: one demo-check run, one JSON row to rows.jsonl
cd /home/user/u
cp /tmp/claude-0/s/v/$1.mjs client/viewer/demo-check.mjs
cp /tmp/claude-0/s/v/controller.$2.js client/view/controller.js
t=$(date -u +%FT%TZ); s=$SECONDS
out=$(NODE_PATH=/opt/node-tools/node_modules timeout 600 node client/viewer/demo-check.mjs demo-series $3 --view $4 2>&1); code=$?
fails=$(echo "$out" | grep -E '^FAIL' | cut -c1-300 | jq -R . | jq -cs .)
echo "{\"at\":\"$t\",\"check\":\"$1\",\"controller\":\"$2\",\"series\":\"$3\",\"view\":\"$4\",\"tag\":\"$5\",\"exit\":$code,\"s\":$((SECONDS-s)),\"fail\":$fails,\"last\":$(echo "$out" | tail -1 | cut -c1-200 | jq -R .)}" >> /tmp/claude-0/s/rows.jsonl
git -C /home/user/u checkout -q -- client/viewer/demo-check.mjs client/view/controller.js
