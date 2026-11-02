// The seam spike: Cornerstone3D's tools on a viewport our paint worker draws. README.md here.
//   NODE_PATH=$(npm root -g) node lab/viewer-spike/seam/run.mjs            every check, then every mutant against the check it must fail
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { createRequire } from "node:module";

const { chromium } = createRequire(import.meta.url)("playwright");

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = normalize(join(HERE, "../../.."));
const TYPES = { ".js": "text/javascript", ".mjs": "text/javascript", ".html": "text/html", ".wasm": "application/wasm" };

/** Each mutant breaks the glue in one place; the check named must fail on it. */
const MUTANTS = [
  { name: "canvasToWorld scaled 1.1 in x", check: "length", from: "dest[0] = ((p[0] - this.corner[0]) / this.scale - 0.5) * sx;", to: "dest[0] = ((p[0] - this.corner[0]) / (this.scale * 1.1) - 0.5) * sx;" },
  { name: "the probe reads the next sample", check: "probe", from: "[i + j * f.width]", to: "[i + 1 + j * f.width]" },
  { name: "the painter's pan 8 px off", check: "registration", from: "const panX = (this.corner[0] * dpr", to: "const panX = 8 + (this.corner[0] * dpr" },
  { name: "the painter's zoom 5 % off", check: "zoom and pan", from: "const zoom = this.scale * dpr;", to: "const zoom = this.scale * dpr * 1.05;" },
  { name: "the window never reaches the painter", check: "window drag", from: "const { lower, upper } = this.voiRange;", to: "const { lower, upper } = { lower: 2000, upper: 6000 };" },
  { name: "scroll paints the first slice", check: "scroll", from: "this.sent = { frame: this.frame,", to: "this.sent = { frame: this.frames[0]," },
];

async function bundle(mutant) {
  const patch = {
    name: "mutant",
    setup(b) {
      // xmlbuilder2, under @cornerstonejs/tools, imports two Node builtins; the spike never builds XML.
      b.onResolve({ filter: /^(url|events)$/ }, ({ path }) => ({ path, namespace: "stub" }));
      b.onLoad({ filter: /.*/, namespace: "stub" }, () => ({ contents: "export class EventEmitter {}; export default { EventEmitter, URL };", loader: "js" }));
      b.onLoad({ filter: /worker-viewport\.js$/ }, async ({ path }) => {
        const text = await readFile(path, "utf8");
        if (!mutant) return { contents: text, loader: "js" };
        if (!text.includes(mutant.from)) throw new Error(`mutant "${mutant.name}" does not apply`);
        return { contents: text.replace(mutant.from, mutant.to), loader: "js" };
      });
    },
  };
  const out = await build({ entryPoints: [join(HERE, "page.js")], bundle: true, format: "esm", write: false, external: ["/client/*"], plugins: [patch], logLevel: "silent" });
  return out.outputFiles[0].contents;
}

function serve(page) {
  const server = createServer(async (req, res) => {
    const path = new URL(req.url, "http://x").pathname;
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
    try {
      const body = path === "/lab/viewer-spike/seam/dist/page.js" ? page.current : await readFile(join(ROOT, normalize(path)));
      res.writeHead(200, { "Content-Type": TYPES[extname(path)] ?? "application/octet-stream" });
      res.end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  return new Promise((r) => server.listen(0, "127.0.0.1", () => r(server)));
}

/** ms: the tools' mouse-down listener holds a press this long to tell a double click (DOUBLE_CLICK_TOLERANCE_MS, 400). */
const DOUBLE_CLICK_MS = 450;

const near = (a, b, tol) => Math.abs(a - b) <= tol;

/** Point the mouse at a canvas point of the viewport. */
async function at(page, [x, y]) {
  const [ox, oy] = await page.evaluate(() => spike.origin());
  return [ox + x, oy + y];
}

async function drag(page, from, to) {
  const a = await at(page, from), b = await at(page, to);
  await page.mouse.move(...a);
  await page.mouse.down();
  for (let s = 1; s <= 5; s++) {
    await page.mouse.move(a[0] + ((b[0] - a[0]) * s) / 5, a[1] + ((b[1] - a[1]) * s) / 5);
    await page.waitForTimeout(20);
  }
  await page.mouse.up();
  await page.waitForTimeout(DOUBLE_CLICK_MS);
  await settle(page);
}

/** The engine's next frame, so the tools have recomputed what they show. */
async function settle(page) {
  await page.evaluate(() => { spike.viewport.render(); return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); });
}

async function probeAt(page, p) {
  await page.evaluate(() => { spike.clear(); spike.activate("Probe"); });
  const q = await at(page, p);
  await page.mouse.move(...q);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(DOUBLE_CLICK_MS);
  await settle(page);
  const all = await page.evaluate(() => spike.annotations("Probe"));
  if (all.length !== 1) throw new Error(`${all.length} probe annotations`);
  return Object.values(all[0].stats)[0].value;
}

/** The probe's value and the painted code at one canvas point agree under the tools' window. */
async function registered(page, p) {
  const value = await probeAt(page, p);
  const painted = await page.evaluate(([x, y]) => spike.painted(x, y), p);
  const expected = await page.evaluate((v) => spike.expectedCode(v), value);
  return { value, painted, expected, ok: near(painted, expected, 1) };
}

/** Each check states its claim; it returns `{ ok, seen }`. */
const CHECKS = {
  /** The length tool, dragged between the centres of pixels (10, 10) and (40, 30), measures 0.5 mm × √(30² + 20²). */
  async length(page) {
    await page.evaluate(() => { spike.clear(); spike.activate("Length"); });
    const [a, b] = await page.evaluate(() => [spike.pixelCentre(10, 10), spike.pixelCentre(40, 30)]);
    await drag(page, a, b);
    const [ann] = await page.evaluate(() => spike.annotations("Length"));
    const length = Object.values(ann.stats)[0].length;
    const want = 0.5 * Math.hypot(30, 20);
    return { ok: near(length, want, 0.01), seen: `length ${length?.toFixed(3)} mm, want ${want.toFixed(3)}` };
  },
  /** The probe at the centre of pixel (20, 15) on slice 0 reads that sample from the frame's shared memory. */
  async probe(page) {
    const p = await page.evaluate(() => spike.pixelCentre(20, 15));
    const value = await probeAt(page, p);
    const want = await page.evaluate(() => spike.sample(20, 15, 0));
    return { ok: value === want, seen: `value ${value}, want ${want}` };
  },
  /** At the fit, the code the worker painted under a canvas point is the windowed value the probe reads there. */
  async registration(page) {
    const r = await registered(page, await page.evaluate(() => spike.pixelCentre(20, 15)));
    return { ok: r.ok, seen: `value ${r.value}: painted ${r.painted}, expected ${r.expected}` };
  },
  /** After the zoom tool's drag and the pan tool's drag, the painted image is still under the tools' coordinates. */
  async ["zoom and pan"](page) {
    await page.evaluate(() => spike.activate("Zoom"));
    await drag(page, [128, 96], [128, 140]);
    await page.evaluate(() => spike.activate("Pan"));
    await drag(page, [128, 96], [110, 85]);
    const zoom = await page.evaluate(() => spike.viewport.getZoom());
    const pan = await page.evaluate(() => spike.viewport.getPan());
    const r = await registered(page, await page.evaluate(() => spike.pixelCentre(30, 22)));
    return { ok: zoom > 1.05 && r.ok, seen: `zoom ${zoom.toFixed(3)}, pan ${pan.map((v) => v.toFixed(1))}; value ${r.value}: painted ${r.painted}, expected ${r.expected}` };
  },
  /** The window-level drag changes the tools' window, and the worker paints with it. */
  async ["window drag"](page) {
    await page.evaluate(() => spike.activate("WindowLevel"));
    await drag(page, [128, 96], [168, 116]);
    const voi = await page.evaluate(() => spike.viewport.getProperties().voiRange);
    const r = await registered(page, await page.evaluate(() => spike.pixelCentre(20, 15)));
    const moved = voi.lower !== 2000 || voi.upper !== 6000;
    return { ok: moved && r.ok, seen: `window ${voi.lower.toFixed(1)}–${voi.upper.toFixed(1)}; painted ${r.painted}, expected ${r.expected}` };
  },
  /** One wheel step shows slice 1: the probe reads slice 1's sample and the worker painted slice 1 (pixel (2, 2), inside the window). */
  async scroll(page) {
    const q = await at(page, [128, 96]);
    await page.mouse.move(...q);
    await page.mouse.wheel(0, 120);
    await page.waitForTimeout(100);
    const index = await page.evaluate(() => spike.viewport.getCurrentImageIdIndex());
    const r = await registered(page, await page.evaluate(() => spike.pixelCentre(2, 2)));
    const want = await page.evaluate(() => spike.sample(2, 2, 1));
    return { ok: index === 1 && r.value === want && r.ok, seen: `index ${index}; value ${r.value} (want ${want}): painted ${r.painted}, expected ${r.expected}` };
  },
};

async function visit(browser, server, pageRef, names) {
  const page = await browser.newPage({ viewport: { width: 400, height: 300 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`http://127.0.0.1:${server.address().port}/lab/viewer-spike/seam/index.html`);
  await page.waitForFunction(() => window.spikeReady || window.spikeError, null, { timeout: 30_000 });
  const failed = await page.evaluate(() => window.spikeError);
  if (failed) throw new Error(failed);
  const results = {};
  for (const name of names) {
    try {
      await page.evaluate(() => spike.reset());
      await settle(page);
      results[name] = await CHECKS[name](page);
    } catch (e) {
      results[name] = { ok: false, seen: `threw: ${e.message.split("\n")[0]}` };
    }
  }
  results.errors = errors;
  await page.close();
  return results;
}

const pageRef = { current: await bundle(null) };
const server = await serve(pageRef);
const browser = await chromium.launch({ args: ["--enable-unsafe-swiftshader"] });
let bad = 0;
try {
  const clean = await visit(browser, server, pageRef, Object.keys(CHECKS));
  for (const name of Object.keys(CHECKS)) {
    console.log(`${clean[name].ok ? "pass" : "FAIL"}  ${name}: ${clean[name].seen}`);
    if (!clean[name].ok) bad++;
  }
  if (clean.errors.length) console.log(`page errors: ${clean.errors.join(" | ")}`);
  for (const m of MUTANTS) {
    pageRef.current = await bundle(m);
    const r = (await visit(browser, server, pageRef, [m.check]))[m.check];
    console.log(`${r.ok ? "MISSED" : "caught"}  mutant "${m.name}" by ${m.check}: ${r.seen}`);
    if (r.ok) bad++;
  }
} finally {
  await browser.close();
  server.close();
}
process.exit(bad ? 1 : 0);
