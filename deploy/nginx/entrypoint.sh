#!/bin/sh
# Substitute only STUDY, so nginx's own $uri survives envsubst.
set -eu
: "${STUDY:=us_cine_smoke}"
export STUDY
envsubst '${STUDY}' < /etc/nginx/templates/wt-pacs.conf.template > /etc/nginx/conf.d/default.conf
exec nginx -g 'daemon off;'
