// Serve lab/thread-hops cross-origin isolated and drive it in headless Chromium.
import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const PORT = Number(process.env.PORT || 8766);
const CHROME = process.env.CHROME_PATH || undefined;
const query = process.argv[2] || "";

const server = spawn("python3", ["server/dev-server.py", "--port", String(PORT)], {
  cwd: new URL("../..", import.meta.url).pathname,
  stdio: "ignore",
});
process.on("exit", () => server.kill());

const url = `http://127.0.0.1:${PORT}/lab/thread-hops/index.html${query}`;
await new Promise((r) => setTimeout(r, 1500));

const browser = await chromium.launch({
  headless: true,
  executablePath: CHROME,
  args: ["--disable-background-networking", "--disable-component-update", "--no-default-browser-check", "--disable-sync"],
});
const page = await browser.newPage();
page.on("pageerror", (e) => process.stderr.write("[pageerror] " + e.message + "\n"));
page.on("console", (m) => { if (m.type() === "error") process.stderr.write("[console] " + m.text() + "\n"); });
await page.goto(url);
await page.waitForFunction(() => globalThis.__wtpacsDone, null, { timeout: Number(process.env.TIMEOUT_MS || 900000) });
const text = await page.evaluate(() => document.getElementById("log").textContent);
console.log(text);
if (process.env.OUT) {
  const { writeFileSync } = await import("node:fs");
  writeFileSync(process.env.OUT, JSON.stringify(await page.evaluate(() => globalThis.__wtpacsResult)));
}
await browser.close();
server.kill();
