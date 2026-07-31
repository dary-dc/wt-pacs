#!/usr/bin/env bash
# Regenerate dev WebTransport cert and client/dev-transport.json
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
CERT_DIR="$ROOT/server/dev-cert"

mkdir -p "$CERT_DIR"

openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 \
  -keyout "$CERT_DIR/key.pem" \
  -out "$CERT_DIR/cert.pem" \
  -days 10 -nodes \
  -subj '/CN=localhost' \
  -addext 'basicConstraints=critical,CA:FALSE' \
  -addext 'keyUsage=critical,digitalSignature' \
  -addext 'extendedKeyUsage=serverAuth' \
  -addext 'subjectAltName=DNS:localhost,IP:127.0.0.1' 2>/dev/null

HASH="$(openssl x509 -in "$CERT_DIR/cert.pem" -outform DER | openssl dgst -sha256 | awk '{print $2}')"
