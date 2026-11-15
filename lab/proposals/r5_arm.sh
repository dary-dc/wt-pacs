#!/usr/bin/env bash
# R5's arms (docs/lines/proposals.md §P6, §R5, its amendment): a host root beside TIP whose page is TIP's but for
# FORM: `today` (unchanged), `lazy` (b: no dav1d preload or fetch at start; fetched on first use) or `probe` (c: no
# preload; each worker probes the metadata's layouts at start and fetches dav1d at once on a refusal, no
# VideoDecoder or over 10 bits). FAIL, when given, makes WebCodecs fail that frame index once per worker (the lab's
# forced mid-group failure), in any form. dev-server.py serves from its own checkout.
#
#   lab/proposals/r5_arm.sh TIP ROOT FORM [FAIL]
set -euo pipefail
TIP=$1 ROOT=$2 FORM=$3 FAIL=${4:-}
mkdir -p "$ROOT/server"
rm -rf "$ROOT/client" && cp -a "$TIP/client" "$ROOT/client"
cp "$TIP/server/dev-server.py" "$ROOT/server/"
ln -sfn "$TIP/lab" "$ROOT/lab"
ln -sfn "$TIP/fixtures" "$ROOT/fixtures"
python3 - "$ROOT/client" "$FORM" "$FAIL" <<'PY'
import sys
root, form, fail = sys.argv[1:]

def patch(rel, pairs):
    p = f"{root}/{rel}"
    s = open(p).read()
    for old, new in pairs:
        assert s.count(old) == 1, (rel, old)
        s = s.replace(old, new)
    open(p, "w").write(s)

start = (
    '  importer("./av1-dav1d.js").catch(() => {});\n',
    '  for (const url of [d.glue, d.wasm]) if (url) fetch(url).then((r) => r.arrayBuffer()).catch(() => {});\n',
)
if form in ("lazy", "probe"):
    patch("viewer/head.js", [
        ('"av1-frame.js", "av1-dav1d.js", "av1-webcodecs.js"', '"av1-frame.js", "av1-webcodecs.js"'),
        ('    link("preload", `${dec}/wasm/built/${name}/${name}.js`, "fetch");\n'
         '    link("preload", `${dec}/wasm/built/${name}/${name}.wasm`, "fetch");\n',
         '    if (!av1) link("preload", `${dec}/wasm/built/${name}/${name}.js`, "fetch");\n'
         '    if (!av1) link("preload", `${dec}/wasm/built/${name}/${name}.wasm`, "fetch");\n'),
    ])
if form == "lazy":
    patch("decode/av1.js", [(start[0], ""), (start[1], "")])
if form == "probe":
    patch("decode/av1.js", [
        (start[0], ""),
        (start[1],
         '  const fetchDav1d = () => {\n'
         '    importer("./av1-dav1d.js").catch(() => {});\n'
         '    for (const url of [d.glue, d.wasm]) if (url) fetch(url).then((r) => r.arrayBuffer()).catch(() => {});\n'
         '  };\n'
         '  if (!d.layouts) fetchDav1d();\n'
         '  else webcodecs(d.layouts).then((r) => r.refusal && fetchDav1d(), fetchDav1d);\n'),
    ])
    patch("viewer/viewer.js", [(
        '{ codec: "av1", lossy: meta.lossy !== undefined, refuseWebCodecs: options.refuseWebCodecs, ',
        '{ codec: "av1", lossy: meta.lossy !== undefined, refuseWebCodecs: options.refuseWebCodecs, '
        'layouts: meta.lossy && meta.lossy.depth <= 10 ? [`g${meta.lossy.depth}`, ...(meta.split ? ["g8"] : [])] : undefined, ',
    )])
elif form != "today" and form != "lazy":
    sys.exit(f"form {form}: today, lazy or probe")
if fail:
    patch("decode/av1-webcodecs.js", [(
        'export const picture = (bytes, unit, which = "top") => stream(which).picture(bytes, unit);\n',
        'let forced = false;\n'
        'export const picture = (bytes, unit, which = "top") => {\n'
        f'  if (which === "top" && unit?.index === {int(fail)} && !forced) return (forced = true), Promise.reject(new Error("lab: forced decode error"));\n'
        '  return stream(which).picture(bytes, unit);\n'
        '};\n',
    )])
PY
