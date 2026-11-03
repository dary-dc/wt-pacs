// The phone protocol's desktop proxy: option A (Cornerstone3D's stack viewport, paint on the page) against option B
// (our viewport, paint in our view worker), Chromium's CPU throttled. Indicative only. docs/viewer/integration.md §The phone protocol
//   NODE_PATH=$(npm root -g) node proxy.mjs --core DIR --series X.sbnd [--rounds 5] [--rates 4,6] [--remote ws://...]
import { createRequire } from "node:module";
import { hosts } from "./run.mjs";

const { chromium } = createRequire(import.meta.url)("playwright");
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const rounds = Number(arg("--rounds", 5));
const rates = arg("--rates", "4,6").split(",").map(Number);
/** The protocol's fixed shape: the scroll's step period, the cine's rate and length. */
const STEP_MS = 50, CINE_FPS = 30, CINE_MS = 3000;

async function visit(browser, url, rate) {
  const context = await browser.newContext({ viewport: { width: 560, height: 220 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate });
  await cdp.send("Performance.enable");
  await page.goto(url);
  await page.waitForFunction(() => window.spikeReady || window.spikeError, null, { timeout: 120_000 });
  const failed = await page.evaluate(() => window.spikeError);
  if (failed) throw new Error(failed);
  await page.waitForFunction(() => window.proxy?.ready() && window.proxy.firstExact() !== null, null, { timeout: 120_000 });
  const r = await page.evaluate(async ([STEP_MS, CINE_FPS, CINE_MS]) => {
    const n = 24;
    const sweep = [...Array(n).keys()];
    const out = { firstExact: proxy.firstExact(), openLongTasks: proxy.longTasks(0) };
    const t1 = performance.now();
    out.scroll = await proxy.scroll([...sweep.slice(1), ...sweep.slice().reverse(), ...sweep], STEP_MS);
    out.scrollLongTasks = proxy.longTasks(t1);
    const t2 = performance.now();
    out.cine = await proxy.cine(CINE_FPS, CINE_MS, n);
    out.cineLongTasks = proxy.longTasks(t2);
    out.memory = await proxy.memory();
    return out;
  }, [STEP_MS, CINE_FPS, CINE_MS]);
  // Where the browser gives no every-thread figure, the page thread's JS heap alone: workers not counted.
  const { metrics } = await cdp.send("Performance.getMetrics");
  r.pageHeap = metrics.find((m) => m.name === "JSHeapUsedSize").value;
  await context.close();
  return r;
}

const median = (a) => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };
const { server, base } = await hosts();
const browser = await chromium.launch({ args: ["--enable-unsafe-swiftshader", "--enable-blink-features=ForceEagerMeasureMemory"] });
const URLS = { A: `${base}/standard.html`, B: `${base}/index.html?views=1` };
try {
  console.log(`Chromium ${browser.version()}, SwiftShader; ${rounds} rounds ABBA per rate; scroll a step every ${STEP_MS} ms; cine ${CINE_FPS}/s for ${CINE_MS} ms`);
  for (const rate of rates) {
    const rows = { A: [], B: [] };
    for (let k = 0; k < rounds; k++) {
      for (const arm of k % 2 ? ["B", "A"] : ["A", "B"]) {
        const r = await visit(browser, URLS[arm], rate);
        rows[arm].push(r);
        console.log(`${rate}× round ${k + 1} ${arm}: first exact ${r.firstExact.toFixed(0)} ms, open long tasks ${r.openLongTasks.toFixed(0)} ms; scroll on time ${(100 * r.scroll.onTime).toFixed(0)} % (median ${median(r.scroll.latencies.filter((l) => l !== null)).toFixed(1)} ms), long tasks ${r.scrollLongTasks.toFixed(0)} ms; cine on time ${(100 * r.cine.onTime).toFixed(0)} % (${r.cine.painted} painted), long tasks ${r.cineLongTasks.toFixed(0)} ms; memory ${r.memory === null ? "n/a" : (r.memory / 2 ** 20).toFixed(1) + " MiB"}, page JS heap ${(r.pageHeap / 2 ** 20).toFixed(1)} MiB`);
      }
    }
    const of = (arm, f) => median(rows[arm].map(f));
    const M = { "first exact, ms": (r) => r.firstExact, "scroll on time, %": (r) => 100 * r.scroll.onTime, "cine on time, %": (r) => 100 * r.cine.onTime, "page long tasks, ms": (r) => r.openLongTasks + r.scrollLongTasks + r.cineLongTasks, "page JS heap, MiB": (r) => r.pageHeap / 2 ** 20 };
    for (const [name, f] of Object.entries(M)) console.log(`${rate}× median ${name}: A ${of("A", f).toFixed(1)}, B ${of("B", f).toFixed(1)}`);
  }
} finally {
  await browser.close();
  server.close();
}
process.exit(0);
