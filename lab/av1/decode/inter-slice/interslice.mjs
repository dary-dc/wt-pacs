/**
 * INTERSLICE: decode time a slice pair in Chromium — the two served HTJ2K frames against the 5/3 step's
 * low and high band and its inverse, the same decoder build in both. Every throttle cell is a fresh
 * browser, in a Williams order every round; sets and arms rotate inside it.
 * lab/av1/decode/inter-slice/README.md
 *
 *   NODE_PATH=$(npm root -g) node lab/av1/decode/inter-slice/interslice.mjs [--rounds 12] [--throttles 1,4]
 *     [--frames lab/.av1-work/interslice] [--mutate sample|truth] [--out rows.json]
 */
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { order } from "../../../order.mjs";
import { throttleTree } from "../../../scripts/cpu_throttle.mjs";

const { chromium } = createRequire(import.meta.url)("playwright");
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const ROUNDS = Number(arg("--rounds", 12));
const THROTTLES = arg("--throttles", "1,4").split(",").map(Number);
const FRAMES = arg("--frames", "lab/.av1-work/interslice");
const MUTATE = arg("--mutate", "").split(",").filter(Boolean);
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
  await page.goto(`http://127.0.0.1:${PORT}/lab/av1/decode/inter-slice/index.html`);
  if (!(await page.waitForFunction(() => globalThis.ready !== undefined).then((h) => h.jsonValue()))) {
    throw new Error("page is not cross-origin isolated");
  }
  const stop = throttleTree(server.process().pid, throttle);
  const rows = await page.evaluate((o) => globalThis.run(o), { frames: FRAMES, round, mutate: MUTATE });
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
    for (const r of got.filter((r) => r.error || r.exact !== r.pairs)) {
      console.error(`round ${round} ${throttle}x ${r.set} ${r.variant}: ${r.exact}/${r.pairs} exact ${r.error ?? ""}`);
    }
    console.error(`round ${round} ${throttle}x done`);
  }
}
if (OUT) writeFileSync(OUT, JSON.stringify(rows));

const med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
const f = (v) => v.toFixed(v < 10 ? 2 : 1);
console.log("ms a pair: median over rounds of each round's median [range of round medians]; exact pairs;" +
  " lift/two, the median of paired round ratios [range], and rounds where lift was slower");
for (const throttle of THROTTLES) {
  for (const set of [...new Set(rows.map((r) => r.set))]) {
    const of = (v) => rows.filter((r) => r.throttle === throttle && r.set === set && r.variant === v);
    const per = (v) => new Map(of(v).filter((r) => r.ms.length).map((r) => [r.round, med(r.ms)]));
    const parts = ["two", "lift"].map((v) => {
      const m = [...per(v).values()];
      const rs = of(v);
      const exact = `${rs.reduce((n, r) => n + r.exact, 0)}/${rs.reduce((n, r) => n + r.pairs, 0)}`;
      return m.length ? `${v} ${f(med(m))} [${f(Math.min(...m))}–${f(Math.max(...m))}] n=${m.length} exact ${exact}` : `${v} failed (${rs[0]?.error})`;
    });
    const two = per("two");
    const ratio = [...per("lift")].filter(([r]) => two.has(r)).map(([r, x]) => x / two.get(r));
    if (ratio.length) {
      parts.push(`lift/two ×${med(ratio).toFixed(3)} [${Math.min(...ratio).toFixed(3)}–${Math.max(...ratio).toFixed(3)}],` +
        ` slower ${ratio.filter((x) => x > 1).length}/${ratio.length}`);
    }
    console.log(`${throttle}x ${set}: ${parts.join(" · ")}`);
  }
}
process.exit(0);
