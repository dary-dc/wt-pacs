#!/usr/bin/env bash
for b in unified-pacs line-hygiene; do /home/user/scratch-base/tip.sh $b; rm -rf /home/user/target-$b; docker builder prune -af >/dev/null 2>&1; done
/home/user/scratch-base/counts.sh unified-client > /home/user/scratch-base/unified-client/counts.md 2>&1
echo ALL-DONE > /home/user/scratch-base/all-done
cd /home/user/tips/unified-pacs; t=$SECONDS; CARGO_TARGET_DIR=/home/user/target-unified-pacs PYTHON=python3.13 NODE_PATH=/opt/node22/lib/node_modules scripts/gate.sh > /home/user/scratch-base/unified-pacs/gate-attempt4.log 2>&1; echo "$(date -u +%H:%M:%SZ) gate-attempt4 $? $((SECONDS-t))s" >> /home/user/scratch-base/unified-pacs/progress
rm -rf /home/user/target-unified-pacs; echo PACS4-DONE >> /home/user/scratch-base/all-done
