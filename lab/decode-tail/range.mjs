/**
 * The range pass alone, in a browser worker at each throttle: range.html's arms, rotated with the
 * shapes and throttles every round. docs/decode/README.md §The decode tail on a slow CPU
 *
 *   NODE_PATH=$(npm root -g) node lab/decode-tail/range.mjs [--rounds 7] [--throttles 1,4,6]
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { throttleTree } from "../scripts/cpu_throttle.mjs";

const { chromium } = createRequire(import.meta.url)("playwright");
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const ROUNDS = Number(arg("--rounds", 7));
const THROTTLES = arg("--throttles", "1,4,6").split(",").map(Number);
const ARMS = ["product", "ints"];
const SHAPES = ["c512", "g512", "s12"];
const ROOT = new URL("../..", import.meta.url).pathname;
const PORT = 30000 + ((Math.random() * 10000) | 0);

const http = spawn("python3", ["server/dev-server.py", "--port", String(PORT)], { cwd: ROOT, stdio: "ignore" });
const server = await chromium.launchServer({ executablePath: process.env.CHROME_PATH || chromium.executablePath() });
process.on("exit", () => http.kill());
const browser = await chromium.connect(server.wsEndpoint());
const page = await browser.newPage();
await new Promise((r) => setTimeout(r, 1000));
await page.goto(`http://127.0.0.1:${PORT}/lab/decode-tail/range.html`);
await page.waitForFunction(() => globalThis.ready);

const rows = [];
for (let round = 0; round < ROUNDS; round++) {
  const cells = THROTTLES.flatMap((t) => SHAPES.flatMap((s) => ARMS.map((a) => [t, s, a])));
  for (let k = 0; k < cells.length; k++) {
    const [throttle, shape, arm] = cells[(k + round) % cells.length];
    const stop = throttleTree(server.process().pid, throttle);
    const { out, result } = await page.evaluate(([a, s]) => globalThis.run(a, s, 15), [arm, shape]);
    stop();
    // The first calls tier up; the steady state is the question.
    const steady = out.slice(5).sort((x, y) => x - y);
    rows.push({ round, throttle, shape, arm, ms: steady[steady.length >> 1], result });
  }
}
await browser.close();
await server.close();

const med = (a) => [...a].sort((x, y) => x - y)[a.length >> 1];
console.log("median over rounds of each round's steady-state median, ms a frame");
for (const throttle of THROTTLES) for (const shape of SHAPES) {
  const of = (arm) => rows.filter((r) => r.throttle === throttle && r.shape === shape && r.arm === arm);
  const [p, i] = [of("product"), of("ints")];
  const same = p.every((r, k) => JSON.stringify(r.result) === JSON.stringify(i[k].result));
  const faster = i.filter((r) => r.ms < p.find((x) => x.round === r.round).ms).length;
  console.log(`${throttle}x ${shape}: product ${med(p.map((r) => r.ms)).toFixed(2)}  ints ${med(i.map((r) => r.ms)).toFixed(2)}` +
    `  ints faster in ${faster}/${i.length}  same range: ${same}`);
}
process.exit(0);
