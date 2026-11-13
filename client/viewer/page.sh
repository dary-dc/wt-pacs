#!/bin/sh
# The product's page rendered for one host: its client, with that client's preloads, and where its transport is —
# its own host on a port, or a transport file. docs/CLIENTS.md §Choosing the client
# usage: client/viewer/page.sh [--client ts|wasm] [--wt-port N | --transport-file PATH] < index.html
set -eu
client=ts port="" file=""
while [ $# -gt 1 ]; do
  case $1 in
    --client) client=$2 ;;
    --wt-port) port=$2 ;;
    --transport-file) file=$2 ;;
    *) break ;;
  esac
  shift 2
done
if [ $# -gt 0 ] || { [ -n "$port" ] && [ -n "$file" ]; }; then
  echo "usage: page.sh [--client ts|wasm] [--wt-port N | --transport-file PATH] < index.html" >&2
  exit 2
fi
case $client in ts | wasm) ;; *) echo "page.sh: client \"$client\" — ts or wasm" >&2 && exit 2 ;; esac
awk -v client="$client" -v port="$port" -v file="$file" '
  /href="\/client\/transport\/ts\/dist\/session.js"/ && client == "wasm" {
    print "<link rel=\"preload\" href=\"/client/transport/wasm/session-adapter.js\" as=\"script\" crossorigin>"
    print "<link rel=\"preload\" href=\"/client/transport/wasm/pkg/transport_wasm.js\" as=\"script\" crossorigin>"
    print "<link rel=\"preload\" href=\"/client/transport/wasm/pkg/transport_wasm_bg.wasm\" as=\"fetch\" crossorigin>"
    next
  }
  /<script src="\/client\/viewer\/head.js"/ {
    sub(/data-client="[^"]*"/, "data-client=\"" client "\"")
    if (port != "") sub(/data-wt-port="[^"]*"/, "data-wt-port=\"" port "\"")
    if (file != "") sub(/data-wt-port="[^"]*"/, "data-transport-file=\"" file "\"")
  }
  { print }
  /href="\/series\/metadata"/ && file != "" { print "<link rel=\"preload\" href=\"" file "\" as=\"fetch\" crossorigin>" }
'
