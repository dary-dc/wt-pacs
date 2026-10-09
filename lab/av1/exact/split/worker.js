/** Every payload of the manifest browser.mjs serves, through verify.js in this engine; rows posted in batches. */
import { reader, verify } from "./verify.js";

const post = (path, body) => fetch(path, { method: "POST", body: JSON.stringify(body) });
const bytes = async (url) => new Uint8Array(await (await fetch(url)).arrayBuffer());
// SubtleCrypto refuses a view on shared memory.
const sha256 = async (b) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", Uint8Array.from(b)))]
  .map((x) => x.toString(16).padStart(2, "0")).join("");

try {
  const OUT = "/lab/.av1-build/out";
  const { mixed } = await (await fetch("/sk/config")).json();
  const av1 = await reader({ glue: `${OUT}/simd.js`, wasm: `${OUT}/simd.wasm`, dir: OUT, mixed });
  const cells = await (await fetch("/sk/manifest")).json();
  for (const c of cells) {
    const meta = await (await fetch(`${c.set}/metadata.json`)).json();
    const rows = [];
    for (const i of c.payloads) {
      const truth = (await (await fetch(`${c.set}/${i}.sha256`)).text()).trim();
      rows.push(await verify(av1, await bytes(`${c.dir}/${i}.av1`), await bytes(`${c.set}/${i}.raw`), meta, truth, sha256));
    }
    await post("/sk/rows", { cell: c.cell, bits: meta.bits, signed: meta.signed, rows });
  }
  await post("/sk/done", {});
} catch (e) {
  await post("/sk/done", { error: String(e?.stack ?? e) });
}
