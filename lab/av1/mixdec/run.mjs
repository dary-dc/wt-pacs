/**
 * MIXDEC: decode time a frame of a split item in headless Chromium, every throttle cell a fresh browser in a
 * Williams order every round, sets and arms rotating inside it. `bound`: both streams through dav1d-WASM,
 * each timed apart — the low stream's share. `decode`: through the product's decoder worker, today's path
 * (kK), the mixed one (kKm) and w10, against OpenJPH. lab/av1/mixdec/README.md
 *
 *   NODE_PATH=$(npm root -g) node lab/av1/mixdec/run.mjs bound|decode [--rounds 12] [--throttles 1,4]
 *     [--frames lab/.av1-work/mixdec] [--sets a,b] [--mutate sample|truth] [--out rows.json]
 */
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { order } from "../../order.mjs";
import { throttleTree } from "../../scripts/cpu_throttle.mjs";

const { chromium } = createRequire(import.meta.url)("playwright");
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const MODE = process.argv[2];
if (!["bound", "decode"].includes(MODE)) throw new Error("usage: run.mjs bound|decode ...");
const ROUNDS = Number(arg("--rounds", 12));
const THROTTLES = arg("--throttles", "1,4").split(",").map(Number);
const FRAMES = arg("--frames", "lab/.av1-work/mixdec");
const MUTATE = arg("--mutate", "").split(",").filter(Boolean);
const OUT = arg("--out", null);
const SETS = arg("--sets", null)?.split(",");
const ROOT = new URL("../../..", import.meta.url).pathname;
const MANIFEST = JSON.parse(readFileSync(`${ROOT}/${FRAMES}/manifest.json`, "utf8")).filter((s) => !SETS || SETS.includes(s.name));
const ARMS = ["htj2k", ...[1, 2, 3, 4].flatMap((k) => [`k${k}`, `k${k}m`])];
const PORT = 30000 + ((Math.random() * 10000) | 0);
const BASE = `http://127.0.0.1:${PORT}`;

const http = spawn("python3", ["server/dev-server.py", "--port", String(PORT)], { cwd: ROOT, stdio: "ignore" });
process.on("exit", () => http.kill());
await new Promise((r) => setTimeout(r, 1000));

async function inChromium(throttle, round) {
  const server = await chromium.launchServer({ executablePath: process.env.CHROME_PATH || chromium.executablePath() });
  const browser = await chromium.connect(server.wsEndpoint());
  const page = await browser.newPage();
  await page.goto(`${BASE}/lab/av1/mixdec/${MODE === "bound" ? "bound" : "index"}.html`);
  if (!(await page.waitForFunction(() => globalThis.ready !== undefined).then((h) => h.jsonValue()))) {
    throw new Error("page is not cross-origin isolated");
  }
  const stop = throttleTree(server.process().pid, throttle);
  const rows = await page.evaluate((o) => globalThis.run(o), { frames: FRAMES, arms: ARMS, round, mutate: MUTATE, sets: SETS });
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
  }
  if (OUT) writeFileSync(OUT, JSON.stringify(rows));
}

const med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
const f = (v) => v.toFixed(v < 10 ? 2 : 1);
const span = (a) => `[${f(Math.min(...a))}–${f(Math.max(...a))}]`;
const exact = (rs) => `${rs.reduce((n, r) => n + r.exact, 0)}/${rs.reduce((n, r) => n + r.frames, 0)}`;
const sets = MANIFEST.map((s) => s.name).filter((s) => rows.some((r) => r.set === s));
if (MODE === "bound") {
  console.log("dav1d-WASM, both streams: ms a frame, median over rounds of each round's median [range]; low share = low / (top + low + merge)");
  for (const throttle of THROTTLES) {
    for (const set of sets) {
      const parts = [];
      for (const arm of [...new Set(rows.filter((r) => r.set === set).map((r) => r.arm))].sort()) {
        const rs = rows.filter((r) => r.throttle === throttle && r.set === set && r.arm === arm);
        const per = (k) => rs.map((r) => med(r[k]));
        const share = rs.map((r) => med(r.low.map((l, i) => l / (r.top[i] + l + r.merge[i]))));
        parts.push(`${arm} top ${f(med(per("top")))} low ${f(med(per("low")))} merge ${f(med(per("merge")))}` +
          ` share ${med(share).toFixed(3)} ${span(share)} n=${rs.length} exact ${exact(rs)}`);
      }
      console.log(`${throttle}x ${set}: ${parts.join(" · ")}`);
    }
  }
} else {
  console.log("ms a frame in its decoder: median over rounds of each round's median [range]; exact frames; ×today (kK) and ×w10," +
    " the median of paired round ratios [range], rounds faster");
  for (const throttle of THROTTLES) {
    for (const set of sets) {
      const bits = MANIFEST.find((s) => s.name === set).bits;
      const of = (arm) => rows.filter((r) => r.throttle === throttle && r.set === set && r.arm === arm);
      const per = (arm) => new Map(of(arm).filter((r) => r.ms.length).map((r) => [r.round, med(r.ms)]));
      const ratio = (m, to) => [...m].filter(([r]) => to.has(r)).map(([r, x]) => x / to.get(r));
      const vs = (m, to, name) => { const r = ratio(m, to); return r.length ? `, ×${med(r).toFixed(2)} ${name} ${span(r)} faster ${r.filter((x) => x < 1).length}/${r.length}` : ""; };
      const w10 = per(`k${bits - 10}`);
      const parts = [];
      for (const arm of ARMS) {
        const rs = of(arm);
        if (!rs.length) continue;
        const m = per(arm);
        if (!m.size) { parts.push(`${arm} failed (${rs[0].error})`); continue; }
        let line = `${arm} ${f(med([...m.values()]))} ${span([...m.values()])} n=${m.size} exact ${exact(rs)}`;
        if (arm !== "htj2k") line += vs(m, per("htj2k"), "HTJ2K");
        if (arm.endsWith("m")) line += vs(m, per(arm.slice(0, -1)), "today") + vs(m, w10, "w10");
        parts.push(line);
      }
      console.log(`${throttle}x ${set}: ${parts.join(" · ")}`);
    }
  }
}
process.exit(0);
