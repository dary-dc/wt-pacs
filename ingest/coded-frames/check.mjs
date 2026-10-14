// node ingest/coded-frames/check.mjs DIR ... — every payload (NNN.av1) or codestream (NNN.htj2k) ingest wrote,
// decoded by the client's codec module (dav1d-WASM, as a browser without WebCodecs; OpenJPH), against its source's checksum.
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const OUT = fileURLToPath(new URL("../../client/decode/wasm/built/dav1d", import.meta.url));
const OJPH = fileURLToPath(new URL("../../client/decode/wasm/built/openjph", import.meta.url));
// The glue is evaluated as a classic script, which in node reaches for require, __dirname and fetch on paths.
globalThis.require = createRequire(import.meta.url);
globalThis.__dirname = OUT;
globalThis.fetch = async (url) => new Response(readFileSync(url));

const av1 = await import("../../client/decode/av1.js");
await av1.init({ glue: `${OUT}/dav1d.js`, wasm: `${OUT}/dav1d.wasm`, dir: OUT });
const htj2k = await import("../../client/decode/htj2k.js");
await htj2k.init({ glue: `${OJPH}/openjph.js`, wasm: `${OJPH}/openjph.wasm`, dir: OJPH });
const MODULES = { av1, htj2k };
let bad = 0;
for (const dir of process.argv.slice(2)) {
  const payloads = readdirSync(dir).filter((f) => /\.(av1|htj2k)$/.test(f)).sort();
  let exact = 0;
  let ms = 0;
  for (const f of payloads) {
    const t0 = performance.now();
    const got = await MODULES[f.split(".").pop()].decodeFrame(new Uint8Array(readFileSync(`${dir}/${f}`)));
    ms += performance.now() - t0;
    const sum = createHash("sha256").update(new Uint8Array(got.sab)).digest("hex");
    if (sum === readFileSync(`${dir}/${f.replace(/\.\w+$/, ".sha256")}`, "utf8").trim()) exact++;
  }
  bad += payloads.length - exact;
  console.log(`${dir}: ${exact}/${payloads.length} exact through the reader, ${(ms / payloads.length).toFixed(1)} ms a payload`);
}
process.exit(bad ? 1 : 0);
