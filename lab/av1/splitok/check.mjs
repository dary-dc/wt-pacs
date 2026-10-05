// node lab/av1/splitok/check.mjs SETS ITEMS [--out node.json] — every item run.py wrote, through the client's
// reader in Node (dav1d-WASM, as a browser without WebCodecs): verify.js's checks, a row a cell. README.md
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { reader, verify } from "./verify.js";

const OUT = fileURLToPath(new URL("../../.av1-build/out", import.meta.url));
globalThis.require = createRequire(import.meta.url);
globalThis.__dirname = OUT;
globalThis.fetch = async (url) => new Response(readFileSync(url));

const [sets, items] = process.argv.slice(2);
const outAt = process.argv.indexOf("--out");
const av1 = await reader({ glue: `${OUT}/simd.js`, wasm: `${OUT}/simd.wasm`, dir: OUT });
const sha256 = async (b) => createHash("sha256").update(b).digest("hex");

const cells = [];
const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));
for (const meta of walk(items).filter((f) => f.endsWith("metadata.json")).sort()) {
  const dir = dirname(meta);
  const src = join(sets, relative(items, dirname(dir)));
  const m = JSON.parse(readFileSync(join(src, "metadata.json"), "utf8"));
  const rows = [];
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".av1")).sort()) {
    const i = f.slice(0, 3);
    const truth = readFileSync(join(src, `${i}.sha256`), "utf8").trim();
    const raw = new Uint8Array(readFileSync(join(src, `${i}.raw`)));
    rows.push(await verify(av1, new Uint8Array(readFileSync(join(dir, f))), raw, m, truth, sha256));
  }
  const exact = rows.filter((r) => r.exact && r.streamsSame !== false).length;
  cells.push({ cell: relative(items, dir), bits: m.bits, signed: m.signed, n: rows.length, exact,
    decoders: [...new Set(rows.map((r) => r.decoder))].join(), errors: [...new Set(rows.map((r) => r.error).filter(Boolean))] });
}
if (outAt > 0) writeFileSync(process.argv[outAt + 1], cells.map((c) => JSON.stringify(c)).join("\n") + "\n");
const frames = cells.reduce((a, c) => a + c.n, 0);
const exact = cells.reduce((a, c) => a + c.exact, 0);
console.log(`node, dav1d-WASM: ${cells.filter((c) => c.exact === c.n).length}/${cells.length} cells exact, ${exact}/${frames} frames, every stream as planned`);
for (const c of cells.filter((x) => x.exact !== x.n)) console.log(`  ${c.cell}: ${c.exact}/${c.n} ${c.errors.join("; ")}`);
process.exit(exact === frames && existsSync(items) ? 0 : 1);
