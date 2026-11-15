#!/usr/bin/env bash
# section.sh BRANCH: the run's table for the report
b=$1; O=/home/user/scratch-base/$b; P=$O/progress
g() { grep -E "^([0-9:Z]+ )?$1 " "$P" | tail -1 | sed -E 's/^[0-9:]+Z //'; }
echo "### \`claude/$b\` at \`$(cut -c1-10 $O/commit)\`"; echo
echo "| measure | result | command |"; echo "| --- | --- | --- |"
echo "| builds | transport WASM $(g transport-wasm | awk '{print $2}'), decode WASM $(g decode-wasm | awk '{print $2}'), ingest tools $(g ingest-tools | awk '{print $2}') (exit codes) | \`client/transport/wasm/build.sh\`, \`client/decode/wasm/build/build.sh\`, \`ingest/tools.sh\` |"
gl=$O/gate.log; gr=$(g gate)
res=$(grep -oE 'GATE (OK|FAILED)[^;]*' $gl | head -1); [[ -n $res ]] || res="exit $(awk '{print $2}' <<<"$gr")"
echo "| full gate | $res; $(grep -c '^== ' $gl) steps | \`PYTHON=python3.13 scripts/gate.sh\` |"
[[ -f $O/gate-nobrowser.log ]] && echo "| gate, no browser | $(grep -oE 'GATE (OK|FAILED)[^;]*' $O/gate-nobrowser.log | head -1) | \`scripts/gate.sh --no-browser\` |"
sk=$( (grep -h -A30 'skipped:$' $gl | grep 'SKIPPED' | sed 's/^ *SKIPPED: //'; grep -hoE 'skipped: .*' $gl | grep -v 'skipped:$' | sed 's/^skipped: //') | sort -u | sed 's/|/\\|/g' | paste -sd';' | sed 's/;/; /g')
echo "| gate's skips | ${sk:-none} | the gate's recap, and its in-step \`skipped:\` lines |"
echo "| default \`cargo build\` warnings | $(grep -E '^warning' $O/cargo-build.log | grep -vc 'generated') ($(grep -E '^warning' $O/cargo-build.log | grep -v generated | cut -c10-70 | sed 's/|/\\|/g' | paste -sd';')) | \`cargo build\` |"
echo "| \`scripts/check_lab_absent.sh\` | exit $(g lab-absent | awk '{print $2}'): $(tail -1 $O/lab-absent.log | cut -c1-90) | as named |"
echo "| \`scripts/comment_budget.sh\` | exit $(g comment-budget | awk '{print $2}'): $(grep -v '^$' $O/comment-budget.log | tail -1 | cut -c1-90) | as named |"
for t in server web; do r=$(g image-$t); rc=$(awk '{print $2}' <<<"$r"); sz=$(awk '{print $4}' <<<"$r")
  if [[ $rc == 0 ]]; then v="$(awk -v s=$sz 'BEGIN{printf "%.1f MB", s/1e6}') ($sz bytes)"; else v="not built here: $(grep -m1 -oE 'process "[^"]{0,60}' $O/image-$t.log | sed 's/process "//')… exit 100 — the container's proxy refuses plain-HTTP apt (405)"; fi
  echo "| deploy image, \`$t\` target | $v | \`docker build -f deploy/Containerfile --target $t\` (BuildKit, --network host, the proxy's CA as build_ca) |"; done
if [[ -s $O/counts.md ]]; then echo; echo "Test counts, each \`cargo test\` line of the gate run again without \`--quiet\`:"; echo; echo "| gate line | tests |"; echo "| --- | --- |"; cat $O/counts.md; fi
echo; echo "The JavaScript and Python suites as the gate printed them (its \`run 1\` keeps a step's last line):"; echo
grep -E '[0-9]+/[0-9]+ (passed|checks|cells|cases|refused)|[0-9]+/[0-9]+ checks passed|all (tests )?passed|: [0-9]+ passed' $gl | grep -v '^series (' | sed 's/^/    /' | sort | uniq -c | sed -E 's/^ +1 +/    /; s/^ +([0-9]+) +/    (×\1) /'
