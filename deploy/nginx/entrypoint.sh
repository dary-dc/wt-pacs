#!/bin/sh
# Substitute only SERIES, so nginx's own $uri survives envsubst.
set -eu
: "${SERIES:=us_cine_smoke}"
export SERIES
envsubst '${SERIES}' < /etc/nginx/templates/wt-pacs.conf.template > /etc/nginx/conf.d/default.conf
exec nginx -g 'daemon off;'
