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
  const log = await page.evaluate(() => document.getElementById("log")?.innerText || "");
  // A failed check must survive the gate's `| tail -2`: name it on stderr as well.
  for (const line of log.split("\n")) if (/FAIL|threw/.test(line)) process.stderr.write(line + "\n");
  let failed = await page.evaluate(() => globalThis.__wtpacsFailed ?? 1);
  // Every clause closes what it opened, so a worker still here is one a closed client left running.
  const t0 = Date.now();
  while (page.workers().length > 0 && Date.now() - t0 < 5000) await new Promise((r) => setTimeout(r, 100));
  const left = page.workers().map((w) => w.url().replace(/\?.*/, ""));
  console.log(`workers left running after every client closed: ${left.length}`);
  if (left.length) {
    process.stderr.write(`FAIL: ${left.length} workers outlived their closed clients: ${[...new Set(left)].join(", ")}\n`);
    failed += 1;
  }
  console.log(log);
  await browser.close();
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error("chrome run failed:", e.message.split("\n")[0]);
  process.exit(1);
});
