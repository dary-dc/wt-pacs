/**
 * The probe's visits, each variant a fresh page on a quiet or a busy page, interleaved by lab/order.mjs; rows to
 * rows/<engine>.jsonl as they come. lab/paint-read/README.md
 *
 *   node lab/paint-read/run.mjs [--rounds 12] [--seconds 10]
 *   FIREFOX_PATH=… xvfb-run -a node lab/paint-read/run.mjs --browser firefox
 *   node lab/paint-read/run.mjs --summary lab/paint-read/rows/chromium.jsonl
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { order } from "../order.mjs";
import { firefoxAt, staticHost } from "../opfs-cache/browser.mjs";
import { summarise, UNITS } from "./measure.js";

const HERE = path.dirname(new URL(import.meta.url).pathname);
const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i < 0 ? fallback : argv[i + 1];
};
const readRows = (file) => fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));

if (argv.includes("--summary")) {
  console.log(summarise(readRows(flag("summary"))).text);
  process.exit(0);
}

const engine = flag("browser", "chromium");
if (engine === "firefox" && !process.env.DISPLAY) throw new Error("Firefox runs headed for WebGL2 in a worker: xvfb-run -a");
const ROUNDS = Number(flag("rounds", 12));
const FIRST = Number(flag("first", 0));
const SECONDS = Number(flag("seconds", 10));
const out = flag("rows", path.join(HERE, "rows", `${engine}.jsonl`));
const origin = await staticHost();

async function browser() {
  if (engine === "firefox") {
    const profile = fs.mkdtempSync(path.join(process.env.TMPDIR ?? "/tmp", "paint-read-"));
    const ff = await firefoxAt(profile, { "webgl.force-enabled": true });
    // One tab, navigated afresh each visit: Marionette discards the session's window when its last tab closes.
    return { newPage: async () => ({ ...ff.page, close: async () => {} }), close: () => ff.context.close() };
  }
  const { chromium } = createRequire(import.meta.url)("playwright");
  const b = await chromium.launch({ channel: "chromium", args: ["--ignore-gpu-blocklist"] });
  return { newPage: () => b.newPage({ viewport: { width: 800, height: 700 } }), close: () => b.close() };
}

const b = await browser();
const round1 = (x, d) => Math.round(x * 10 ** d) / 10 ** d;
for (let round = FIRST; round < FIRST + ROUNDS; round++) {
  const units = order(UNITS, round);
  for (const [k, { variant, busy }] of units.entries()) {
    const page = await b.newPage();
    await page.goto(`${origin}/lab/paint-read/index.html?${new URLSearchParams({ variant, busy: busy ? 1 : 0, seconds: SECONDS })}`);
    const r = await page.evaluate(() => globalThis.__run);
    await page.close();
    const prev = k ? units[k - 1] : null;
    const row = { engine, round, variant, busy, prev: prev && `${prev.variant}/${prev.busy ? "busy" : "quiet"}`, ...(r.error ? { error: r.error } : {
      userAgent: r.userAgent, renderer: r.renderer, period: r.period, ms: r.ms, tasks: r.tasks.map((t) => round1(t, 1)),
      // On the visit's clock: ms from its t0.
      calls: r.calls.map((c) => [round1(c.start - r.t0, 1), round1(c.ms, 2), ...(c.timedOut ? [1] : [])]),
      spans: r.spans.map(([a, e]) => [round1(a - r.t0, 1), round1(e - r.t0, 1)]),
    }) };
    fs.appendFileSync(out, `${JSON.stringify(row)}\n`);
    console.log(`${engine} r${round} ${variant.padEnd(6)} ${busy ? "busy " : "quiet"} ${r.error ?? `${r.calls.length} calls, median ${round1(
      [...r.calls.map((c) => c.ms)].sort((x, y) => x - y)[r.calls.length >> 1], 2)} ms${round === FIRST && k === 0 ? `  ${r.renderer}; ${r.userAgent}` : ""}`}`);
  }
}
await b.close();
console.log(summarise(readRows(out)).text);
process.exit(0);
