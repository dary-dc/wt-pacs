/**
 * EMSDKNET's check: the em6 glue fetches no .wasm of its own. A product decoder worker on one set's first frames,
 * each named arm in a fresh Chromium; every .wasm the page and its workers request is counted, and an arm passes on
 * exactly one, the bytes wasm-glue.js checks and hands over. lab/decode-bench/netrules/README.md
 *
 *   NODE_PATH=$(npm root -g) node lab/decode-bench/netrules/wasm_fetches.mjs [--arms ojph-del-3.1.74,ojph-em6-6.0.11,ojph-em6mut-6.0.11]
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const { chromium } = createRequire(import.meta.url)("playwright");
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const ARMS = arg("--arms", "ojph-del-3.1.74,ojph-em6-6.0.11").split(",");
const ROOT = new URL("../../..", import.meta.url).pathname;
const PORT = 30000 + ((Math.random() * 10000) | 0);
const http = spawn("python3", ["server/dev-server.py", "--port", String(PORT)], { cwd: ROOT, stdio: "ignore" });
process.on("exit", () => http.kill());
await new Promise((r) => setTimeout(r, 1000));

let failed = 0;
for (const arm of ARMS) {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const wasm = [];
  context.on("request", (r) => /\.wasm($|\?)/.test(r.url()) && wasm.push(r.url().replace(/^.*\/lab\//, "lab/")));
  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:${PORT}/lab/av1/tools/newer/index.html`);
  await page.waitForFunction(() => globalThis.ready !== undefined);
  const [row] = await page.evaluate((v) => globalThis.run({ frames: "lab/.av1-work/netrules", variants: [v], round: 0, sets: ["usrgb_apollo"] }), arm);
  await browser.close();
  const ok = wasm.length === 1 && row.exact === row.frames && !row.error;
  failed += !ok;
  console.log(`${arm}: ${wasm.length} .wasm requested (${wasm.join(", ")}), ${row.exact}/${row.frames} exact${row.error ? " " + row.error : ""} — ${ok ? "pass" : "FAIL"}`);
}
process.exit(failed ? 1 : 0);
