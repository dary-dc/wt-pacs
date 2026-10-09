/**
 * SPEED: decode time a frame, OpenJPH on HTJ2K against dav1d-WASM and WebCodecs on AV1 of the same
 * frames, through the product's decoder worker. Every (environment × throttle) cell is a fresh
 * process, in a Williams order every round; arms and sets rotate inside it. lab/av1/decode/per-frame/README.md
 *
 *   NODE_PATH=$(npm root -g) node lab/av1/decode/per-frame/speed.mjs [--rounds 16] [--throttles 1,4]
 *     [--envs node,chromium] [--frames lab/.av1-work/speed] [--mutate sample|truth] [--out rows.json]
 */
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { order } from "../../../order.mjs";
import { throttleTree } from "../../../scripts/cpu_throttle.mjs";

const { chromium } = createRequire(import.meta.url)("playwright");
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const ROUNDS = Number(arg("--rounds", 16));
const THROTTLES = arg("--throttles", "1,4").split(",").map(Number);
const ENVS = arg("--envs", "node,chromium").split(",");
const FRAMES = arg("--frames", "lab/.av1-work/speed");
const MUTATE = arg("--mutate", "").split(",").filter(Boolean);
const OUT = arg("--out", null);
const ROOT = new URL("../../../..", import.meta.url).pathname;
const PORT = 30000 + ((Math.random() * 10000) | 0);
const BASE = `http://127.0.0.1:${PORT}`;

const http = spawn("python3", ["server/dev-server.py", "--port", String(PORT)], { cwd: ROOT, stdio: "ignore" });
process.on("exit", () => http.kill());
await new Promise((r) => setTimeout(r, 1000));

async function inNode(throttle, round) {
  const opts = { base: BASE, frames: FRAMES, arms: ["htj2k", "av1"], round, mutate: MUTATE };
  const child = spawn(process.execPath, [new URL("node-run.mjs", import.meta.url).pathname, JSON.stringify(opts)],
    { stdio: ["ignore", "pipe", "inherit"] });
  const stop = throttleTree(child.pid, throttle);
  let out = "";
  child.stdout.on("data", (d) => (out += d));
  await new Promise((r) => child.once("exit", r));
  stop();
  return JSON.parse(out);
}

async function inChromium(throttle, round) {
  const server = await chromium.launchServer({ executablePath: process.env.CHROME_PATH || chromium.executablePath() });
  const browser = await chromium.connect(server.wsEndpoint());
  const page = await browser.newPage();
  await page.goto(`${BASE}/lab/av1/decode/per-frame/index.html`);
  if (!(await page.waitForFunction(() => globalThis.ready !== undefined).then((h) => h.jsonValue()))) {
    throw new Error("page is not cross-origin isolated");
  }
  const stop = throttleTree(server.process().pid, throttle);
  const rows = await page.evaluate((o) => globalThis.run(o),
    { frames: FRAMES, arms: ["htj2k", "av1", "webcodecs"], round, mutate: MUTATE });
  stop();
  await browser.close();
  await server.close();
  return rows;
}

const cells = ENVS.flatMap((env) => THROTTLES.map((throttle) => ({ env, throttle })));
const rows = [];
for (let round = 0; round < ROUNDS; round++) {
  for (const { env, throttle } of order(cells, round)) {
    const got = await (env === "node" ? inNode : inChromium)(throttle, round);
    for (const r of got) rows.push({ round, env, throttle, ...r });
    const bad = got.filter((r) => r.error || r.exact !== r.frames);
    for (const r of bad) console.error(`round ${round} ${env} ${throttle}x ${r.set} ${r.arm}: ${r.exact}/${r.frames} exact ${r.error ?? ""}`);
    console.error(`round ${round} ${env} ${throttle}x done`);
  }
}
if (OUT) writeFileSync(OUT, JSON.stringify(rows));

const med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
const f = (v) => v.toFixed(v < 10 ? 2 : 1);
console.log("ms a frame in its decoder: median over rounds of each round's median [range of round medians]; exact frames");
for (const { env, throttle } of cells) {
  for (const set of [...new Set(rows.map((r) => r.set))]) {
    const of = (arm) => rows.filter((r) => r.env === env && r.throttle === throttle && r.set === set && r.arm === arm);
    const ref = new Map(of("htj2k").map((r) => [r.round, med(r.ms)]));
    const parts = [];
    for (const arm of ["htj2k", "av1", "webcodecs"]) {
      const rs = of(arm);
      if (!rs.length) continue;
      const per = rs.filter((r) => r.ms.length).map((r) => med(r.ms));
      const exact = `${rs.reduce((n, r) => n + r.exact, 0)}/${rs.reduce((n, r) => n + r.frames, 0)}`;
      if (!per.length) { parts.push(`${arm} failed (${rs[0].error})`); continue; }
      let line = `${arm} ${f(med(per))} [${f(Math.min(...per))}–${f(Math.max(...per))}] n=${per.length} exact ${exact}`;
      if (arm !== "htj2k") {
        const ratios = rs.filter((r) => ref.has(r.round) && r.ms.length).map((r) => med(r.ms) / ref.get(r.round));
        line += `, ×${med(ratios).toFixed(2)} HTJ2K [${Math.min(...ratios).toFixed(2)}–${Math.max(...ratios).toFixed(2)}]`;
      }
      parts.push(line);
    }
    console.log(`${env} ${throttle}x ${set}: ${parts.join(" · ")}`);
  }
}
process.exit(0);
