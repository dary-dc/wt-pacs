// The harness pages against a running server, headless. Run by scripts/cellcheck.sh.
// env: BASE (the static host's origin), WT_URL, CERT_SHA256, CHROME_PATH
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");

const { BASE, WT_URL, CERT_SHA256, CHROME_PATH } = process.env;
const N = 12;
const cell = (query) => `/harness/cell.html?autorun=1&frames=${N}&${query}`;
const cases = [
  ["ts on-demand d=1", cell(`n=${N}`)],
  ["ts on-demand d=4", cell(`d=4&n=${N}`)],
  ["ts fill", cell("cell=fill")],
  ["ts refuse", cell("cell=refuse&n=4")],
  ["wasm on-demand", cell(`transport=wasm&n=${N}`)],
  ["wasm fill", cell("transport=wasm&cell=fill")],
  ["ts busy fill", cell("cell=fill&busy=30")],
  ["telemetry fill", cell("telemetry=1&cell=fill")],
  ["telemetry on-demand d=2", cell(`telemetry=1&d=2&n=${N}`)],
];

const browser = await chromium.launch({ executablePath: CHROME_PATH, headless: true });

// The pages read their endpoint from /wt/dev-transport.json; answering it here leaves the checkout's own alone.
async function open(path) {
  const context = await browser.newContext();
  await context.route("**/wt/dev-transport.json", (r) => r.fulfill({ json: { wt_url: WT_URL, cert_sha256: CERT_SHA256 } }));
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(BASE + path);
  return { page, errors, close: () => context.close() };
}

function delivered(s, path) {
  if (path.includes("cell=refuse")) return s.failed === s.asked && s.delivered === 0;
  return s.delivered === s.asked && s.failed === 0;
}

async function telemetryProblem(page) {
  const report = await page.evaluate(() => globalThis.__wtpacsTelemetry?.() ?? null);
  if (!report) return "telemetry absent";
  const integrity = report.summary?.integrity;
  return integrity?.valid ? null : `telemetry invalid ${JSON.stringify(integrity)}`;
}

let failed = 0;
for (const [name, path] of cases) {
  const { page, errors, close } = await open(path);
  await page.waitForFunction(() => globalThis.__wtpacsDone || globalThis.__wtpacsError != null, null, { timeout: 60_000 });
  const s = await page.evaluate(() => globalThis.__wtpacsShell ?? null);
  const problems = [await page.evaluate(() => globalThis.__wtpacsError ?? null), ...errors];
  if (!s) problems.push("no summary");
  else if (!delivered(s, path)) problems.push("not what it asked");
  if (path.includes("telemetry=1")) problems.push(await telemetryProblem(page));
  const real = problems.filter(Boolean);
  if (real.length) failed += 1;
  const got = s ? `asked ${s.asked} delivered ${s.delivered} failed ${s.failed} in ${s.wall_ms} ms` : "";
  console.log(`${real.length ? "FAIL" : "ok  "} ${name}: ${got} ${real.join(" | ")}`.trimEnd());
  await close();
}

{
  const { page, errors, close } = await open("/harness/");
  await page.waitForFunction(() => globalThis.__wtpacsDone, null, { timeout: 90_000 });
  const pageFailed = await page.evaluate(() => globalThis.__wtpacsFailed);
  const ok = pageFailed === 0 && errors.length === 0;
  if (!ok) failed += 1;
  console.log(`${ok ? "ok  " : "FAIL"} self-check /harness/: ${pageFailed} failed ${errors.join(" | ")}`.trimEnd());
  if (!ok) console.log(await page.locator("#log").innerText());
  await close();
}

await browser.close();
console.log(failed === 0 ? "ALL OK" : `${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
