// Drive the TS harness page in headless Chromium until it sets window.__wtpacsDone, then
// print its log. usage: NODE_PATH=$(npm root -g) node chrome_harness.cjs URL [timeout_ms]
const { chromium } = require("playwright");
const url = process.argv[2];
const timeoutMs = Number(process.argv[3] || 180000);
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  page.on("pageerror", (e) => process.stderr.write("[pageerror] " + e.message + "\n"));
  await page.goto(url);
  await page.waitForFunction(() => globalThis.__wtpacsDone, null, { timeout: timeoutMs });
  console.log(await page.evaluate(() => document.getElementById("log")?.innerText || ""));
  await browser.close();
})().catch((e) => {
  console.error("chrome run failed:", e.message.split("\n")[0]);
  process.exit(1);
});
