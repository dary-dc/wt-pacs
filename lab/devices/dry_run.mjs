// The runner page through a deployed kit in headless Chromium, quick mode, before the phone is picked up.
//   NODE_PATH=$(npm root -g) node lab/devices/dry_run.mjs 'https://NAME:8443/?t=TOKEN' [--mutate] [--run evening]
// Exits 0 when every D1 and D2 visit is exact and nothing stopped; --mutate expects every D1 visit not exact.
import { createRequire } from "node:module";

const { chromium } = createRequire(import.meta.url)("playwright");

const [url, ...rest] = process.argv.slice(2);
const mutate = rest.includes("--mutate");
const run = rest.includes("--run") ? rest[rest.indexOf("--run") + 1] : "evening";
// CHROME_ARGS: flags for a host whose certificate no CA signed, e.g. --ignore-certificate-errors-spki-list=….
const args = (process.env.CHROME_ARGS ?? "").split(" ").filter(Boolean);
const page = await (await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args })).newPage();
page.on("pageerror", (e) => console.log(`page error: ${e.message}`));
const u = new URL(url);
for (const [k, v] of Object.entries({ run, link: "wifi", mode: "quick" })) u.searchParams.set(k, v);
if (mutate) u.searchParams.set("mutate", "1");
await page.goto(u.href);
await page.waitForFunction(() => globalThis.__done === true, null, { timeout: 30 * 60 * 1000, polling: 500 });
const status = await page.textContent("#status");
console.log(await page.textContent("#reading"));
console.log(status);
const rows = await page.evaluate(() => new Promise((resolve) => {
  indexedDB.open("wt-pacs-devices", 1).onsuccess = (e) => {
    e.target.result.transaction("rows").objectStore("rows").getAll().onsuccess = (g) => resolve(g.target.result);
  };
}));
const visits = (run) => rows.filter((r) => r.run === run);
const exact = (run) => visits(run).filter((r) => r.exact === true).length;
console.log(`rows ${rows.length}, posted ${rows.filter((r) => r.posted).length}; D1 exact ${exact("D1")}/${visits("D1").length}, D2 exact ${exact("D2")}/${visits("D2").length}`);
const d1 = visits("D1").length > 0 && exact("D1") === (mutate ? 0 : visits("D1").length);
const d2 = mutate || visits("D2").every((r) => r.exact === true);
const ok = !/^Stopped/.test(status) && !rows.some((r) => r.run === "error") && (run === "D0" || run === "D2" || d1) && d2;
console.log(ok ? "dry run ok" : "DRY RUN FAILED");
process.exit(ok ? 0 : 1);
