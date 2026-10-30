#!/bin/sh
# The server container's start: a fresh certificate (a hash-pinned one must stay under 14 days), the transport file
# naming it, written whole, then the server — restarted by `timeout` before the certificate ages out. deploy/README.md
# A certificate mounted at /supplied (cert.pem, key.pem) is used instead, and no file: the browser verifies its chain.
set -eu
: "${SERIES:=us_cine_smoke}" "${WT_URL:=https://127.0.0.1:4433/}" "${RESTART_AFTER:=9d}"
umask 077
rm -f /run/wt-pacs/dev-transport.json
cert=/certs/cert.pem key=/certs/key.pem
if [ -f /supplied/cert.pem ] && [ -f /supplied/key.pem ]; then
  cert=/supplied/cert.pem key=/supplied/key.pem
else
  openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -keyout "$key" -out "$cert" \
    -days 10 -nodes -subj /CN=localhost -addext basicConstraints=critical,CA:FALSE \
    -addext keyUsage=critical,digitalSignature -addext extendedKeyUsage=serverAuth \
    -addext "subjectAltName=DNS:localhost,IP:127.0.0.1" 2>/dev/null
  hash=$(openssl x509 -in "$cert" -outform DER | openssl dgst -sha256 | awk '{print $2}')
  printf '{"wt_url": "%s", "cert_sha256": "%s"}\n' "$WT_URL" "$hash" > /run/wt-pacs/.dev-transport.json
  chmod 0644 /run/wt-pacs/.dev-transport.json
  mv -f /run/wt-pacs/.dev-transport.json /run/wt-pacs/dev-transport.json
fi
exec timeout "$RESTART_AFTER" series-server --series "/studies/$SERIES.sbnd" --cert-pem "$cert" \
  --key-pem "$key" "$@"
