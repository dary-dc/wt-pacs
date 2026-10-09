#!/bin/sh
# Substitute only SERIES and TLS_LISTEN, so nginx's own $uri survives envsubst. TLS when /tls holds a certificate.
set -eu
: "${SERIES:=us_cine_smoke}"
TLS_LISTEN=""
if [ -f /tls/cert.pem ] && [ -f /tls/key.pem ]; then
  TLS_LISTEN="listen 443 ssl; http2 on; ssl_certificate /tls/cert.pem; ssl_certificate_key /tls/key.pem;"
fi
export SERIES TLS_LISTEN
envsubst '${SERIES} ${TLS_LISTEN}' < /etc/nginx/templates/wt-pacs.conf.template > /etc/nginx/conf.d/default.conf
exec nginx -g 'daemon off;'
