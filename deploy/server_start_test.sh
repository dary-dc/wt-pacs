#!/bin/sh
# deploy/server-start.sh's two starts, its paths moved under a temp root and the server a stub that prints its
# arguments: with no certificate supplied it mints one and names its hash; with one, it writes no transport file and
# uses it. Then the web image's two starts, nginx a stub: the page rendered for each, and the policy naming the transport.
set -eu
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT
mkdir -p "$T/certs" "$T/run" "$T/bin"
sed -e "s#/certs/#$T/certs/#g" -e "s#/supplied/#$T/supplied/#g" -e "s#/run/wt-pacs/#$T/run/#g" \
  "$ROOT/deploy/server-start.sh" > "$T/start.sh"
printf '#!/bin/sh\necho "$@"\n' > "$T/bin/series-server"
chmod +x "$T/bin/series-server"
failed=0
check() { if [ "$1" = "$2" ]; then echo "ok: $3"; else echo "FAIL: $3 (got '$1', want '$2')"; failed=1; fi; }
field() { sed -n "s/.*\"$1\": \"\([^\"]*\)\".*/\1/p" "$T/run/dev-transport.json"; }

args="$(PATH="$T/bin:$PATH" WT_URL=https://h:4435/ sh "$T/start.sh" --port 4435)"
minted="$(openssl x509 -in "$T/certs/cert.pem" -outform DER | openssl dgst -sha256 | awk '{print $2}')"
check "$(field cert_sha256)" "$minted" "no certificate supplied: the minted one's hash is named"
check "$(field wt_url)" "https://h:4435/" "the transport file names the arm's URL"
check "$(grep -c client "$T/run/dev-transport.json")" "0" "the transport file names no client: the page does"
check "$args" "--series /studies/us_cine_smoke.sbnd --cert-pem $T/certs/cert.pem --key-pem $T/certs/key.pem --port 4435" \
  "the server takes the minted certificate and the arm's flags"

rm -f "$T/certs/cert.pem" "$T/certs/key.pem"
mkdir -p "$T/supplied"
openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -keyout "$T/supplied/key.pem" \
  -out "$T/supplied/cert.pem" -days 1 -nodes -subj /CN=h 2>/dev/null
args="$(PATH="$T/bin:$PATH" sh "$T/start.sh")"
check "$(ls "$T/run")" "" "a certificate supplied: no transport file, the last start's removed, so the browser verifies its chain"
check "$args" "--series /studies/us_cine_smoke.sbnd --cert-pem $T/supplied/cert.pem --key-pem $T/supplied/key.pem" \
  "the server takes the supplied certificate"
check "$(ls "$T/certs")" "" "nothing minted"

sed -e "s#/etc/nginx/#$T/nginx/#g" -e "s#/tls/#$T/tls/#g" -e "s#/usr/share/wt-pacs/#$ROOT/client/viewer/#" \
  -e "s#/srv/wt-pacs/client/viewer/#$T/#" "$ROOT/deploy/nginx/entrypoint.sh" > "$T/web.sh"
mkdir -p "$T/nginx/templates" "$T/nginx/conf.d" "$T/tls"
cp "$ROOT/deploy/nginx/wt-pacs.conf.template" "$T/nginx/templates/"
ln -s "$ROOT/client/viewer/page.sh" "$T/bin/page.sh"
printf '#!/bin/sh\n' > "$T/bin/nginx"
cat > "$T/bin/envsubst" <<'SH'
#!/bin/sh
sed -e "s#\${SERIES}#$SERIES#g" -e "s#\${TLS_LISTEN}#$TLS_LISTEN#g" -e "s#\${WT_ORIGIN}#$WT_ORIGIN#g"
SH
chmod +x "$T/bin/nginx" "$T/bin/envsubst"
csp() { sed -n "s/.*connect-src 'self' \([^;]*\);.*/\1/p" "$T/nginx/conf.d/default.conf"; }
PATH="$T/bin:$PATH" WT_URL=https://h:4435/ sh "$T/web.sh"
check "$(grep -o 'data-[a-z-]*="[^"]*"' "$T/index.html" | tr '\n' ' ')" 'data-client="ts" data-transport-file="/wt/dev-transport.json" ' \
  "no TLS: the page reads the transport file, which pins the minted certificate"
check "$(csp)" "https://h:4435" "no TLS: the policy connects to WT_URL"
cp "$T/supplied/cert.pem" "$T/supplied/key.pem" "$T/tls/"
PATH="$T/bin:$PATH" CLIENT=wasm sh "$T/web.sh"
check "$(grep -o 'data-[a-z-]*="[^"]*"' "$T/index.html" | tr '\n' ' ')" 'data-client="wasm" data-wt-port="4433" ' \
  "TLS and CLIENT=wasm: the page names the WASM client and dials its own host"
check "$(grep -c 'dev-transport\|ts/dist/session.js' "$T/index.html")" "0" "TLS: the page neither preloads a transport file nor TS's client"
check "$(grep -c 'transport_wasm_bg.wasm" as="fetch"' "$T/index.html")" "1" "CLIENT=wasm: the HTML preloads the WASM client"
check "$(csp)" 'https://$host:4433' "TLS: the policy connects to the page's own host"

# REGISTRY's default and the `server` stage from its FROM down, comments dropped, each COPY's source cut to its last element.
server_stage() {
  awk '/^ARG REGISTRY=/ { print } /^FROM .* AS server$/ { on = 1 } on && /^$/ { exit } on && !/^#/' "$1" \
    | sed -E 's#^COPY (--from=[^ ]+ )?([^ ]*/)?([^ /]+) #COPY \3 #'
}
check "$(server_stage "$ROOT/deploy/Containerfile.prebuilt")" "$(server_stage "$ROOT/deploy/Containerfile")" \
  "Containerfile.prebuilt's server stage is Containerfile's, its binary staged rather than compiled"
[ "$failed" = 0 ] && echo "all tests passed"
exit "$failed"
