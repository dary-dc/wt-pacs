/**
 * Drive page.js headless, interleaving the arms: every round runs each scenario on each arm
 * with the arm order rotated, so a drift in the host lands on all arms alike. Adds what only
 * CDP sees — the page's main-thread task time and the renderer's GC count over the scenario —
 * then prints median [min … max] and rounds-better against H. docs/ARCHITECTURE.md §S4.
 *
 *   NODE_PATH=$(npm root -g) node lab/downloader-campaign/run.mjs [--rounds 8] [--base http://127.0.0.1:8765]
 */
import fs from "node:fs";
import { createRequire } from "node:module";

// `import` ignores NODE_PATH; `require` honours it, which is how a global playwright is found.
const { chromium } = createRequire(import.meta.url)("playwright");

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const ROUNDS = Number(arg("--rounds", 8));
const BASE = arg("--base", "http://127.0.0.1:8765");
const OUT = arg("--out", "");
const ARMS = ["H", "Dw", "Dd"];
const SCENARIOS = ["fill", "ask", "ask10", "ask50", "ask90"];

// An explicit path launches the full browser; the headless shell playwright otherwise picks has
// no measureUserAgentSpecificMemory. docs/decode/README.md §Retention, measured.
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME_PATH || chromium.executablePath(),
  args: ["--disable-background-networking", "--enable-precise-memory-info", "--enable-blink-features=ForceEagerMeasureMemory"],
});

async function runOne(arm, scenario) {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const cdp = await page.context().newCDPSession(page);
  let gcs = 0;
  cdp.on("Tracing.dataCollected", (d) => { for (const e of d.value || []) if (/^V8\.GC/.test(e.name || "")) gcs += 1; });
  await cdp.send("Performance.enable");
  await page.goto(`${BASE}/lab/downloader-campaign/index.html?arm=${arm}&scenario=${scenario}`);
  await page.waitForFunction(() => globalThis.__wtpacsReady || globalThis.__wtpacsDone, null, { timeout: 60000 });
  const metric = (m, name) => m.metrics.find((x) => x.name === name)?.value ?? 0;
  const before = await cdp.send("Performance.getMetrics");
  await cdp.send("Tracing.start", { categories: "disabled-by-default-v8.gc", transferMode: "ReportEvents" });
  await page.evaluate(() => { globalThis.__wtpacsGo = true; });
  await page.waitForFunction(() => globalThis.__wtpacsScenarioDone || globalThis.__wtpacsDone, null, { timeout: 120000 });
  const after = await cdp.send("Performance.getMetrics");
  const traced = new Promise((r) => cdp.once("Tracing.tracingComplete", r));
  await cdp.send("Tracing.end");
  await traced;
  await page.evaluate(() => { globalThis.__wtpacsMeasure = true; });
  await page.waitForFunction(() => globalThis.__wtpacsDone, null, { timeout: 60000 });
  const result = await page.evaluate(() => globalThis.__wtpacsResult);
  await page.close();
  return {
    ...result,
    main_thread_ms: (metric(after, "TaskDuration") - metric(before, "TaskDuration")) * 1000,
    script_ms: (metric(after, "ScriptDuration") - metric(before, "ScriptDuration")) * 1000,
    gcs,
    errors,
  };
}

const rows = [];
for (let round = 0; round < ROUNDS; round++) {
  const order = ARMS.map((_, i) => ARMS[(i + round) % ARMS.length]);
  for (const scenario of SCENARIOS) {
    for (const arm of order) {
      const r = await runOne(arm, scenario);
      rows.push({ round, ...r });
      const brief = r.error ? `ERROR ${r.error}` : `${r.ask_ms != null ? `ask ${r.ask_ms.toFixed(1)} ms ` : ""}${r.last_frame_ms != null ? `fill ${r.last_frame_ms.toFixed(0)} ms ${r.delivered}/${r.fill} ` : ""}main ${r.main_thread_ms.toFixed(0)} ms gcs ${r.gcs} mem ${(r.memory_bytes / 1048576).toFixed(1)} MB`;
      console.log(`round ${round} ${scenario.padEnd(5)} ${arm.padEnd(2)} ${brief}${r.errors.length ? ` pageerrors ${r.errors.length}` : ""}`);
    }
  }
}
await browser.close();
if (OUT) fs.writeFileSync(OUT, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");

const median = (xs) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const fmt = (xs, d = 1) => xs.length ? `${median(xs).toFixed(d)} [${Math.min(...xs).toFixed(d)} … ${Math.max(...xs).toFixed(d)}]` : "—";
const pick = (scenario, arm, key) => rows.filter((r) => r.scenario === scenario && r.arm === arm && r[key] != null && !r.error).map((r) => r[key]);
const better = (scenario, arm, key, lowerIsBetter = true) => {
  let n = 0, wins = 0;
  for (let round = 0; round < ROUNDS; round++) {
    const a = rows.find((r) => r.round === round && r.scenario === scenario && r.arm === arm && !r.error)?.[key];
    const h = rows.find((r) => r.round === round && r.scenario === scenario && r.arm === "H" && !r.error)?.[key];
    if (a == null || h == null) continue;
    n += 1;
    if (lowerIsBetter ? a < h : a > h) wins += 1;
  }
  return `${wins}/${n}`;
};

const first = rows.find((r) => !r.error) ?? {};
console.log(`\n### ${ROUNDS} rounds, arm order rotated each round, fill of ${first.fill} frames, ask for frame ${first.askFrame}, ${first.cores} cores\n`);
const METRICS = [
  ["ask_ms", "ask → delivered (ms)", 2],
  ["last_frame_ms", "fill: issue → last frame at the page (ms)", 0],
  ["delivered", "fill frames delivered", 0],
  ["main_thread_ms", "page main-thread task time (ms)", 0],
  ["handler_ms", "in-page handling of delivered bytes (ms)", 1],
  ["gcs", "renderer GCs", 0],
  ["memory_bytes", "measureUserAgentSpecificMemory after (bytes)", 0],
  ["memory_workers_bytes", "of which in workers (bytes)", 0],
  ["js_heap_peak", "page JS heap peak (bytes)", 0],
];
for (const scenario of SCENARIOS) {
  console.log(`**${scenario}**\n`);
  console.log(`| metric | H | Dw | Dw better | Dd |`);
  console.log(`| --- | --- | --- | --- | --- |`);
  for (const [key, label, d] of METRICS) {
    const h = pick(scenario, "H", key), dw = pick(scenario, "Dw", key), dd = pick(scenario, "Dd", key);
    if (!h.length && !dw.length && !dd.length) continue;
    console.log(`| ${label} | ${fmt(h, d)} | ${fmt(dw, d)} | ${better(scenario, "Dw", key, key !== "delivered")} | ${fmt(dd, d)} |`);
  }
  console.log("");
}
