#!/usr/bin/env bash
# The web image must answer exactly as server/dev-server.py does: same status, same three
# isolation headers, same content type, same bytes, on every path the viewer loads; everything
# else a 404; gzip, and no version in its Server header. And the transport's PEM must carry its own chain.
# usage: deploy/check_equivalence.sh [--local] [STUDIES_DIR SERIES]   (default: the smoke series)
#        deploy/check_equivalence.sh --cert [PEM]        the PEM check alone
# IMAGE names the web image; RUNTIME is podman, else docker.
# --local runs nginx on this host from the template, so the config is checked without a
# container runtime; the image itself is not.
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# A PEM holding one certificate that something else issued leaves the browser to fetch the
# intermediate over AIA on every cold open. docs/ARCHITECTURE.md §What production adds.
cert_chain() {  # pem named
  local pem="$1" named="$2" n subject issuer
  if [ ! -r "$pem" ]; then
    if [ "$named" -eq 1 ]; then printf '  FAIL %-38s no such PEM: %s\n' "cert chain" "$pem"; return 1; fi
    printf '  skip %-38s no such PEM\n' "cert chain"; return 0
  fi
  n=$(grep -c -- '-----BEGIN CERTIFICATE-----' "$pem")
  if [ "$n" -gt 1 ]; then printf '  ok   %-38s %s certificates\n' "cert chain" "$n"; return 0; fi
  subject=$(openssl x509 -in "$pem" -noout -subject -nameopt rfc2253 | cut -d= -f2-)
  issuer=$(openssl x509 -in "$pem" -noout -issuer -nameopt rfc2253 | cut -d= -f2-)
  if [ "$subject" = "$issuer" ]; then
    printf '  ok   %-38s one self-signed certificate\n' "cert chain"
    return 0
  fi
  printf '  WARN %-38s one certificate, issued by "%s"\n' "cert chain" "$issuer"
  printf '       a browser fetches that intermediate over AIA on every cold open; append it\n'
  return 1
}

LOCAL=0
if [ "${1:-}" = "--cert" ]; then cert_chain "${2:-$ROOT/server/dev-cert/cert.pem}" "$(( $# > 1 ))"; exit; fi
if [ "${1:-}" = "--local" ]; then LOCAL=1; shift; fi
STUDIES="$(cd "${1:-$ROOT/fixtures/us_cine_smoke}" && pwd)"
SERIES="${2:-us_cine_smoke}"
if [ "$LOCAL" -eq 0 ]; then
  RUNTIME="${RUNTIME:-$(command -v podman || command -v docker)}"
  IMAGE="${IMAGE:-wt-pacs-web:latest}"
  # The page and nginx files the image carries, against this tree's: Containerfile's COPYs less its ignore file.
  in_image='cd /srv/wt-pacs && find client -type f ! -path "client/transport/ts/dist/*" -exec sha256sum {} + &&
    sha256sum /etc/nginx/templates/wt-pacs.conf.template /usr/local/bin/entrypoint.sh | sed "s#  /.*/#  deploy/nginx/#"'
  in_tree() {
    find client -type f ! -name '*.md' ! -name '*.test.mjs' ! -name dev-transport.json ! -path '*/node_modules/*' \
      ! -path 'client/contract/*' ! -path 'client/transport/ts/dist/*' ! -path 'client/decode/wasm/build/.cache/*' \
      ! -path 'client/decode/wasm/vendor/openjph/*' ! -path 'client/decode/wasm/dav1d/*' -exec sha256sum {} +
    sha256sum deploy/nginx/wt-pacs.conf.template deploy/nginx/entrypoint.sh
  }
  image=$("$RUNTIME" run --rm --entrypoint sh "$IMAGE" -c "$in_image" 2>/dev/null | LC_ALL=C sort -k2) && [ -n "$image" ] \
    || { echo "no image $IMAGE: docker compose -f deploy/compose.yml build web" >&2; exit 2; }
  stale=$(cd "$ROOT" && diff <(echo "$image") <(in_tree | LC_ALL=C sort -k2) | grep '^[<>]' | awk '{print $3}' | sort -u)
  [ -z "$stale" ] || { printf 'stale image %s, these differ from the tree:\n%s\ndocker compose -f deploy/compose.yml build web\n' \
    "$IMAGE" "$stale" >&2; exit 2; }
fi
PY_PORT=18765
NG_PORT=18766
WT="$(mktemp -d)"
printf '{"wt_url": "https://127.0.0.1:4433/", "cert_sha256": "%064d"}\n' 0 > "$WT/dev-transport.json"
chmod 0755 "$WT"
PATHS=(/ /client/viewer/index.html /client/viewer/viewer.js /client/transport/downloader.js /client/decode/decoder.js
       /client/decode/wasm/built/openjph/openjph.wasm /client/decode/wasm/build/manifest.sha256
       /wt/dev-transport.json /series/metadata /nope-404)
# What the image must not answer: the dev server's lab routes, the checkout, the studies themselves.
HIDDEN=(/harness/ /lab/order.mjs /fixtures/us_cine_smoke/metadata.json /server/dev-cert/key.pem /deploy/compose.yml
        "/studies/$SERIES.sbnd" /wt/ /client/contract/run.mjs)

python3 "$ROOT/server/dev-server.py" --port "$PY_PORT" --metadata "$STUDIES/$SERIES.metadata.json" \
  --transport "$WT/dev-transport.json" >/dev/null 2>&1 &
PY=$!
if [ "$LOCAL" -eq 1 ]; then
  NG=$(mktemp -d)
  mkdir -p "$NG/tmp" "$NG/root"
  ln -s "$ROOT/client" "$NG/root/client"
  ln -s "$WT" "$NG/root/wt"
  sed -e 's#\${SERIES}#'"$SERIES"'#g' -e 's#\${TLS_LISTEN}##' -e "s#/srv/wt-pacs#$NG/root#g" -e "s#/studies/#$STUDIES/#g" \
    -e "s/listen  *8765;/listen 127.0.0.1:$NG_PORT;/" "$ROOT/deploy/nginx/wt-pacs.conf.template" > "$NG/server.conf"
  printf 'pid %s/nginx.pid;\nerror_log %s/error.log error;\nevents {}\nhttp {\n  access_log off;\n' "$NG" "$NG" > "$NG/nginx.conf"
  for d in client_body proxy fastcgi uwsgi scgi; do printf '  %s_temp_path %s/tmp;\n' "$d" "$NG"; done >> "$NG/nginx.conf"
  printf '  include %s/server.conf;\n}\n' "$NG" >> "$NG/nginx.conf"
  nginx -c "$NG/nginx.conf" || { kill $PY; exit 2; }
  trap 'kill $PY 2>/dev/null; nginx -s stop -c "$NG/nginx.conf" 2>/dev/null; rm -rf "$NG" "$WT"' EXIT
else
  "$RUNTIME" rm -f wtpacs-web-check >/dev/null 2>&1
  "$RUNTIME" run -d --rm --name wtpacs-web-check -e SERIES="$SERIES" -p "127.0.0.1:$NG_PORT:8765" \
    -v "$STUDIES:/studies:ro,z" -v "$WT:/srv/wt-pacs/wt:ro,z" "$IMAGE" >/dev/null || { kill $PY; exit 2; }
  trap 'kill $PY 2>/dev/null; "$RUNTIME" rm -f wtpacs-web-check >/dev/null 2>&1; rm -rf "$WT"' EXIT
fi

for port in "$PY_PORT" "$NG_PORT"; do
  for _ in $(seq 40); do curl -sf "http://127.0.0.1:$port/" -o /dev/null && break; sleep 0.25; done
done

fail=0
if [ -n "${CERT_PEM:-}" ]; then cert_chain "$CERT_PEM" 1 || fail=1
else cert_chain "$ROOT/server/dev-cert/cert.pem" 0 || fail=1; fi
probe() {  # port path -> "status|coop|coep|corp|ctype|cache-control|sha"
  local url="http://127.0.0.1:$1$2"
  local h; h=$(curl -sS -D- -o /tmp/body.$$ "$url" 2>/dev/null)
  local get; get() { printf '%s' "$h" | grep -i "^$1:" | head -1 | tr -d '\r' | cut -d' ' -f2-; }
  printf '%s|%s|%s|%s|%s|%s|%s' \
    "$(printf '%s' "$h" | head -1 | awk '{print $2}')" \
    "$(get cross-origin-opener-policy)" "$(get cross-origin-embedder-policy)" \
    "$(get cross-origin-resource-policy)" \
    "$(get content-type | cut -d';' -f1 | tr -d ' ')" "$(get cache-control)" \
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
for p in "${HIDDEN[@]}"; do
  s=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$NG_PORT$p")
  if [ "$s" = 404 ]; then printf '  ok   %-38s 404, not served\n' "$p"
  else printf '  OPEN %-38s %s\n' "$p" "$s"; fail=1; fi
done
# Deliberate divergences from dev-server.py, so they are asserted rather than compared. lab/page-open/README.md
gzipped() {  # path -> content-encoding
  curl -sS -H 'Accept-Encoding: gzip' -o /dev/null -D- "http://127.0.0.1:$NG_PORT$1" | grep -i '^content-encoding:' \
    | head -1 | tr -d '\r' | cut -d' ' -f2-
}
large=$(( $(curl -s "http://127.0.0.1:$NG_PORT/series/metadata" | wc -c) > 1024 ))
for p in /client/viewer/viewer.js /client/decode/wasm/built/openjph/openjph.wasm $([ $large -eq 1 ] && echo /series/metadata); do
  enc=$(gzipped "$p")
  if [ "$enc" = "gzip" ]; then printf '  ok   %-38s gzip\n' "$p"
  else printf '  MISS %-38s gzip, got "%s"\n' "$p" "$enc"; fail=1; fi
done
[ $large -eq 1 ] || printf '  skip %-38s under 1 KiB, sent as it is\n' "/series/metadata gzip"
server=$(curl -sS -o /dev/null -D- "http://127.0.0.1:$NG_PORT/" | grep -i '^server:' | tr -d '\r' | cut -d' ' -f2-)
if [ "$server" = "nginx" ]; then printf '  ok   %-38s %s\n' "Server header" "$server"
else printf '  MISS %-38s "%s", not "nginx"\n' "Server header" "$server"; fail=1; fi

[ $fail -eq 0 ] && echo "equivalent on ${#PATHS[@]} paths, ${#HIDDEN[@]} hidden; gzip, the Server header and the PEM's chain hold" || echo "NOT equivalent"
exit $fail
