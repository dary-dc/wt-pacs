// CPU-profile one client arm through a harness fill/ondemand cell and print self time by function.
// usage: node client_profile.mjs <http-base> <ts|wasm> <query e.g. "cell=fill&stream_mode=shared&frames=80"> <out.json> [timeout-s]
import { chromium } from "/opt/node22/lib/node_modules/playwright/index.mjs";
import { writeFileSync } from "node:fs";

const [httpBase, arm, query, outPath, timeoutS = "120"] = process.argv.slice(2);
const path = arm === "wasm" ? "/harness/" : "/harness/ts.html";
const url = `${httpBase}${path}?autorun=1&${query}`;

const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  headless: true,
  args: ["--enable-features=WebTransport", "--no-sandbox"],
});
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
const cdp = await page.context().newCDPSession(page);
await cdp.send("Profiler.enable");
await cdp.send("Profiler.setSamplingInterval", { interval: 200 }); // µs
await cdp.send("Profiler.start");
await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
await page.waitForFunction(
  () => globalThis.__wtpacsDone === true || globalThis.__wtpacsError != null,
  null,
  { timeout: Number(timeoutS) * 1000 },
);
const { profile } = await cdp.send("Profiler.stop");
const shell = JSON.parse(await page.evaluate(() => JSON.stringify(globalThis.__wtpacsShell ?? null)));
const err = await page.evaluate(() => globalThis.__wtpacsError ?? null);
await browser.close();
if (err) {
  console.error("harness error:", err, errors);
  process.exit(2);
}

// Self time per node from sample counts × per-sample deltas.
const byId = new Map(profile.nodes.map((n) => [n.id, n]));
const selfUs = new Map();
for (let i = 0; i < profile.samples.length; i++) {
  const id = profile.samples[i];
  selfUs.set(id, (selfUs.get(id) ?? 0) + (profile.timeDeltas[i] ?? 0));
}
const rows = new Map();
for (const [id, us] of selfUs) {
  const n = byId.get(id);
  const cf = n.callFrame;
  const where = cf.url ? `${cf.url.split("/").slice(-2).join("/")}:${cf.lineNumber + 1}` : "";
  const key = `${cf.functionName || "(anonymous)"} ${where}`.trim();
  rows.set(key, (rows.get(key) ?? 0) + us);
}
const total = [...rows.values()].reduce((a, b) => a + b, 0);
const top = [...rows.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30);
writeFileSync(outPath, JSON.stringify({ arm, query, shell, total_us: total, top, page_errors: errors }, null, 1));
console.log(JSON.stringify({ arm, delivered: shell?.delivered, failed: shell?.failed, wall_ms: shell?.wall_ms, profile_total_ms: Math.round(total / 1000) }));
for (const [k, us] of top) console.log(`${(us / 1000).toFixed(1).padStart(8)} ms  ${(100 * us / total).toFixed(1).padStart(5)} %  ${k}`);
