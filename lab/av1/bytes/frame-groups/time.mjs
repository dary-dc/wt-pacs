/**
 * GOPMEASURE's decode cost of an ask: each run's frames as product payloads at every G, through WebCodecs and
 * through dav1d-WASM, against HTJ2K, in headless Chromium's product decoder worker. Every throttle cell is a
 * fresh browser, in a Williams order every round; sets and variants rotate inside it. README.md here
 *
 *   NODE_PATH=$(npm root -g) node lab/av1/bytes/frame-groups/time.mjs --frames lab/.av1-work/gop/frames [--rounds 10]
 *     [--throttles 1,4] [--variants a,b] [--mutate] [--out rows.json]
 */
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { order } from "../../../order.mjs";
import { throttleTree } from "../../../scripts/cpu_throttle.mjs";

const { chromium } = createRequire(import.meta.url)("playwright");
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const ROUNDS = Number(arg("--rounds", 10));
const THROTTLES = arg("--throttles", "1,4").split(",").map(Number);
const FRAMES = arg("--frames", "lab/.av1-work/gop/frames");
const ONLY = arg("--variants", null)?.split(",");
const MUTATE = process.argv.includes("--mutate");
const OUT = arg("--out", null);
const ROOT = new URL("../../../..", import.meta.url).pathname;
const PORT = 30000 + ((Math.random() * 10000) | 0);

const http = spawn("python3", ["server/dev-server.py", "--port", String(PORT)], { cwd: ROOT, stdio: "ignore" });
process.on("exit", () => http.kill());
await new Promise((r) => setTimeout(r, 1000));

async function inChromium(throttle, round) {
  const server = await chromium.launchServer({ executablePath: process.env.CHROME_PATH || chromium.executablePath() });
  const browser = await chromium.connect(server.wsEndpoint());
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${PORT}/lab/av1/bytes/frame-groups/index.html`);
  if (!(await page.waitForFunction(() => globalThis.ready !== undefined).then((h) => h.jsonValue()))) {
    throw new Error("page is not cross-origin isolated");
  }
  const stop = throttleTree(server.process().pid, throttle);
  const rows = await page.evaluate((o) => globalThis.run(o), { frames: FRAMES, round, mutate: MUTATE, only: ONLY });
  stop();
  await browser.close();
  await server.close();
  return rows;
}

const rows = [];
for (let round = 0; round < ROUNDS; round++) {
  for (const throttle of order(THROTTLES, round)) {
    const got = await inChromium(throttle, round);
    rows.push(...got.map((r) => ({ round, throttle, ...r })));
    for (const r of got.filter((r) => r.error || r.exact !== r.frames)) {
      console.error(`round ${round} ${throttle}x ${r.set} ${r.variant}: ${r.exact}/${r.frames} exact ${r.error ?? ""}`);
    }
    console.error(`round ${round} ${throttle}x done`);
    if (OUT) writeFileSync(OUT, JSON.stringify(rows));
  }
}

const med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
/** An ask at frame k of a group decodes the group's frames 0 … k: its mean over k and over the run's groups. */
function ask(ms, g) {
  const costs = [];
  for (let a = 0; a < ms.length; a += g) {
    let sum = 0;
    for (let k = a; k < Math.min(a + g, ms.length); k++) costs.push((sum += ms[k]));
  }
  return costs.reduce((x, y) => x + y, 0) / costs.length;
}
const f = (v) => v.toFixed(v < 10 ? 2 : 1);
console.log("ms per ask through the decoder worker: median over rounds of each round's mean ask [range]; n rounds; exact frames");
for (const throttle of THROTTLES) {
  for (const set of [...new Set(rows.map((r) => r.set))]) {
    const parts = [];
    for (const variant of [...new Set(rows.map((r) => r.variant))]) {
      const rs = rows.filter((r) => r.throttle === throttle && r.set === set && r.variant === variant);
      if (!rs.length) continue;
      const exact = `${rs.reduce((n, r) => n + r.exact, 0)}/${rs.reduce((n, r) => n + r.frames, 0)}`;
      const v = rs.filter((r) => r.ms.length === r.frames).map((r) => ask(r.ms, r.g));
      if (!v.length) { parts.push(`${variant} failed (${rs[0].error})`); continue; }
      parts.push(`${variant} ${f(med(v))} [${f(Math.min(...v))}–${f(Math.max(...v))}] n=${v.length} exact ${exact}`);
    }
    console.log(`${throttle}x ${set}: ${parts.join(" · ")}`);
  }
}
process.exit(0);
