// node ingest/coded-frames/check.mjs DIR ... — every item ingest.py wrote, decoded by the client's reader
// (client/decode/av1.js, dav1d-WASM, as a browser without WebCodecs), against its source's checksum.
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const OUT = fileURLToPath(new URL("../../lab/.av1-build/out", import.meta.url));
// The glue is evaluated as a classic script, which in node reaches for require, __dirname and fetch on paths.
globalThis.require = createRequire(import.meta.url);
globalThis.__dirname = OUT;
globalThis.fetch = async (url) => new Response(readFileSync(url));

const av1 = await import("../../client/decode/av1.js");
await av1.init({ glue: `${OUT}/simd.js`, wasm: `${OUT}/simd.wasm`, dir: OUT });
let bad = 0;
for (const dir of process.argv.slice(2)) {
  const items = readdirSync(dir).filter((f) => f.endsWith(".av1")).sort();
  let exact = 0;
  let ms = 0;
  for (const f of items) {
    const t0 = performance.now();
    const got = await av1.decodeFrame(new Uint8Array(readFileSync(`${dir}/${f}`)));
    ms += performance.now() - t0;
    const sum = createHash("sha256").update(new Uint8Array(got.sab)).digest("hex");
    if (sum === readFileSync(`${dir}/${f.replace(".av1", ".sha256")}`, "utf8").trim()) exact++;
  }
  bad += items.length - exact;
  console.log(`${dir}: ${exact}/${items.length} exact through the reader, ${(ms / items.length).toFixed(1)} ms an item`);
}
process.exit(bad ? 1 : 0);
