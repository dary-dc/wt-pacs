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
echo "cert_sha256=$HASH"

python3 - "$ROOT/client" "$HASH" <<'PY'
import json
import sys
from pathlib import Path

client_dir = Path(sys.argv[1])
cert_hash = sys.argv[2]
path = client_dir / "dev-transport.json"
payload = {
    "wt_url": "https://127.0.0.1:4433/",
    "cert_sha256": cert_hash,
}
path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
print(f"wrote {path}")
PY

echo "Wrote $CERT_DIR/cert.pem and key.pem (gitignored; expires in ~10 days)"
