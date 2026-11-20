# Temporary per-frame stage timing for the fill profile, in the M5 run's worktree; `git checkout` to remove.
import sys
R = sys.argv[1] + "/"
N = 'performance.now()'
LOG = 'console.log("PROF " + JSON.stringify(p));'
E = {
"lab/opfs-cache/arms-decoder.js": [
  ("  const stamps = { ...m.stamps, decodeStart: abs() };\n  let into = null;\n",
   "  const stamps = { ...m.stamps, decodeStart: abs() };\n  let into = null;\n  const p = { who: \"arm\", i: m.index, at: stamps.decodeStart, t0: " + N + " };\n"),
  ("    dec.decode();\n", "    dec.decode();\n    p.decode = " + N + ";\n"),
  ("    if (bytes !== out) bytes.set(out);\n", "    if (bytes !== out) bytes.set(out);\n    p.copy = " + N + ";\n"),
  ("    const exact = xxh3", "    p.finish = " + N + ";\n    const exact = xxh3"),
  ("    let stored = false;\n", "    p.hash = " + N + ";\n    let stored = false;\n"),
  ("    stamps.decodeEnd = abs();\n", "    p.write = " + N + ";\n    stamps.decodeEnd = abs();\n"),
  ("    postMessage({ kind: \"done\", index: m.index, gen: m.gen, byteCount: out.length",
   "    p.post = " + N + ";\n    " + LOG + "\n    postMessage({ kind: \"done\", index: m.index, gen: m.gen, byteCount: out.length"),
],
"client/decode/decoder.js": [
  ("  const stamps = { ...m.stamps, decodeStart: abs() };\n", "  const stamps = { ...m.stamps, decodeStart: abs() };\n  const p = { who: \"today\", i: m.index, at: stamps.decodeStart, t0: " + N + " };\n"),
  ("    const r = await checked(m, await codec.decodeFrame(m.bytes, m, preview));\n",
   "    const d0 = await codec.decodeFrame(m.bytes, m, preview);\n    p.decode = " + N + ";\n    const r = await checked(m, d0);\n    p.hash = " + N + ";\n"),
  ("    toConsumer.postMessage(picture(m, r, stamps));\n", "    toConsumer.postMessage(picture(m, r, stamps));\n    p.post = " + N + ";\n    " + LOG + "\n"),
],
"client/decode/htj2k.js": [
  ("  dec.decode();\n  const out = dec.getDecodedBuffer();\n  const wide", "  dec.decode();\n  globalThis.__decoded = performance.now();\n  const out = dec.getDecodedBuffer();\n  const wide"),
],
"client/viewer/store.js": [
  ("async function write({ index, info }) {\n", "async function write({ index, info }) {\n  const p = { who: \"store\", i: index, at: performance.timeOrigin + performance.now(), t0: performance.now() };\n  try { return await write0({ index, info }); } finally { p.write = performance.now(); " + LOG + " }\n}\nasync function write0({ index, info }) {\n"),
],
}
for f, es in E.items():
    b = open(R + f).read()
    for a, c in es:
        assert b.count(a) == 1, (f, a)
        b = b.replace(a, c)
    open(R + f, "w").write(b)
# split today's decode from its copy: the htj2k mark read in decoder.js
f = R + "client/decode/decoder.js"
b = open(f).read().replace("    p.decode = " + N + ";\n", "    p.decode = globalThis.__decoded;\n    p.copy = " + N + ";\n")
open(f, "w").write(b)
print("prof staged")
