// Measure WASM fetch+compile+instantiate (init()) time per package variant in Chromium.
// usage: node lab/bench/wasm_init_time.mjs <http-base> <pkg-url-path> [runs]   (pkg-url-path: a directory the static host serves, holding transport_wasm.js)
const PLAYWRIGHT = process.env.PLAYWRIGHT_MODULE ?? "/opt/node22/lib/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROME_BIN ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const { chromium } = await import(PLAYWRIGHT);
const [httpBase, pkgPath, runsS = "7"] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox"] });
const times = [];
for (let i = 0; i < Number(runsS); i++) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(`${httpBase}/harness/clock-resolution.html`, { waitUntil: "load" });
  const t = await page.evaluate(async (p) => {
    const t0 = performance.now();
    const mod = await import(p + "/transport_wasm.js");
    const t1 = performance.now();
    await mod.default();
    const t2 = performance.now();
    return { import_ms: t1 - t0, init_ms: t2 - t1 };
  }, pkgPath);
  times.push(t);
  await ctx.close();
}
await browser.close();
const med = (k) => { const v = times.map((t) => t[k]).sort((a, b) => a - b); return v[Math.floor(v.length / 2)]; };
console.log(JSON.stringify({ pkg: pkgPath, runs: times.length, init_ms_median: +med("init_ms").toFixed(1), init_ms_min: +Math.min(...times.map(t=>t.init_ms)).toFixed(1), import_ms_median: +med("import_ms").toFixed(1) }));
