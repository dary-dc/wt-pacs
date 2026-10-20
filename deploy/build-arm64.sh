#!/bin/sh
# series-server for aarch64 Linux, cross-built on any host in Containerfile's pinned rust image, then checked there:
# it needs no glibc past bookworm's, and it starts on the smoke series under user-mode emulation. deploy/README.md
# Writes target/aarch64-unknown-linux-gnu/release/series-server. RUNTIME, REGISTRY and BUILD_CA as for compose.
set -eu
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RUNTIME="${RUNTIME:-docker}"
REGISTRY="${REGISTRY:-docker.io/library}"
image="$(sed -n 's#^FROM ${REGISTRY}/\(rust:[^ ]*\) AS workspace$#\1#p' "$ROOT/deploy/Containerfile")"
[ -n "$image" ] || { echo "no rust image in deploy/Containerfile" >&2; exit 2; }
ca=""
[ -n "${BUILD_CA:-}" ] && ca="-v $BUILD_CA:/run/secrets/build_ca:ro"
mkdir -p "$HOME/.cache/wt-pacs-cargo"

"$RUNTIME" run --rm $ca -v "$ROOT":/src -v "$HOME/.cache/wt-pacs-cargo":/usr/local/cargo/registry -w /src \
  "$REGISTRY/$image" sh -euc '
if [ -s /run/secrets/build_ca ]; then export CARGO_HTTP_CAINFO=/run/secrets/build_ca CURL_CA_BUNDLE=/run/secrets/build_ca SSL_CERT_FILE=/run/secrets/build_ca; fi
apt-get update -q >/dev/null
apt-get install -y -q --no-install-recommends gcc-aarch64-linux-gnu libc6-dev-arm64-cross qemu-user-static >/dev/null
rustup target add aarch64-unknown-linux-gnu
export CARGO_TARGET_AARCH64_UNKNOWN_LINUX_GNU_LINKER=aarch64-linux-gnu-gcc
cargo build --release --locked -p series-server --target aarch64-unknown-linux-gnu
B=target/aarch64-unknown-linux-gnu/release/series-server

glibc="$(aarch64-linux-gnu-objdump -T "$B" | grep -o "GLIBC_[0-9.]*" | sort -uV | tail -1)"
[ "$(printf "%s\n" "$glibc" GLIBC_2.36 | sort -V | tail -1)" = GLIBC_2.36 ] \
  || { echo "FAIL: needs $glibc, past bookworm'"'"'s GLIBC_2.36" >&2; exit 1; }
echo "ok: needs $glibc at most"

T="$(mktemp -d)"
openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -keyout "$T/key.pem" -out "$T/cert.pem" \
  -days 1 -nodes -subj /CN=localhost 2>/dev/null
qemu-aarch64-static -L /usr/aarch64-linux-gnu "$B" --series fixtures/us_cine_smoke/us_cine_smoke.sbnd \
  --cert-pem "$T/cert.pem" --key-pem "$T/key.pem" >"$T/log" 2>&1 &
for _ in $(seq 100); do grep -q "series-server ready" "$T/log" && break; kill -0 $! 2>/dev/null || break; sleep 0.2; done
kill $! 2>/dev/null || true
grep -q "series-server ready" "$T/log" || { echo "FAIL: no banner under emulation:" >&2; cat "$T/log" >&2; exit 1; }
echo "ok: starts under emulation"
'
