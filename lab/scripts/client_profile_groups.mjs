// CPU-profile one harness cell and group main-thread self time by source file (not just top-30 functions).
// usage: node lab/scripts/client_profile_groups.mjs <http-base> <ts|wasm> <query> <out.json> [timeout-s]
const PLAYWRIGHT = process.env.PLAYWRIGHT_MODULE ?? "/opt/node22/lib/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROME_BIN ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const { chromium } = await import(PLAYWRIGHT);
import { writeFileSync } from "node:fs";
const [httpBase, arm, query, outPath, timeoutS = "180"] = process.argv.slice(2);
const path = arm === "wasm" ? "/harness/" : "/harness/ts.html";
const url = `${httpBase}${path}?autorun=1&${query}`;
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ["--enable-features=WebTransport", "--no-sandbox"] });
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
const cdp = await page.context().newCDPSession(page);
await cdp.send("Profiler.enable");
await cdp.send("Profiler.setSamplingInterval", { interval: 200 });
await cdp.send("Profiler.start");
await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
await page.waitForFunction(() => globalThis.__wtpacsDone === true || globalThis.__wtpacsError != null, null, { timeout: Number(timeoutS) * 1000 });
const { profile } = await cdp.send("Profiler.stop");
const shell = JSON.parse(await page.evaluate(() => JSON.stringify(globalThis.__wtpacsShell ?? null)));
const report = query.includes("telemetry=1") ? JSON.parse(await page.evaluate(() => JSON.stringify(globalThis.__wtpacsTelemetry?.() ?? null))) : null;
const err = await page.evaluate(() => globalThis.__wtpacsError ?? null);
await browser.close();
if (err) { console.error("harness error:", err, errors); process.exit(2); }
const byId = new Map(profile.nodes.map((n) => [n.id, n]));
const selfUs = new Map();
for (let i = 0; i < profile.samples.length; i++) selfUs.set(profile.samples[i], (selfUs.get(profile.samples[i]) ?? 0) + (profile.timeDeltas[i] ?? 0));
const groups = new Map(); const fns = new Map();
const groupOf = (cf) => {
  const u = cf.url || ""; const f = cf.functionName || "";
  if (!u) return f.startsWith("(") ? f : "(native/other)";
  if (u.includes("/record/")) return "recorder (client/record)";
  if (u.includes("session.telemetry.js")) return f && /^(tap|on|proxy|Tap|StreamAttributor|MessageAccumulator|parse|settle|wrapSession|bindGet|nowUs)/.test(f) ? "recorder (in telemetry bundle)" : "product client (in telemetry bundle)";
  if (u.includes("transport-ts/dist/session.js")) return "product client (session.js)";
  if (u.includes("transport_wasm")) return "wasm client (glue + wasm)";
  if (u.startsWith("wasm://")) return "wasm client (glue + wasm)";
  if (u.includes("shell.js")) return "harness shell.js";
  if (u.includes("/harness/")) return "harness page";
  return "other: " + u.split("/").slice(-1)[0];
};
for (const [id, us] of selfUs) { const cf = byId.get(id).callFrame; const g = groupOf(cf); groups.set(g, (groups.get(g) ?? 0) + us); const k = `${cf.functionName || "(anonymous)"} ${cf.url ? cf.url.split("/").slice(-1)[0] + ":" + (cf.lineNumber + 1) : ""}`; fns.set(k, (fns.get(k) ?? 0) + us); }
const total = [...groups.values()].reduce((a, b) => a + b, 0);
const busy = total - (groups.get("(idle)") ?? 0);
const out = { arm, query, shell, total_us: total, busy_us: busy, groups: Object.fromEntries([...groups.entries()].sort((a, b) => b[1] - a[1])), top: [...fns.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40), tap_read_cost_us: report?.summary?.integrity?.tap_read_cost_us ?? null, integrity_valid: report?.summary?.integrity?.valid ?? null, page_errors: errors };
writeFileSync(outPath, JSON.stringify(out, null, 1));
console.log(JSON.stringify({ arm, delivered: shell?.delivered, failed: shell?.failed, wall_ms: shell?.wall_ms, busy_ms: Math.round(busy / 1000), tap_read_cost_us: out.tap_read_cost_us, valid: out.integrity_valid }));
for (const [g, us] of Object.entries(out.groups)) console.log(`${(us / 1000).toFixed(1).padStart(8)} ms  ${(100 * us / busy).toFixed(1).padStart(5)} % busy  ${g}`);
