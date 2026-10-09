/**
 * VERSIONS: decode time a frame through the product's decoder worker, the pinned tools against the newer ones
 * (index.html names the arms), in each Chromium. Every (throttle × browser) cell is a fresh browser, in a Williams
 * order every round; arms and sets rotate inside it. lab/av1/tools/newer/README.md
 *
 *   NODE_PATH=$(npm root -g) node lab/av1/tools/newer/decode.mjs [--rounds 10] [--throttles 1,4] [--browsers 141,154]
 *     [--arms htj2k,item,…] [--frames lab/.av1-work/versions] [--sets a,b] [--mutate sample|truth] [--out rows.json]
 */
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { order } from "../../../order.mjs";
import { throttleTree } from "../../../scripts/cpu_throttle.mjs";

const { chromium } = createRequire(import.meta.url)("playwright");
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const ROUNDS = Number(arg("--rounds", 10));
const THROTTLES = arg("--throttles", "1,4").split(",").map(Number);
const BROWSERS = arg("--browsers", "141,154").split(",");
const ARMS = arg("--arms", "htj2k,ojph-0.31.0-3.1.74,ojph-0.32.0-3.1.74,ojph-0.31.0-6.0.11,ojph-0.32.0-6.0.11,item,dav1d-3.1.74,dav1d-6.0.11,dav1d-6.0.11-dav1d-head").split(",");
const FRAMES = arg("--frames", "lab/.av1-work/versions");
const MUTATE = arg("--mutate", "").split(",").filter(Boolean);
const OUT = arg("--out", null);
const SETS = arg("--sets", null)?.split(",");
const ROOT = new URL("../../../..", import.meta.url).pathname;
const EXECUTABLE = { 141: chromium.executablePath(),
  154: `${ROOT}/lab/.av1-build/chromium-154.0.8037.92/chrome-headless-shell-linux64/chrome-headless-shell` };
const PORT = 30000 + ((Math.random() * 10000) | 0);
const BASE = `http://127.0.0.1:${PORT}`;

const http = spawn("python3", ["server/dev-server.py", "--port", String(PORT)], { cwd: ROOT, stdio: "ignore" });
process.on("exit", () => http.kill());
await new Promise((r) => setTimeout(r, 1000));

async function inChromium(browserName, throttle, round) {
  const server = await chromium.launchServer({ executablePath: EXECUTABLE[browserName] });
  const browser = await chromium.connect(server.wsEndpoint());
  const page = await browser.newPage();
  await page.goto(`${BASE}/lab/av1/tools/newer/index.html`);
  if (!(await page.waitForFunction(() => globalThis.ready !== undefined).then((h) => h.jsonValue()))) {
    throw new Error("page is not cross-origin isolated");
  }
  const version = browser.version();
  const stop = throttleTree(server.process().pid, throttle);
  const rows = await page.evaluate((o) => globalThis.run(o), { frames: FRAMES, arms: ARMS, round, mutate: MUTATE, sets: SETS });
  stop();
  await browser.close();
  await server.close();
  return rows.map((r) => ({ ...r, version }));
}

const cells = THROTTLES.flatMap((throttle) => BROWSERS.map((browser) => ({ throttle, browser })));
const rows = [];
for (let round = 0; round < ROUNDS; round++) {
  for (const { throttle, browser } of order(cells, round)) {
    const got = await inChromium(browser, throttle, round);
    for (const r of got) rows.push({ round, throttle, browser, ...r });
    for (const r of got.filter((r) => r.error || r.exact !== r.frames)) {
      console.error(`round ${round} ${browser} ${throttle}x ${r.set} ${r.arm}: ${r.exact}/${r.frames} exact ${r.error ?? ""}`);
    }
    console.error(`round ${round} ${browser} ${throttle}x done (${got[0]?.version})`);
    if (OUT) writeFileSync(OUT, JSON.stringify(rows));
  }
}

const med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
const f = (v) => v.toFixed(v < 10 ? 2 : 1);
const span = (a) => `[${Math.min(...a).toFixed(3)}–${Math.max(...a).toFixed(3)}]`;
// Each arm against its pinned counterpart in the same browser, and Chromium 154 against 141 on the same arm.
const REF = { "ojph-0.32.0-3.1.74": "ojph-0.31.0-3.1.74", "ojph-0.31.0-6.0.11": "ojph-0.31.0-3.1.74",
  "ojph-0.32.0-6.0.11": "ojph-0.31.0-3.1.74", "ojph-0.31.0-3.1.74": "htj2k", "dav1d-6.0.11": "dav1d-3.1.74",
  "dav1d-6.0.11-dav1d-head": "dav1d-6.0.11" };
console.log("ms a frame: median over rounds of each round's median [range]; exact; ×ref, the median of paired round ratios" +
  " [range], rounds faster; ×141, the same arm in Chromium 141");
const per = (sel) => new Map(rows.filter(sel).filter((r) => r.ms.length).map((r) => [r.round, med(r.ms)]));
const ratio = (m, to) => [...m].filter(([r]) => to.has(r)).map(([r, x]) => x / to.get(r));
for (const throttle of THROTTLES) {
  for (const browser of BROWSERS) {
    for (const set of [...new Set(rows.map((r) => r.set))]) {
      const at = (arm, b = browser) => (r) => r.throttle === throttle && r.browser === b && r.set === set && r.arm === arm;
      const parts = [];
      for (const arm of ARMS) {
        const rs = rows.filter(at(arm));
        if (!rs.length) continue;
        const m = per(at(arm));
        const exact = `${rs.reduce((n, r) => n + r.exact, 0)}/${rs.reduce((n, r) => n + r.frames, 0)}`;
        if (!m.size) { parts.push(`${arm} failed (${rs[0].error})`); continue; }
        const v = [...m.values()];
        let line = `${arm} ${f(med(v))} [${f(Math.min(...v))}–${f(Math.max(...v))}] n=${v.length} exact ${exact}`;
        if (REF[arm]) {
          const r = ratio(m, per(at(REF[arm])));
          if (r.length) line += `, ×${med(r).toFixed(3)} ${REF[arm]} ${span(r)} faster ${r.filter((x) => x < 1).length}/${r.length}`;
        }
        if (browser !== BROWSERS[0]) {
          const r = ratio(m, per(at(arm, BROWSERS[0])));
          if (r.length) line += `, ×${med(r).toFixed(3)} ${BROWSERS[0]} ${span(r)} faster ${r.filter((x) => x < 1).length}/${r.length}`;
        }
        parts.push(line);
      }
      console.log(`${browser} ${throttle}x ${set}:\n  ${parts.join("\n  ")}`);
    }
  }
}
process.exit(0);
