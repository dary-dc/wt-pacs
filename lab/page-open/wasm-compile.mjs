/**
 * The WASM client's bytes and its `WebAssembly.compile` in Node's V8, builds interleaved in a Williams order,
 * a fresh process a sample so no compiled module is reused. lab/page-open/README.md §The WASM client's load
 *
 *   node lab/page-open/wasm-compile.mjs ROUNDS name=pkg-dir name=pkg-dir …
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { order } from "../order.mjs";

const ROUNDS = Number(process.argv[2]);
const ARMS = process.argv.slice(3).map((a) => a.split("="));
const COMPILE = "const b = require('fs').readFileSync(process.argv[1]); const t = performance.now();" +
  " WebAssembly.compile(b).then(() => console.log(performance.now() - t));";

for (const [name, dir] of ARMS) {
  const sizes = ["transport_wasm_bg.wasm", "transport_wasm.js"].map((f) => {
    const b = readFileSync(`${dir}/${f}`);
    return `${f} ${b.length} (${gzipSync(b, { level: 6 }).length} gzip -6)`;
  });
  console.log(`${name}: ${sizes.join(", ")}`);
}

const ms = new Map(ARMS.map(([name]) => [name, []]));
for (let round = 0; round < ROUNDS; round++) {
  for (const [name, dir] of order(ARMS, round)) {
    ms.get(name).push(Number(execFileSync("node", ["-e", COMPILE, `${dir}/transport_wasm_bg.wasm`])));
  }
}
const median = (v) => [...v].sort((a, b) => a - b)[v.length >> 1];
const first = ms.get(ARMS[0][0]);
console.log(`\ncompile ms, n = ${ROUNDS}: median [min-max], and the rounds each beat ${ARMS[0][0]} in`);
for (const [name, v] of ms) {
  const won = v.filter((x, i) => x < first[i]).length;
  console.log(`${name}: ${median(v).toFixed(2)} [${Math.min(...v).toFixed(2)}-${Math.max(...v).toFixed(2)}] ${won}/${ROUNDS}`);
}
