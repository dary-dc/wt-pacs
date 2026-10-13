#!/usr/bin/env bash
# Row NETMEASURE's arms beside the builds: the A/A copies under second names, the fill's P-COPY worker, every set's
# variants.json, and the em6 glue with its restored names undone (the .wasm-fetch check's mutant).
#
#   lab/decode-bench/netrules/arms.sh [FRAMES]      default lab/.av1-work/netrules — lab/decode-bench/netrules/README.md
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
W="$ROOT/lab/.openjph-build/wasm" V="$ROOT/lab/.av1-build/ojph-wasm" FRAMES="${1:-$ROOT/lab/.av1-work/netrules}"
DEL="$ROOT/client/decode/wasm/built/openjph/openjph"
mkdir -p "$V"
for ext in js wasm; do
  cp "$DEL.$ext" "$W/delcopy.$ext"
  cp "$DEL.$ext" "$V/del-3.1.74.$ext"
  cp "$DEL.$ext" "$V/delcopy-3.1.74.$ext"
  cp "$W/em6.$ext" "$V/em6-6.0.11.$ext"
done
cp "$W/em6.wasm" "$W/em6mut.wasm"
sed 's/if(Module\["wasmBinary"\])wasmBinary=Module\["wasmBinary"\];//' "$W/em6.js" > "$W/em6mut.js"
! cmp -s "$W/em6.js" "$W/em6mut.js" || { echo "em6.js: the wasmBinary line moved" >&2; exit 2; }
# The fill's copy arm: the product's decoder worker on P-COPY's codec module, nothing else changed.
sed -e 's#import(m.decoder?.codec === "av1" ? "./av1.js" : "./htj2k.js")#import("/lab/decode-bench/copy/htj2k-copy.js")#' \
  -e 's#new URL("./wasm/vendor/#new URL("/client/decode/wasm/vendor/#' "$ROOT/client/decode/decoder.js" > "$FRAMES/copy-decoder.js"
grep -q 'htj2k-copy.js' "$FRAMES/copy-decoder.js" && grep -q '"/client/decode/wasm/vendor/' "$FRAMES/copy-decoder.js" \
  || { echo "client/decode/decoder.js moved" >&2; exit 2; }
REL="/${FRAMES#"$ROOT"/}/copy-decoder.js"
for v in "$FRAMES"/*/variants.json; do
  python3 - "$v" "$REL" <<'PY'
import json, sys
p, worker = sys.argv[1:]
s = json.load(open(p))
b = {"ext": "htj2k", "codec": "htj2k", "openjph": "delivered"}
s["variants"] = {"del": b, "delname": b, "delcopy": {**b, "openjph": "delcopy"}, "em6": {**b, "openjph": "em6"},
                 "copy": {**b, "openjph": "copy", "worker": worker}, "need": {**b, "startOnNeed": True}}
json.dump(s, open(p, "w"), indent=1)
PY
done
sha256sum "$W"/{delcopy,em6,em6mut,pt,copy}.{js,wasm} "$DEL".{js,wasm} 2>/dev/null
