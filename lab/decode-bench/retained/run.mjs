// Serve the repo cross-origin isolated and drive the retained-frames bench in headless Chromium.
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const PORT = Number(process.env.PORT || 8769);
const server = spawn("python3", ["server/dev-server.py", "--port", String(PORT)], {
  cwd: new URL("../../..", import.meta.url).pathname,
  stdio: "ignore",
});
process.on("exit", () => server.kill());
await new Promise((r) => setTimeout(r, 1500));

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME_PATH || undefined,
  // Without the eager flag measureUserAgentSpecificMemory() is delayed ~10-16 s per call by
  // design; it stays exact with it. docs/decode/README.md §Retained-frame residency.
  args: [
    "--enable-blink-features=ForceEagerMeasureMemory",
    "--disable-background-networking", "--disable-component-update", "--no-default-browser-check",
  ],
});
const page = await browser.newPage();
page.on("pageerror", (e) => process.stderr.write("[pageerror] " + e.message + "\n"));
await page.goto(`http://127.0.0.1:${PORT}/lab/decode-bench/retained/index.html${process.argv[2] || ""}`);
await page.waitForFunction(() => globalThis.__wtpacsDone, null, { timeout: Number(process.env.TIMEOUT_MS || 3600000) });
console.log(await page.evaluate(() => document.getElementById("log").textContent));
if (process.env.OUT) writeFileSync(process.env.OUT, JSON.stringify(await page.evaluate(() => globalThis.__wtpacsResult)));
await browser.close();
server.kill();
