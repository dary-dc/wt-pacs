#!/usr/bin/env bash
# The web image must answer exactly as server/dev-server.py does: same status, same three
# isolation headers, same content type, same bytes, on every path the harness uses.
# usage: deploy/check_equivalence.sh [--local] [study]
# --local runs nginx on this host from the template, so the config is checked without a
# container runtime; the image itself is not.
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOCAL=0
if [ "${1:-}" = "--local" ]; then LOCAL=1; shift; fi
STUDY="${1:-us_cine_smoke}"
PY_PORT=18765
NG_PORT=18766
PATHS=(/harness/ /harness/index.html /harness/shell.js /wt/dev-transport.json /study/metadata
       /client/transport-ts/session.ts /client/harness/index.html /nope-404)

python3 "$ROOT/server/dev-server.py" --port "$PY_PORT" --study "$STUDY" >/dev/null 2>&1 &
PY=$!
if [ "$LOCAL" -eq 1 ]; then
  NG=$(mktemp -d)
  mkdir -p "$NG/tmp"
  sed -e 's#\${STUDY}#'"$STUDY"'#g' -e "s#/srv/wt-pacs#$ROOT#g" -e "s/listen  *8765;/listen 127.0.0.1:$NG_PORT;/" \
    "$ROOT/deploy/nginx/wt-pacs.conf.template" > "$NG/server.conf"
  printf 'pid %s/nginx.pid;\nerror_log %s/error.log error;\nevents {}\nhttp {\n  access_log off;\n' "$NG" "$NG" > "$NG/nginx.conf"
  for d in client_body proxy fastcgi uwsgi scgi; do printf '  %s_temp_path %s/tmp;\n' "$d" "$NG"; done >> "$NG/nginx.conf"
  printf '  include %s/server.conf;\n}\n' "$NG" >> "$NG/nginx.conf"
  nginx -c "$NG/nginx.conf" || { kill $PY; exit 2; }
  trap 'kill $PY 2>/dev/null; nginx -s stop -c "$NG/nginx.conf" 2>/dev/null; rm -rf "$NG"' EXIT
else
  podman rm -f wtpacs-web-check >/dev/null 2>&1
  podman run -d --rm --name wtpacs-web-check -e STUDY="$STUDY" -p "$NG_PORT:8765" \
    localhost/wt-pacs-web:check >/dev/null || { kill $PY; exit 2; }
  trap 'kill $PY 2>/dev/null; podman rm -f wtpacs-web-check >/dev/null 2>&1' EXIT
fi

for port in "$PY_PORT" "$NG_PORT"; do
  for _ in $(seq 40); do curl -sf "http://127.0.0.1:$port/harness/" -o /dev/null && break; sleep 0.25; done
done

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
# Two deliberate divergences from dev-server.py, so they are asserted rather than compared.
# lab/page-open/README.md.
enc=$(curl -sS -H 'Accept-Encoding: gzip' -o /dev/null -D- "http://127.0.0.1:$NG_PORT/harness/shell.js" \
      | grep -i '^content-encoding:' | head -1 | tr -d '\r' | cut -d' ' -f2-)
if [ "$enc" = "gzip" ]; then printf '  ok   %-38s %s\n' "gzip on a module" "$enc"
else printf '  MISS %-38s got "%s"\n' "gzip on a module" "$enc"; fail=1; fi

# No build emits a hashed name yet, so this probes a path that 404s: `always` still sends the
# headers, and the header set is the whole of what this rule has to get right.
h=$(curl -sS -o /dev/null -D- "http://127.0.0.1:$NG_PORT/client/nothing.0123456789ab.js")
for want in "cache-control: public, max-age=31536000, immutable" \
            "cross-origin-opener-policy: same-origin" \
            "cross-origin-embedder-policy: require-corp" \
            "cross-origin-resource-policy: same-origin"; do
  if printf '%s' "$h" | tr -d '\r' | grep -qi "^$want\$"; then
    printf '  ok   %-38s %s\n' "hashed name" "${want%%:*}"
  else
    printf '  MISS %-38s %s\n' "hashed name" "$want"; fail=1
  fi
done

[ $fail -eq 0 ] && echo "equivalent on ${#PATHS[@]} paths, and the two divergences hold" || echo "NOT equivalent"
exit $fail
