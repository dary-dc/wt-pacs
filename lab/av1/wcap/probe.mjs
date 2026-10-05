// WebCodecs' AV1 decoder in headless Chromium: which configs it claims, and which streams it
// returns exactly. Ground truth is the encoder input's per-plane SHA-256 (make_streams.py).
//
//   node lab/av1/wcap/probe.mjs STREAM_DIR [OUT.json]
//   MUTATE=1 ...   flips one sample per decoded frame: every exact cell must turn inexact
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const here = dirname(fileURLToPath(import.meta.url));
const [dir, out] = process.argv.slice(2);
const mutate = process.env.MUTATE === "1";
const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
const GOP = 8;
const ARMS = (process.env.ARMS || "tu,noflush,nodelim").split(",");
const PREFS = (process.env.PREFS || "no-preference,prefer-software,prefer-hardware").split(",");

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME_PATH || chromium.executablePath(),
});
const page = await browser.newPage();
page.on("console", (m) => m.type() === "error" && console.error("page:", m.text()));
await page.route("http://localhost/**", (route) => {
  const path = new URL(route.request().url()).pathname.slice(1);
  if (path === "") return route.fulfill({ contentType: "text/html", body: '<script src="page.js"></script>' });
  if (path === "page.js") return route.fulfill({ contentType: "text/javascript", path: join(here, path) });
  return route.fulfill({ contentType: "application/octet-stream", path: join(dir, path) });
});
await page.goto("http://localhost/");
const version = browser.version();

const grid = await page.evaluate(() => window.configGrid());
const cells = [];
for (const cell of manifest) {
  const codec = `av01.${cell.profile}.00M.${String(cell.bits).padStart(2, "0")}`;
  for (const arm of ARMS)
    for (const hardwareAcceleration of PREFS) {
      const r = await page.evaluate((a) => window.decodeStream(a), {
        url: `/${cell.name}.ivf`, codec, mode: cell.mode, gop: GOP, arm, hardwareAcceleration, mutate,
      });
      const compared = r.frames.map((f, i) => {
        const truth = cell.truth[i] || [];
        return truth.length > 0 && truth.every((h, p) => f.planes[p]?.sha256 === h);
      });
      const exactFrames = compared.filter(Boolean).length;
      const first = r.frames[0];
      cells.push({
        name: cell.name, arm, hardwareAcceleration, codec, nativeExact: cell.nativeExact,
        frames: r.frames.length, expected: cell.truth.length, exactFrames,
        exact: r.frames.length === cell.truth.length && exactFrames === cell.truth.length,
        format: first?.format, planes: first?.planes.length,
        chroma: first?.planes.slice(1).map((p) => [p.min, p.max]),
        colorSpace: first?.colorSpace, errors: r.errors.slice(0, 2),
      });
      const c = cells.at(-1);
      console.log(
        `${c.name.padEnd(15)} ${arm.padEnd(8)} ${hardwareAcceleration.padEnd(15)} ` +
          `${String(c.frames).padStart(2)}/${c.expected} frames, ${c.exactFrames} exact  ` +
          `${c.format ?? "-"} ${c.planes ?? ""}p ${c.errors[0] ?? ""}`,
      );
    }
}
await browser.close();

const exactCells = [...new Set(cells.filter((c) => c.exact).map((c) => c.name))];
console.log(`\nChromium ${version}${mutate ? " (MUTATE)" : ""}: exact in some arm: ${exactCells.length}/${manifest.length}`);
console.log(`isConfigSupported true: ${grid.filter((g) => g.supported === true).length}/${grid.length}`);
if (out) writeFileSync(out, JSON.stringify({ version, mutate, grid, cells }, null, 1));
