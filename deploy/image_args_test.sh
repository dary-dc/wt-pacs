#!/bin/sh
# Claim: the images a build ships, `server` and `web`, carry the commit they were built from as the OCI revision
# label, from the build argument REVISION that compose passes.
set -eu
cd "$(dirname "$0")/.."
stage() { awk -v s="$1" '/^FROM /{on = ($NF == s)} on' deploy/Containerfile; }
failed=0
check() { if [ "$1" -gt 0 ]; then echo "ok: $2"; else echo "FAIL: $2"; failed=1; fi; }
for s in server web; do
  check "$(stage "$s" | grep -cx 'ARG REVISION=unknown')" "$s declares the build argument REVISION"
  check "$(stage "$s" | grep -cx 'LABEL org.opencontainers.image.revision="${REVISION}"')" "$s labels the image with it"
done
check "$(grep -c 'REVISION: "${REVISION:-unknown}"' deploy/compose.yml)" "compose passes REVISION to every build"
exit "$failed"
