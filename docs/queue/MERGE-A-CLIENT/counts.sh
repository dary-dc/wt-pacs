#!/usr/bin/env bash
# counts.sh BRANCH: every `cargo test` line of the tip's gate.sh again without --quiet, its test counts summed per line
b=$1; cd /home/user/mac || exit 1
export CARGO_TARGET_DIR=/home/user/target-mac INGEST_BUILD=$PWD/ingest/.build PYTHON=python3.13
lvp="$(ls /usr/share/vulkan/icd.d/lvp_icd*.json 2>/dev/null | head -1)"
grep -oE 'run [0-9]+ (env [^ ]+ )?cargo test .*' scripts/gate.sh | sed -E 's/^run [0-9]+ //' | sort -u | while read -r cmd; do
  c=${cmd//--quiet/}; c=${c//\$lvp/$lvp}; c=${c//\"/}
  out=$(eval "$c" 2>&1)
  p=$(grep -oE 'test result: [a-zA-Z]+\. [0-9]+ passed; [0-9]+ failed; [0-9]+ ignored' <<<"$out" | awk '{p+=$4; f+=$6; i+=$8} END {printf "%d passed, %d failed, %d ignored", p, f, i}')
  echo "| \`${cmd}\` | $p |"
done
