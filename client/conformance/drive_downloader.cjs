// Drive downloader.html headless, print its log, and exit with its failure count.
// usage: NODE_PATH=$(npm root -g) node drive_downloader.cjs URL [timeout_ms]
const { chromium } = require("playwright");
const url = process.argv[2];
const timeoutMs = Number(process.argv[3] || 120000);
(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROME_PATH || undefined,
    args: ["--disable-background-networking"],
  });
  const page = await browser.newPage();
  page.on("pageerror", (e) => process.stderr.write("[pageerror] " + e.message + "\n"));
  await page.goto(url);
  await page.waitForFunction(() => globalThis.__wtpacsDone, null, { timeout: timeoutMs });
  console.log(await page.evaluate(() => document.getElementById("log")?.innerText || ""));
  const failed = await page.evaluate(() => globalThis.__wtpacsFailed ?? 1);
  await browser.close();
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error("chrome run failed:", e.message.split("\n")[0]);
  process.exit(1);
});
