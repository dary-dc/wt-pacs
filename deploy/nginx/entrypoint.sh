#!/bin/sh
# Substitute only SERIES, EXACT_SERIES, TLS_LISTEN and WT_ORIGINS, so nginx's own $uri survives envsubst. TLS when /tls holds a certificate.
set -eu
: "${SERIES:=us_cine_smoke}" "${WT_URL:=https://127.0.0.1:4433/}" "${EXACT_SERIES:=}" "${EXACT_WT_URL:=https://127.0.0.1:4434/}"
origin() { printf '%s' "$1" | sed -E 's#^(https://[^/]+).*#\1#'; }
WT_ORIGINS=$(origin "$WT_URL")
if [ -n "$EXACT_SERIES" ]; then
  printf '%s' "$EXACT_SERIES" | grep -Eqx '[A-Za-z0-9_.-]+' && [ "$EXACT_SERIES" != . ] && [ "$EXACT_SERIES" != .. ] \
    || { echo "EXACT_SERIES \"$EXACT_SERIES\" is not a series id" >&2; exit 1; }
  grep -Eq "\"exactSeries\" *: *\"$EXACT_SERIES\"" "/studies/$SERIES.metadata.json" \
    || { echo "/studies/$SERIES.metadata.json names no exactSeries \"$EXACT_SERIES\"" >&2; exit 1; }
  WT_ORIGINS="$WT_ORIGINS $(origin "$EXACT_WT_URL")"
fi
TLS_LISTEN=""
if [ -f /tls/cert.pem ] && [ -f /tls/key.pem ]; then
  TLS_LISTEN="listen 443 ssl; http2 on; ssl_certificate /tls/cert.pem; ssl_certificate_key /tls/key.pem;"
fi
export SERIES EXACT_SERIES TLS_LISTEN WT_ORIGINS
envsubst '${SERIES} ${EXACT_SERIES} ${TLS_LISTEN} ${WT_ORIGINS}' < /etc/nginx/templates/wt-pacs.conf.template > /etc/nginx/conf.d/default.conf
exec nginx -g 'daemon off;'
