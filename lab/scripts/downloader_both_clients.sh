#!/usr/bin/env bash
# D2d: the downloader over each transport client in turn, against a real server. A fill and a
# cold ask per arm, interleaved with the order reversed each round.
# docs/ARCHITECTURE.md §Capabilities.
#
#   ROUNDS=4 lab/scripts/downloader_both_clients.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

if ! node -e 'require("playwright")' 2>/dev/null; then
  export NODE_PATH="${NODE_PATH:-$(npm root -g 2>/dev/null || true)}"
  if ! node -e 'require("playwright")' 2>/dev/null; then
    echo "SKIPPED: downloader both clients — playwright is not installed"; exit 0
  fi
fi
CHROME="$(node -e 'console.log(process.env.CHROME_PATH || require("playwright").chromium.executablePath())' 2>/dev/null || true)"
[[ -x "$CHROME" ]] || { echo "SKIPPED: downloader both clients — no headless Chromium"; exit 0; }
export CHROME_PATH="$CHROME"
[[ -f client/transport-wasm/pkg/transport_wasm_bg.wasm ]] || {
  echo "SKIPPED: downloader both clients — no pkg/, run client/transport-wasm/build.sh"; exit 0; }

ROUNDS="${ROUNDS:-4}"
FRAMES="${FRAMES:-12}"
cargo build -q -p exact-server -p pack-study
BIN="${CARGO_TARGET_DIR:-target}/debug"
T="$(mktemp -d)"
SERVER=""; STATIC=""
CFG="$ROOT/client/dev-transport.json"
if [[ -f "$CFG" ]]; then cp "$CFG" "$T/cfg.bak"; fi
restore() {
  kill "$SERVER" "$STATIC" 2>/dev/null || true
  if [[ -f "$T/cfg.bak" ]]; then cp "$T/cfg.bak" "$CFG"; fi
  rm -rf "$T"
}
trap restore EXIT

openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -keyout "$T/key.pem" -out "$T/cert.pem" \
  -days 2 -nodes -subj '/CN=localhost' -addext 'basicConstraints=critical,CA:FALSE' \
  -addext 'keyUsage=critical,digitalSignature' -addext 'extendedKeyUsage=serverAuth' \
  -addext 'subjectAltName=DNS:localhost,IP:127.0.0.1' 2>/dev/null
HASH="$(openssl x509 -in "$T/cert.pem" -outform DER | openssl dgst -sha256 | awk '{print $2}')"

# The harness checks decoded pixels against the encoder's input, so the study must be real
# codestreams, not random bytes.
SRC=lab/fixtures/decode_c512  # the harness checks against this set's .sha256
mkdir -p "$T/frames"
i=0
for f in "$SRC"/*.j2c; do cp "$f" "$T/frames/$(printf '%03d' "$i").htj2k"; i=$((i+1)); done
while [[ $i -lt $FRAMES ]]; do
  cp "$T/frames/000.htj2k" "$T/frames/$(printf '%03d' "$i").htj2k"; i=$((i+1))
done
echo "{\"frameCount\": $FRAMES}" > "$T/metadata.json"
"$BIN/pack-study" --metadata "$T/metadata.json" --frames "$T/frames" --output "$T/study.sbnd" >/dev/null

WT_PORT=$((30000 + RANDOM % 20000))
PORT=$((20000 + RANDOM % 10000))
printf '{"wt_url": "https://127.0.0.1:%s/", "cert_sha256": "%s"}\n' "$WT_PORT" "$HASH" > "$CFG"
RUST_LOG=exact_server=warn "$BIN/exact-server" --port "$WT_PORT" --study "$T/study.sbnd" \
  --cert-pem "$T/cert.pem" --key-pem "$T/key.pem" >"$T/srv.log" 2>&1 &
SERVER=$!
for _ in $(seq 100); do grep -q "wt_url=" "$T/srv.log" 2>/dev/null && break; sleep 0.1; done
python3 server/dev-server.py --port "$PORT" >"$T/static.log" 2>&1 &
STATIC=$!
for _ in $(seq 50); do curl -sf "http://127.0.0.1:$PORT/harness/downloader.html" >/dev/null 2>&1 && break; sleep 0.1; done

: > "$T/rows.tsv"
for r in $(seq 1 "$ROUNDS"); do
  if (( r % 2 )); then arms=(ts wasm); else arms=(wasm ts); fi
  for arm in "${arms[@]}"; do
    url="http://127.0.0.1:$PORT/harness/downloader.html"
    if [[ "$arm" == wasm ]]; then url="$url?transport=/client/transport-wasm/session-adapter.js"; fi
    out="$(node client/conformance/drive_downloader.cjs "$url" 2>&1 || true)"
    printf '%s\t%s\n' "$arm" "$(tr '\n' '|' <<<"$out")" >> "$T/rows.tsv"
  done
  echo "round $r/$ROUNDS" >&2
done

python3 - "$T/rows.tsv" <<'PY'
import re, sys, statistics as st
rows = [l.split('\t', 1) for l in open(sys.argv[1]).read().splitlines() if l]
got = {}
for arm, blob in rows:
    start = re.search(r'decoders up in (\d+) ms', blob)
    ask = re.search(r'single ask .*?sha (ok|MISMATCH)', blob)
    fill = re.search(r'fill .*?(\d+) ms', blob)
    d = got.setdefault(arm, {'start': [], 'fill': [], 'sha': set()})
    if start: d['start'].append(int(start.group(1)))
    if fill: d['fill'].append(int(fill.group(1)))
    if ask: d['sha'].add(ask.group(1))
med = lambda a: st.median(a) if a else float('nan')
print(f"\n{'arm':6} {'n':>3} {'start+dial ms':>15} {'fill ms':>10}  single ask")
for arm in ('ts', 'wasm'):
    d = got.get(arm)
    if not d: continue
    print(f"{arm:6} {len(d['start']):>3} {med(d['start']):>15.0f} {med(d['fill']):>10.0f}  "
          f"{','.join(sorted(d['sha'])) or 'not seen'}")
PY
