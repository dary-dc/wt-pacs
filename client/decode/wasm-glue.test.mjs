// node client/decode/wasm-glue.test.mjs — a decoder build is loaded only when it is the one the manifest pins.
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const BUILT = `${ROOT}client/decode/wasm/built`;
// The glue is evaluated as a classic script, which in node reaches for require and for fetch on paths.
globalThis.require = createRequire(import.meta.url);
globalThis.fetch = async (url) => new Response(readFileSync(String(url).replace(/^file:\/\//, "")));
const { built, instantiate } = await import("./wasm-glue.js");

let failed = 0;
const check = (ok, what) => {
  if (!ok) {
    failed++;
    console.error(`FAIL ${what}`);
  }
};
const refusal = (d) => instantiate(d, "Dav1dModule").then(() => "loaded", (e) => e.message);

if (!existsSync(`${BUILT}/dav1d/dav1d.js`)) {
  console.log(`SKIPPED: the decoder manifest check — no ${BUILT} (client/decode/wasm/build/build.sh)`);
  process.exit(0);
}
/** The pinned build loads; the same descriptor over another build's wasm or glue is refused by name. */
const d = await built("dav1d");
globalThis.__dirname = d.dir;
const M = await instantiate(d, "Dav1dModule");
check(typeof M._av1_open === "function", "the pinned dav1d build loads");
const other = `${BUILT}/openjph/openjph.wasm`;
check(/openjph\.wasm is not the pinned build/.test(await refusal({ ...d, wasm: other })), "another build's wasm is refused");
check(/dav1d\.wasm is not the pinned build/.test(await refusal({ ...d, sha256: { ...d.sha256, wasm: "0".repeat(64) } })), "a wasm the manifest does not name is refused");
check(/openjph\.js is not the pinned build/.test(await refusal({ ...d, glue: `${BUILT}/openjph/openjph.js` })), "another build's glue is refused");
check(await built("nothing").then(() => false, (e) => /no nothing\/nothing\.js in the decoder manifest/.test(e.message)), "a build the manifest lacks is refused");

console.log(failed ? `${failed} failed` : "decoder manifest check: ok");
process.exit(failed ? 1 : 0);
