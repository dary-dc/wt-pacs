#!/bin/sh
# Substitute only SERIES, TLS_LISTEN and WT_ORIGIN, so nginx's own $uri survives envsubst. TLS when /tls holds a certificate,
# which the transport serves too (compose.yml): the page then dials its own host and reads no transport file.
set -eu
: "${SERIES:?name the series served: deploy/README.md}" "${WT_URL:=https://127.0.0.1:4433/}" "${CLIENT:=ts}"
TLS_LISTEN="" WT_ORIGIN='https://$host:4433' where=""
if [ -f /tls/cert.pem ] && [ -f /tls/key.pem ]; then
  TLS_LISTEN="listen 443 ssl; http2 on; ssl_certificate /tls/cert.pem; ssl_certificate_key /tls/key.pem;"
else
  WT_ORIGIN=$(printf '%s' "$WT_URL" | sed -E 's#^(https://[^/]+).*#\1#') where="--transport-file /wt/dev-transport.json"
fi
export SERIES TLS_LISTEN WT_ORIGIN
envsubst '${SERIES} ${TLS_LISTEN} ${WT_ORIGIN}' < /etc/nginx/templates/wt-pacs.conf.template > /etc/nginx/conf.d/default.conf
page.sh --client "$CLIENT" $where < /usr/share/wt-pacs/index.html > /srv/wt-pacs/client/viewer/index.html
exec nginx -g 'daemon off;'
