#!/usr/bin/env bash
# gen_dev_cert.sh in a temp root with OPENSSL naming a wrapper, as a laptop without the command runs it in a container:
# every openssl call goes through the wrapper, none to PATH's, and the transport file names the certificate's hash.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT
mkdir -p "$T/server/scripts" "$T/client" "$T/bin"
cp "$ROOT/server/scripts/gen_dev_cert.sh" "$T/server/scripts/"
REAL="$(command -v openssl)"
printf '#!/bin/sh\necho "openssl on PATH ran" >&2\nexit 127\n' > "$T/bin/openssl"
printf '#!/bin/sh\necho x >> "%s/calls"\nexec "%s" "$@"\n' "$T" "$REAL" > "$T/wrapper"
chmod +x "$T/bin/openssl" "$T/wrapper"
failed=0
check() { if [ "$1" = "$2" ]; then echo "ok: $3"; else echo "FAIL: $3 (got '$1', want '$2')"; failed=1; fi; }
hash() { "$REAL" x509 -in "$T/server/dev-cert/cert.pem" -outform DER | "$REAL" dgst -sha256 | awk '{print $2}'; }

PATH="$T/bin:$PATH" OPENSSL="sh $T/wrapper" bash "$T/server/scripts/gen_dev_cert.sh" >/dev/null
check "$(jq -r .cert_sha256 "$T/client/dev-transport.json")" "$(hash)" "the transport file names the certificate's hash"
check "$("$REAL" x509 -in "$T/server/dev-cert/cert.pem" -noout -text | grep -c 'ASN1 OID: prime256v1')" 1 "a P-256 key"
made=$(wc -l < "$T/calls")
PATH="$T/bin:$PATH" OPENSSL="sh $T/wrapper" bash "$T/server/scripts/gen_dev_cert.sh" --if-needed >/dev/null
check "$(wc -l < "$T/calls")" "$((made + 1))" "--if-needed asks the wrapper whether the certificate still holds, and stops"
[ $failed -eq 0 ] && echo "gen_dev_cert.sh runs its openssl from OPENSSL"
exit $failed
