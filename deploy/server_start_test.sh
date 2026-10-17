#!/bin/sh
# deploy/server-start.sh's two starts, its paths moved under a temp root and the server a stub that prints its
# arguments: with no certificate supplied it mints one and names its hash; with one, it pins nothing and uses it.
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
check "$(field client)" "ts" "no CLIENT: the transport file names the TypeScript client"
check "$args" "--series /studies/us_cine_smoke.sbnd --cert-pem $T/certs/cert.pem --key-pem $T/certs/key.pem --port 4435" \
  "the server takes the minted certificate and the arm's flags"

rm -f "$T/certs/cert.pem" "$T/certs/key.pem"
mkdir -p "$T/supplied"
openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -keyout "$T/supplied/key.pem" \
  -out "$T/supplied/cert.pem" -days 1 -nodes -subj /CN=h 2>/dev/null
args="$(PATH="$T/bin:$PATH" CLIENT=wasm sh "$T/start.sh")"
check "$(field cert_sha256)" "" "a certificate supplied: no hash, so the browser verifies its chain"
check "$(field client)" "wasm" "CLIENT=wasm: the transport file names it"
check "$args" "--series /studies/us_cine_smoke.sbnd --cert-pem $T/supplied/cert.pem --key-pem $T/supplied/key.pem" \
  "the server takes the supplied certificate"
check "$(ls "$T/certs")" "" "nothing minted"

# REGISTRY's default and the `server` stage from its FROM down, comments dropped, each COPY's source cut to its last element.
server_stage() {
  awk '/^ARG REGISTRY=/ { print } /^FROM .* AS server$/ { on = 1 } on && /^$/ { exit } on && !/^#/' "$1" \
    | sed -E 's#^COPY (--from=[^ ]+ )?([^ ]*/)?([^ /]+) #COPY \3 #'
}
check "$(server_stage "$ROOT/deploy/Containerfile.prebuilt")" "$(server_stage "$ROOT/deploy/Containerfile")" \
  "Containerfile.prebuilt's server stage is Containerfile's, its binary staged rather than compiled"
[ "$failed" = 0 ] && echo "all tests passed"
exit "$failed"
