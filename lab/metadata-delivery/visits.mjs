/**
 * Each visit of a plan in a fresh profile (cold), then the same profile relaunched (warm); one JSON line each.
 * usage: node visits.mjs PLAN HOME ORIGIN   HOME holds the NSS store that trusts the certificate (rig.py)
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const { chromium } = createRequire(import.meta.url)("playwright");
const [planFile, home, origin] = process.argv.slice(2);

for (const visit of JSON.parse(fs.readFileSync(planFile, "utf8"))) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "profile-"));
  for (const state of ["cold", "warm"]) {
    const context = await chromium.launchPersistentContext(profile, { headless: true, env: { ...process.env, HOME: home } });
    let row;
    try {
      const page = context.pages()[0] ?? (await context.newPage());
      await page.goto(`${origin}/page.html?arm=${visit.arm}&study=s000&series=${visit.series}`, { waitUntil: "commit", timeout: 60000 });
      row = await (await page.waitForFunction(() => window.result, null, { timeout: 60000, polling: 20 })).jsonValue();
      row.resources = await page.evaluate(() =>
        performance.getEntriesByType("resource").map((e) => [new URL(e.name).pathname, e.transferSize, e.encodedBodySize]));
    } catch (e) {
      row = { error: String(e) };
    }
    await context.close();
    console.log(JSON.stringify({ ...visit, state, ...row }));
  }
  fs.rmSync(profile, { recursive: true, force: true });
}
