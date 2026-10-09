/**
 * ENCX: decode time a frame in Chromium of every arm make_frames.py wrote, against OpenJPH on the
 * same frames. Every throttle cell is a fresh browser, in a Williams order every round; sets and
 * arms rotate inside it. lab/av1/bytes/low-stream/README.md
 *
 *   NODE_PATH=$(npm root -g) node lab/av1/bytes/low-stream/encx.mjs [--rounds 12] [--throttles 1,4]
 *     [--frames lab/.av1-work/encx-frames] [--arms a,b] [--mutate sample|truth] [--out rows.json]
 */
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { order } from "../../../order.mjs";
import { throttleTree } from "../../../scripts/cpu_throttle.mjs";

const { chromium } = createRequire(import.meta.url)("playwright");
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const ROUNDS = Number(arg("--rounds", 12));
const THROTTLES = arg("--throttles", "1,4").split(",").map(Number);
const FRAMES = arg("--frames", "lab/.av1-work/encx-frames");
const MUTATE = arg("--mutate", "").split(",").filter(Boolean);
const OUT = arg("--out", null);
const ROOT = new URL("../../../..", import.meta.url).pathname;
const manifest = JSON.parse(readFileSync(`${ROOT}${FRAMES}/manifest.json`));
const ARMS = arg("--arms", null)?.split(",") ?? ["htj2k", ...new Set(manifest.flatMap((s) => Object.keys(s.arms)))];
const BASE_ARM = "av1-low2";
const PORT = 30000 + ((Math.random() * 10000) | 0);
const BASE = `http://127.0.0.1:${PORT}`;

const http = spawn("python3", ["server/dev-server.py", "--port", String(PORT)], { cwd: ROOT, stdio: "ignore" });
process.on("exit", () => http.kill());
await new Promise((r) => setTimeout(r, 1000));

async function inChromium(throttle, round) {
  const server = await chromium.launchServer({ executablePath: process.env.CHROME_PATH || chromium.executablePath() });
  const browser = await chromium.connect(server.wsEndpoint());
  const page = await browser.newPage();
  await page.goto(`${BASE}/lab/av1/bytes/low-stream/index.html`);
  if (!(await page.waitForFunction(() => globalThis.ready !== undefined).then((h) => h.jsonValue()))) {
    throw new Error("page is not cross-origin isolated");
  }
  const stop = throttleTree(server.process().pid, throttle);
  const rows = await page.evaluate((o) => globalThis.run(o), { frames: FRAMES, arms: ARMS, round, mutate: MUTATE });
  stop();
  await browser.close();
  await server.close();
  return rows;
}

const rows = [];
for (let round = 0; round < ROUNDS; round++) {
  for (const throttle of order(THROTTLES, round)) {
    const got = await inChromium(throttle, round);
    for (const r of got) rows.push({ round, throttle, ...r });
    for (const r of got.filter((r) => r.error || r.exact !== r.frames)) {
      console.error(`round ${round} ${throttle}x ${r.set} ${r.arm}: ${r.exact}/${r.frames} exact ${r.error ?? ""}`);
    }
    console.error(`round ${round} ${throttle}x done`);
    if (OUT) writeFileSync(OUT, JSON.stringify(rows));
  }
}

const med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
const f = (v) => v.toFixed(v < 10 ? 2 : 1);
const span = (a) => `[${Math.min(...a).toFixed(2)}–${Math.max(...a).toFixed(2)}]`;
console.log("ms a frame in its decoder: median of round medians [range]; exact frames; ×HTJ2K and ×av1-low2," +
  " the median of paired round ratios [range], and rounds faster");
for (const throttle of THROTTLES) {
  for (const set of [...new Set(rows.map((r) => r.set))]) {
    const of = (arm) => rows.filter((r) => r.throttle === throttle && r.set === set && r.arm === arm);
    const per = (arm) => new Map(of(arm).filter((r) => r.ms.length).map((r) => [r.round, med(r.ms)]));
    const refs = { HTJ2K: per("htj2k"), [BASE_ARM]: per(BASE_ARM) };
    for (const arm of ARMS) {
      const rs = of(arm);
      if (!rs.length) continue;
      const m = per(arm);
      const exact = `${rs.reduce((n, r) => n + r.exact, 0)}/${rs.reduce((n, r) => n + r.frames, 0)}`;
      if (!m.size) { console.log(`${throttle}x ${set} ${arm} failed (${rs[0].error})`); continue; }
      const v = [...m.values()];
      let line = `${throttle}x ${set} ${arm}\t${f(med(v))} [${f(Math.min(...v))}–${f(Math.max(...v))}] n=${v.length} exact ${exact}`;
      for (const [name, to] of Object.entries(refs)) {
        if (arm === (name === "HTJ2K" ? "htj2k" : name) || !to.size) continue;
        const r = [...m].filter(([k]) => to.has(k)).map(([k, x]) => x / to.get(k));
        line += `\t×${med(r).toFixed(2)} ${name} ${span(r)} faster ${r.filter((x) => x < 1).length}/${r.length}`;
      }
      console.log(line);
    }
  }
}
process.exit(0);
