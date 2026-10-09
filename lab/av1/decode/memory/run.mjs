/**
 * FOOTPRINT's runner. `--mode mem`: every (set, variant, D) one fresh context, interleaved each round; at each
 * of the page's checkpoints the renderer's RSS is read beside the page's own measure, the peak sampled
 * throughout. `--mode first`: every (throttle, set, variant) one fresh context visited three times — cold,
 * then twice with the browser's caches — throttle cells and variants in a Williams order. lab/av1/decode/memory/README.md
 *
 *   NODE_PATH=$(npm root -g) node lab/av1/decode/memory/run.mjs --mode mem|first [--rounds 6] [--counts 1,2,4]
 *     [--throttles 1,4] [--mutate sample|truth] [--out rows.jsonl]
 */
import fs from "node:fs";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { order } from "../../../order.mjs";
import { throttleTree } from "../../../scripts/cpu_throttle.mjs";

const { chromium } = createRequire(import.meta.url)("playwright");
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const MODE = arg("--mode", "mem");
const ROUNDS = Number(arg("--rounds", 6));
const FIRST = Number(arg("--first-round", 0));
const COUNTS = arg("--counts", "1,2,4").split(",").map(Number);
const THROTTLES = arg("--throttles", MODE === "first" ? "1,4" : "1").split(",").map(Number);
const MUTATE = arg("--mutate", "");
const OUT = arg("--out", "");
/** set: [frames dir, variants]; a variant is a name in the set's variants.json, or htj2k. */
const SETS = JSON.parse(arg("--sets", JSON.stringify({
  dbtproj_ge: ["lab/.av1-work/footprint/rep14", ["htj2k", "htj2k4", "d12", "w10"]],
  us_liver: ["lab/.av1-work/footprint/total", ["htj2k", "htj2k4", "rct", "rctwc"]],
})));
const VISITS = ["cold", "cached", "cached2"];
const ROOT = new URL("../../../..", import.meta.url).pathname;
const PORT = 30000 + ((Math.random() * 10000) | 0);

const http = spawn("python3", ["server/dev-server.py", "--port", String(PORT)], { cwd: ROOT, stdio: "ignore" });
process.on("exit", () => http.kill());
await new Promise((r) => setTimeout(r, 1000));

const readOr = (p) => { try { return fs.readFileSync(p, "utf8"); } catch { return ""; } };
const kib = (pid, key) => Number(new RegExp(`${key}:\\s+(\\d+)`).exec(readOr(`/proc/${pid}/status`))?.[1] ?? 0);

async function launch() {
  const server = await chromium.launchServer({
    executablePath: process.env.CHROME_PATH || chromium.executablePath(),
    // One renderer per page, no spare to mistake for it; the page's measure collects before it counts.
    args: ["--disable-features=SpareRendererForSitePerProcess", "--enable-blink-features=ForceEagerMeasureMemory"],
  });
  const browser = await chromium.connect(server.wsEndpoint());
  const cdp = await browser.newBrowserCDPSession();
  const renderers = async () => new Set((await cdp.send("SystemInfo.getProcessInfo")).processInfo
    .filter((p) => p.type === "renderer").map((p) => p.id));
  return { server, browser, renderers };
}

const url = (set, variant, extra) => `http://127.0.0.1:${PORT}/lab/av1/decode/memory/index.html?frames=${SETS[set][0]}` +
  `&set=${set}&variant=${variant}${extra}${MUTATE ? `&mutate=${MUTATE}` : ""}`;

async function mem(b, set, variant, decoders) {
  const before = await b.renderers();
  const context = await b.browser.newContext();
  const page = await context.newPage();
  await page.goto(url(set, variant, `&mode=mem&decoders=${decoders}`));
  await page.waitForFunction(() => globalThis.__stage || globalThis.__result, null, { timeout: 600000 });
  const pid = [...(await b.renderers())].find((p) => !before.has(p));
  const rss = {};
  let peak = 0;
  const sampler = setInterval(() => { peak = Math.max(peak, kib(pid, "VmRSS")); }, 25);
  for (const stage of ["ready", "first", "series", "again"]) {
    const at = await page.waitForFunction((s) => globalThis.__result ? "end" : globalThis.__stage === s && s, stage, { timeout: 600000 })
      .then((h) => h.jsonValue());
    if (at === "end") break;
    rss[stage] = kib(pid, "VmRSS");
    await page.evaluate(() => globalThis.__resume());
  }
  const result = await page.waitForFunction(() => globalThis.__result, null, { timeout: 600000 }).then((h) => h.jsonValue());
  clearInterval(sampler);
  const hwm = kib(pid, "VmHWM");
  await context.close();
  return { ...result, rss_kib: rss, rss_peak_kib: Math.max(peak, ...Object.values(rss)), rss_hwm_kib: hwm };
}

async function first(b, set, variant) {
  const context = await b.browser.newContext();
  const rows = [];
  for (const visit of VISITS) {
    const page = await context.newPage();
    await page.goto(url(set, variant, "&mode=first"));
    const r = await page.waitForFunction(() => globalThis.__result, null, { timeout: 600000 }).then((h) => h.jsonValue());
    await page.close();
    rows.push({ ...r, visit });
  }
  await context.close();
  return rows;
}

const rows = [];
const cells = Object.entries(SETS).flatMap(([set, [, variants]]) => variants.flatMap((variant) =>
  MODE === "mem" ? COUNTS.map((decoders) => ({ set, variant, decoders })) : [{ set, variant }]));
for (let round = FIRST; round < FIRST + ROUNDS; round++) {
  for (const throttle of order(THROTTLES, round)) {
    const b = await launch();
    const stop = throttleTree(b.server.process().pid, throttle);
    for (const c of order(cells, round)) {
      const got = MODE === "mem" ? [await mem(b, c.set, c.variant, c.decoders)] : await first(b, c.set, c.variant);
      for (const r of got) {
        const row = { round, throttle, ...r };
        rows.push(row);
        if (OUT) fs.appendFileSync(OUT, JSON.stringify(row) + "\n");
        const bad = r.error || r.exact !== r.checked ? ` NOT CLEAN ${r.exact}/${r.checked} ${r.error ?? ""}` : "";
        console.error(`round ${round} ${throttle}x ${c.set} ${c.variant}${c.decoders ? ` D=${c.decoders}` : ` ${r.visit}`}${bad}`);
      }
    }
    stop();
    await b.browser.close();
    await b.server.close();
  }
}
process.exit(0);
