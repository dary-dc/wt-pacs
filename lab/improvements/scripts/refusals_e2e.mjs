// Drive client/harness/refusals.html for one arm and print the summary as JSON.
// usage: node refusals_e2e.mjs <http-base> <arm> <n> <wt-url> <cert-sha256> [timeout-s]
// Env: PLAYWRIGHT_MODULE (path to playwright's index.mjs), CHROME_BIN (Chromium binary).
const PLAYWRIGHT = process.env.PLAYWRIGHT_MODULE ?? "/opt/node22/lib/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROME_BIN ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const { chromium } = await import(PLAYWRIGHT);

const [httpBase, arm, n, wt, hash, timeoutS = "60"] = process.argv.slice(2);
const url = `${httpBase}/harness/refusals.html?arm=${arm}&n=${n}&wt=${encodeURIComponent(wt)}&hash=${hash}`;

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--enable-features=WebTransport", "--no-sandbox"],
});
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(url, { waitUntil: "networkidle", timeout: 30_000 });
await page.waitForFunction(
  () => globalThis.__wtpacsDone === true || globalThis.__wtpacsError != null,
  null,
  { timeout: Number(timeoutS) * 1000 },
);
const err = await page.evaluate(() => globalThis.__wtpacsError ?? null);
if (err) {
  console.error("harness error:", err, errors);
  await browser.close();
  process.exit(2);
}
const summary = JSON.parse(await page.evaluate(() => JSON.stringify(globalThis.__wtpacsRefusals ?? null)));
if (!summary) {
  console.error("no summary; page log tail:\n" + (await page.locator("#log").innerText()).split("\n").slice(-4).join("\n"));
  await browser.close();
  process.exit(3);
}
const version = browser.version();
await browser.close();
const { results, ...head } = summary;
const ms = results.map((r) => r.ms);
console.log(JSON.stringify({ ...head, chromium: version, first_ms: ms.slice(0, 3), last_ms: ms.slice(-3), page_errors: errors }));
