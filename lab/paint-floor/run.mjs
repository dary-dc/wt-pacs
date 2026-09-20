/**
 * Drives lab/paint-floor/index.html: generates the sample sets if they are missing, serves them
 * cross-origin isolated, and runs the two routes against each other. lab/paint-floor/README.md.
 *
 *   NODE_PATH=$(npm root -g) node lab/paint-floor/run.mjs check
 *   NODE_PATH=$(npm root -g) node lab/paint-floor/run.mjs bench [--renderer gl|swiftshader|vulkan]
 *   NODE_PATH=$(npm root -g) node lab/paint-floor/run.mjs drag
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { createRequire } from "node:module";

const { chromium } = createRequire(import.meta.url)("playwright");
const HERE = path.dirname(new URL(import.meta.url).pathname);
const ROOT = path.resolve(HERE, "../..");

const argv = process.argv.slice(2);
const mode = argv.find((a) => !a.startsWith("--")) ?? "bench";
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i < 0 ? fallback : argv[i + 1];
};

const RENDERERS = {
  gl: ["--use-angle=gl"],
  vulkan: ["--use-angle=vulkan", "--enable-features=Vulkan"],
  swiftshader: [],
};
const CSS = {
  cine512: { w: 512, h: 512 },
  ct512: { w: 512, h: 512 },
  big12mp: { w: 768, h: 576 },
};
const DPRS = flag("dprs", "1,2,3").split(",").map(Number);
const PASSES = Number(flag("passes", 3));
const PAINTS = Number(flag("paints", 12));
const SMOOTH = argv.includes("--smooth");

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
const fmt = (x, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : "n/a");

if (!fs.existsSync(path.join(HERE, "frames/manifest.json"))) {
  execFileSync("python3", [path.join(HERE, "frames.py")], { stdio: "inherit" });
}
const SETS = JSON.parse(fs.readFileSync(path.join(HERE, "frames/manifest.json"), "utf8"));

/** Every display size the bench times, plus 1:1, each once — equality proven where it is timed. */
const CHECK_OUT = Object.fromEntries(Object.entries(CSS).map(([set, css]) => {
  const sizes = argv.includes("--quick") && set === "big12mp"
    ? [{ w: css.w, h: css.h }]
    : [{ w: SETS[set].width, h: SETS[set].height }, ...[1, 2, 3].map((d) => ({ w: css.w * d, h: css.h * d }))];
  return [set, sizes.filter((o, i) => sizes.findIndex((q) => q.w === o.w && q.h === o.h) === i)];
}));

const port = 30000 + ((Math.random() * 20000) | 0);
const kids = [spawn("python3", ["server/dev-server.py", "--port", String(port)], { cwd: ROOT, stdio: "ignore" })];
process.on("exit", () => kids.forEach((k) => k.kill()));
await new Promise((r) => setTimeout(r, 700));

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME_PATH,
  args: ["--no-sandbox", "--ignore-gpu-blocklist", "--enable-precise-memory-info",
    ...RENDERERS[flag("renderer", "gl")]],
});
kids.push({ kill: () => browser.close() });
let renderer = "unknown";

async function visit(dpr, work) {
  const context = await browser.newContext({
    deviceScaleFactor: dpr, viewport: { width: 1600, height: 700 },
  });
  const page = await context.newPage();
  page.on("pageerror", (e) => console.error("page error:", e.message));
  const url = `http://127.0.0.1:${port}/lab/paint-floor/index.html`;
  await page.goto(url);
  renderer = (await page.evaluate(() => globalThis.__paint.ready)).renderer;
  const out = await work(page);
  await context.close();
  return out;
}

if (mode === "check") {
  const rows = await visit(1, (page) => page.evaluate(async (outs) => {
    const { sets } = await globalThis.__paint.ready;
    const out = [];
    for (const set of Object.keys(sets)) {
      for (const w of ["identity", "tight"]) {
        for (const o of outs[set]) out.push(globalThis.__paint.check(set, w, o));
      }
    }
    return out;
  }, CHECK_OUT));
  console.log(`renderer  ${renderer}\n`);
  console.log("set        window    source     display    samples      on edge  differ    off edge  worst");
  let bad = 0;
  for (const r of rows) {
    bad += r.decided;
    console.log(`${r.set.padEnd(10)} ${r.window.padEnd(9)} ${r.src.padEnd(10)} ${
      `${r.w}x${r.h}`.padEnd(10)} ${String(r.samples).padEnd(12)} ${
      `${((100 * r.onEdges) / r.samples).toFixed(1)}%`.padEnd(8)} ${
      String(r.mismatched).padEnd(9)} ${String(r.decided).padEnd(9)} ${r.worst}`);
  }
  console.log(`\n${bad === 0
    ? "pixel-equal wherever the source coordinate is not on a texel edge"
    : `NOT EQUAL: ${bad} samples differ off a texel edge`}`);
  process.exit(bad === 0 ? 0 : 1);
}

const cells = new Map();
for (let pass = 0; pass < PASSES; pass++) {
  for (let d = 0; d < DPRS.length; d++) {
    const results = await visit(DPRS[(pass + d) % DPRS.length], (page) => page.evaluate(async (o) => {
      const { sets } = await globalThis.__paint.ready;
      const out = [];
      for (const set of Object.keys(sets)) {
        for (const w of o.windows) {
          out.push(await globalThis.__paint.run({
            set, window: w, css: o.css[set], paints: o.paints, smooth: o.smooth, drag: o.drag,
          }));
        }
      }
      return out;
    }, {
      css: CSS, windows: mode === "drag" ? ["tight"] : ["identity", "tight"],
      paints: PAINTS, smooth: SMOOTH, drag: mode === "drag",
    }));
    for (const r of results) {
      const k = `${r.set}|${r.window}|${r.dpr}|${r.out.w}x${r.out.h}`;
      if (!cells.has(k)) cells.set(k, { "2d": [], gl: [] });
      for (const label of ["2d", "gl"]) cells.get(k)[label].push(...r.rows[label]);
    }
  }
  process.stderr.write(`pass ${pass + 1}/${PASSES} done\n`);
}

console.log(`renderer  ${renderer}`);
console.log(`${mode}, ${PASSES} passes x ${PAINTS} paints per route per cell, arms interleaved, smoothing ${SMOOTH}\n`);
console.log("set        window    dpr  display     2d main ms        gl main ms       2d/gl   2d raf  gl raf  2d kB  gl kB");
for (const [k, v] of [...cells.keys()].sort().map((k) => [k, cells.get(k)])) {
  const [set, win, dpr, display] = k.split("|");
  const main = (label) => median(v[label].map((r) => r.main));
  const rng = (label) => {
    const xs = v[label].map((r) => r.main);
    return `${fmt(Math.min(...xs), 1)}-${fmt(Math.max(...xs), 1)}`;
  };
  console.log(`${set.padEnd(10)} ${win.padEnd(9)} ${dpr.padEnd(4)} ${display.padEnd(11)} ${
    `${fmt(main("2d"))} (${rng("2d")})`.padEnd(17)} ${
    `${fmt(main("gl"))} (${rng("gl")})`.padEnd(16)} ${
    `${fmt(main("2d") / main("gl"), 1)}x`.padStart(6)}  ${
    fmt(median(v["2d"].map((r) => r.raf)), 1).padStart(6)}  ${
    fmt(median(v.gl.map((r) => r.raf)), 1).padStart(6)}  ${
    fmt(median(v["2d"].map((r) => r.used)) / 1024, 0).padStart(6)}  ${
    fmt(median(v.gl.map((r) => r.used)) / 1024, 0).padStart(5)}`);
}
console.log(`\nn per cell: ${PASSES * PAINTS} paints per route`);
process.exit(0);
