#!/bin/sh
# The server container's start: a fresh certificate (a hash-pinned one must stay under 14 days), the transport file
# naming it, written whole, then the server — restarted by `timeout` before the certificate ages out. deploy/README.md
set -eu
: "${SERIES:=us_cine_smoke}" "${WT_URL:=https://127.0.0.1:4433/}" "${RESTART_AFTER:=9d}"
umask 077
rm -f /run/wt-pacs/dev-transport.json
openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -keyout /certs/key.pem -out /certs/cert.pem \
  -days 10 -nodes -subj /CN=localhost -addext basicConstraints=critical,CA:FALSE \
  -addext keyUsage=critical,digitalSignature -addext extendedKeyUsage=serverAuth \
  -addext "subjectAltName=DNS:localhost,IP:127.0.0.1" 2>/dev/null
hash=$(openssl x509 -in /certs/cert.pem -outform DER | openssl dgst -sha256 | awk '{print $2}')
printf '{"wt_url": "%s", "cert_sha256": "%s"}\n' "$WT_URL" "$hash" > /run/wt-pacs/.dev-transport.json
chmod 0644 /run/wt-pacs/.dev-transport.json
mv -f /run/wt-pacs/.dev-transport.json /run/wt-pacs/dev-transport.json
exec timeout "$RESTART_AFTER" series-server --series "/studies/$SERIES.sbnd" --cert-pem /certs/cert.pem \
  --key-pem /certs/key.pem "$@"
