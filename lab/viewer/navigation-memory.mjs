// Renderer memory over repeated same-origin loads of the viewer, each left by a navigation as the phone round's
// runner leaves it (viewer → GET /next on a same-site origin → 302 → viewer). docs/client/evidence/navigation-memory.md
//
//   NODE_PATH=$(npm root -g) node lab/viewer/navigation-memory.mjs LOADS [--bfcache on|off] [--view page|worker] [--opts JSON] [--gc] [--json]
//     the pair already served on 8765 (scripts/demo-pair.sh); --bfcache on drops Playwright's --disable-back-forward-cache
import { readdirSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const LOADS = Number(process.argv[2] ?? 6);
const BFCACHE = arg("--bfcache", "on") === "on";
const VIEW = arg("--view", "page");
const GC = process.argv.includes("--gc");
const OPTS = arg("--opts");
const VIEWER = `http://127.0.0.1:8765/?view=${VIEW}${OPTS ? `&opts=${encodeURIComponent(OPTS)}` : ""}`;
const RUNNER = "http://127.0.0.1:8780";

const hides = [];
const runner = createServer((req, res) => {
  const url = new URL(req.url, RUNNER);
  if (url.pathname === "/hide") hides.push({ load: Number(url.searchParams.get("load")), persisted: url.searchParams.get("persisted") === "true" });
  res.writeHead(url.pathname === "/next" ? 302 : 204, { location: `${VIEWER}&load=${url.searchParams.get("after")}`, "access-control-allow-origin": "*" });
  res.end();
}).listen(8780, "127.0.0.1");

/** Each renderer's proportional set size in KiB: the share of its pages a process alone would free. */
function renderers() {
  const out = [];
  for (const pid of readdirSync("/proc").filter((d) => /^\d+$/.test(d))) {
    try {
      const cmd = readFileSync(`/proc/${pid}/cmdline`, "utf8");
      if (!cmd.includes("--type=renderer")) continue;
      const pss = Number(readFileSync(`/proc/${pid}/smaps_rollup`, "utf8").match(/^Pss:\s+(\d+)/m)[1]);
      out.push({ pid: Number(pid), pssMiB: Math.round(pss / 1024) });
    } catch {}
  }
  return out;
}

function tellHide() {
  addEventListener("pagehide", (e) => {
    const load = new URLSearchParams(location.search).get("load") ?? "0";
    navigator.sendBeacon(`http://127.0.0.1:8780/hide?load=${load}&persisted=${e.persisted}`);
  });
}

const { chromium } = createRequire(import.meta.url)("playwright");
const browser = await chromium.launch(BFCACHE ? { ignoreDefaultArgs: ["--disable-back-forward-cache"] } : {});
const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
const cdp = await page.context().newCDPSession(page);
await page.addInitScript(tellHide);
const filled = () => page.waitForFunction(() => /fill \d+ ms/.test(document.getElementById("status")?.textContent ?? ""), null, { timeout: 120000 });
const rows = [];
await page.goto(`${VIEWER}&load=0`);
for (let k = 0; k < LOADS; k++) {
  await filled();
  await page.waitForTimeout(1000);
  const row = { load: k, bfcache: BFCACHE, view: VIEW, opts: OPTS ?? null, renderers: renderers() };
  if (GC) {
    await cdp.send("HeapProfiler.collectGarbage");
    await page.waitForTimeout(1000);
    row.afterGc = renderers();
  }
  rows.push(row);
  await page.evaluate((u) => location.assign(u), `${RUNNER}/next?after=${k + 1}`);
  await page.waitForURL(new RegExp(`load=${k + 1}$`));
}
await page.waitForTimeout(500);
for (const r of rows) r.persisted = hides.find((h) => h.load === r.load)?.persisted ?? null;
await browser.close();
runner.close();
if (process.argv.includes("--json")) for (const r of rows) console.log(JSON.stringify(r));
else for (const r of rows) console.log(`load ${r.load} persisted=${r.persisted} renderers ${r.renderers.map((p) => `${p.pid}:${p.pssMiB}MiB`).join(" ")}${r.afterGc ? ` after gc ${r.afterGc.map((p) => `${p.pid}:${p.pssMiB}MiB`).join(" ")}` : ""}`);
