// A WebGPU stage's transfer cost a frame — codestream up, samples back — against the copy out of the
// wasm heap it would replace, at the breast series' frame sizes, 1× and 4×, interleaved. lab/av1/decode/webgpu/README.md
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { order, leadsByPredecessor } from "../../../order.mjs";
import { throttleTree } from "../../../scripts/cpu_throttle.mjs";

const { chromium } = createRequire(import.meta.url)("playwright");
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const ROUNDS = Number(arg("--rounds", 8));
const THROTTLES = arg("--throttles", "1,4").split(",").map(Number);
const PASSES = Number(arg("--passes", 7));
const MUTATE = process.argv.includes("--mutate");
const HTML = readFileSync(new URL("transfer.html", import.meta.url), "utf8");

/** Frame sizes from lab/av1/bytes/breast and row 41's sets; `bytes` a sample as the decoder hands it over;
 *  `ratio` the codestream's share of the samples' bytes — an assumption, the upload is the small term. */
export const SIZES = [
  { name: "usb_cine 512² 8-bit", w: 512, h: 512, bytes: 1, ratio: 0.5 },
  { name: "dbt12 614×1359", w: 614, h: 1359, bytes: 2, ratio: 0.5 },
  { name: "dbt12_c 931×2124", w: 931, h: 2124, bytes: 2, ratio: 0.5 },
  { name: "dbtproj 1914×2572", w: 1914, h: 2572, bytes: 2, ratio: 0.5 },
  { name: "syn2d_d 2394×2850", w: 2394, h: 2850, bytes: 2, ratio: 0.5 },
  { name: "ffdm_d 3328×4096", w: 3328, h: 4096, bytes: 2, ratio: 0.5 },
];
const VARIANTS = ["heap", "webgpu"];
const FLAGS = ["--enable-unsafe-webgpu", "--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--use-webgpu-adapter=swiftshader", "--enable-features=Vulkan"];

async function inChromium(throttle, round) {
  const server = await chromium.launchServer({ executablePath: process.env.CHROME_PATH || chromium.executablePath(), args: FLAGS });
  const browser = await chromium.connect(server.wsEndpoint());
  const page = await browser.newPage();
  await page.route("http://localhost/", (r) => r.fulfill({ body: HTML, contentType: "text/html" }));
  await page.goto("http://localhost/");
  await page.waitForFunction(() => globalThis.ready);
  const adapter = await page.evaluate(async () => (await navigator.gpu.requestAdapter()).info.architecture);
  await page.evaluate((o) => globalThis.setup(o), { sizes: SIZES, mutate: MUTATE });
  const stop = throttleTree(server.process().pid, throttle, { cores: 1 });
  const rows = [];
  for (const s of order(SIZES, round)) {
    let prev = null;
    for (const variant of order(VARIANTS, round + SIZES.indexOf(s))) {
      const r = await page.evaluate((o) => globalThis.time(o), { name: s.name, variant, passes: PASSES });
      rows.push({ round, throttle, size: s.name, unit: variant, prev, v: r.ms, exact: r.exact, passes: r.passes, adapter });
      prev = variant;
    }
  }
  stop();
  await browser.close();
  await server.close();
  return rows;
}

const median = (v) => { const s = [...v].sort((a, b) => a - b); return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
const rows = [];
const cells = THROTTLES.map((throttle) => ({ throttle }));
for (let round = 0; round < ROUNDS; round++) {
  for (const { throttle } of order(cells, round)) rows.push(...await inChromium(throttle, round));
  console.error(`round ${round} done`);
}

console.log(`adapter ${rows[0].adapter}; n = ${ROUNDS} rounds × ${PASSES} passes, per-round medians`);
console.log("throttle | size | MB back | heap ms [min–max] | webgpu ms [min–max] | webgpu ÷ heap (rounds webgpu slower) | exact");
for (const { throttle } of cells) for (const s of SIZES) {
  const at = (variant) => rows.filter((r) => r.throttle === throttle && r.size === s.name && r.unit === variant);
  const [h, g] = VARIANTS.map(at);
  const ratio = g.map((r) => r.v / h.find((x) => x.round === r.round).v);
  const fmt = (rs) => `${median(rs.map((r) => r.v)).toFixed(2)} [${Math.min(...rs.map((r) => r.v)).toFixed(2)}–${Math.max(...rs.map((r) => r.v)).toFixed(2)}]`;
  const exact = [...h, ...g].reduce((a, r) => a + r.exact, 0);
  const total = [...h, ...g].reduce((a, r) => a + r.passes, 0);
  console.log([`${throttle}×`, s.name, (s.w * s.h * s.bytes / 1e6).toFixed(1), fmt(h), fmt(g), `${median(ratio).toFixed(1)} (${ratio.filter((x) => x > 1).length}/${ratio.length})`, `${exact}/${total}`].join(" | "));
}
for (const { throttle } of cells) {
  const rs = rows.filter((r) => r.throttle === throttle).map((r) => ({ ...r, round: `${r.round}/${r.size}` }));
  console.log(`${throttle}×`, leadsByPredecessor(rs, VARIANTS, [["webgpu", "heap"]], 2).join("\n"));
}
