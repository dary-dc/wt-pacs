// Writes each codestream's samples as decoded by the client's OpenJPH-WASM to FILE.wasm.u16 (Cell E's native comparison).
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
globalThis.require = createRequire(import.meta.url);
globalThis.fetch = async (url) => new Response(readFileSync(String(url).replace(/^file:\/\//, "")));
const ROOT = new URL("../../../", import.meta.url).pathname;
const { built } = await import(`${ROOT}client/decode/wasm-glue.js`);
const htj2k = await import(`${ROOT}client/decode/htj2k.js`);
const d = await built("openjph"); globalThis.__dirname = d.dir; await htj2k.init(d);
for (const f of process.argv.slice(2)) { const r = htj2k.decodeFrame(new Uint8Array(readFileSync(f))); writeFileSync(f + ".wasm.u16", new Uint8Array(r.sab, 0, r.byteCount)); }
