#!/usr/bin/env bash
# The web image must answer exactly as server/dev-server.py does: same status, same three
# isolation headers, same content type, same bytes, on every path the harness uses.
# usage: deploy/check_equivalence.sh [study]
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STUDY="${1:-us_cine_smoke}"
PY_PORT=18765
NG_PORT=18766
PATHS=(/harness/ /harness/index.html /harness/shell.js /wt/dev-transport.json /study/metadata
       /client/transport-ts/session.ts /client/harness/index.html /nope-404)

python3 "$ROOT/server/dev-server.py" --port "$PY_PORT" --study "$STUDY" >/dev/null 2>&1 &
PY=$!
podman rm -f wtpacs-web-check >/dev/null 2>&1
podman run -d --rm --name wtpacs-web-check -e STUDY="$STUDY" -p "$NG_PORT:8765" \
  localhost/wt-pacs-web:check >/dev/null || { kill $PY; exit 2; }
trap 'kill $PY 2>/dev/null; podman rm -f wtpacs-web-check >/dev/null 2>&1' EXIT

for _ in $(seq 40); do curl -sf "http://127.0.0.1:$NG_PORT/harness/" -o /dev/null && break; sleep 0.25; done

fail=0
probe() {  # port path -> "status|coop|coep|corp|ctype|sha"
  local url="http://127.0.0.1:$1$2"
  local h; h=$(curl -sS -D- -o /tmp/body.$$ "$url" 2>/dev/null)
  local get; get() { printf '%s' "$h" | grep -i "^$1:" | head -1 | tr -d '\r' | cut -d' ' -f2-; }
  printf '%s|%s|%s|%s|%s|%s' \
    "$(printf '%s' "$h" | head -1 | awk '{print $2}')" \
    "$(get cross-origin-opener-policy)" "$(get cross-origin-embedder-policy)" \
    "$(get cross-origin-resource-policy)" \
    "$(get content-type | cut -d';' -f1 | tr -d ' ')" \
    "$(sha256sum /tmp/body.$$ | cut -c1-12)"
  rm -f /tmp/body.$$
}
for p in "${PATHS[@]}"; do
  a=$(probe "$PY_PORT" "$p"); b=$(probe "$NG_PORT" "$p")
  # An error page's body is the server's own; status and headers are what must match.
  case $p in *404*) a=${a%|*}; b=${b%|*} ;; esac
  if [ "$a" = "$b" ]; then printf '  ok   %-38s %s\n' "$p" "$a"
  else printf '  DIFF %-38s\n    dev-server %s\n    nginx      %s\n' "$p" "$a" "$b"; fail=1; fi
done
[ $fail -eq 0 ] && echo "equivalent on ${#PATHS[@]} paths" || echo "NOT equivalent"
exit $fail
