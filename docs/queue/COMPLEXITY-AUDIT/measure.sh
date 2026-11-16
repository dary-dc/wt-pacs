#!/usr/bin/env bash
# measure.sh REF: static measures of a tree, read with git (no checkout)
set -uo pipefail
cd /home/user/wt-pacs; R=$1
files() { git ls-tree -r --name-only "$R" -- "$@"; }
code='\.(rs|ts|js|mjs|cjs|sh|py|cpp|cc|c|h|hpp|go|wgsl|html|css)$'
nb() { while read -r f; do git show "$R:$f"; done | grep -cv '^[[:space:]]*$'; }
excl='(^|/)(dist|built|pkg|node_modules)/|package-lock\.json'
echo "| path | non-blank code lines |"; echo "| --- | ---: |"
for d in server client:native ingest deploy scripts lab; do
  case $d in
    client:native) echo "| client/ without client/native/ | $(files client | grep -vE '^client/native/' | grep -E "$code" | grep -vE "$excl" | nb) |"
                   echo "| client/native/ | $(files client/native | grep -E "$code" | grep -vE "$excl" | nb) |" ;;
    *) echo "| $d/ | $(files $d | grep -E "$code" | grep -vE "$excl" | nb) |" ;;
  esac
done
echo "| docs/ (all .md lines, blank excluded) | $(files docs | grep -E '\.md$' | nb) |"
prod=$(files client | grep -vE '^client/(native|contract)/' | grep -E '\.(js|ts|mjs)$' | grep -vE "$excl"'|\.test\.|check|crafted|_test|/test/')
params=$(for f in $prod; do git show "$R:$f"; done | grep -oE '\b(q|params|query|search|searchParams|sp)\.(get|has)\("[A-Za-z_]+"\)' | grep -oE '"[A-Za-z_]+"' | sort -u | tr -d '"' | tr '\n' ' ')
echo; echo "URL parameters the product's client reads ($(wc -w <<<"$params")): $params"
labp=$(for f in $(files lab/viewer | grep -E '\.js$' | grep -v test); do git show "$R:$f"; done | grep -oE '\bq\.(get|has)\("[A-Za-z_]+"\)' | grep -oE '"[A-Za-z_]+"' | sort -u | tr -d '"' | tr '\n' ' ')
echo "URL parameters lab/viewer/ reads, behind head.js's lab gate ($(wc -w <<<"$labp")): $labp"
feats=""
for m in $(git show "$R:Cargo.toml" | sed -n '/^members/,/]/p' | grep -oE '"[^"]+"' | tr -d '"' | grep -v '^lab/'); do
  f=$(git show "$R:$m/Cargo.toml" 2>/dev/null | sed -n '/^\[features\]/,/^\[/p' | grep -oE '^[a-z0-9_-]+ *=' | tr -d ' =' | grep -v '^default$' | sed "s#^#$m:#")
  feats="$feats $f"
done
echo "Cargo features of the product crates, default excluded ($(wc -w <<<"$feats")):$(echo $feats)"
lev=$(git show "$R:server/src/transport/lab_levers.rs" 2>/dev/null | grep -oE '^\s+pub [a-z_]+:' | grep -oE '[a-z_]+:' | tr -d ':' | tr '\n' ' ')
echo "Server lab levers, LabLevers' fields under lab-levers ($(wc -w <<<"$lev")): $lev"
