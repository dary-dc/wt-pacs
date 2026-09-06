// Open a bench page and print globalThis.__rows once __done is set. usage: node run_page.mjs <url>
// Env: PLAYWRIGHT_MODULE (path to playwright's index.mjs), CHROME_BIN (Chromium binary).
const PLAYWRIGHT = process.env.PLAYWRIGHT_MODULE ?? "/opt/node22/lib/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROME_BIN ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const { chromium } = await import(PLAYWRIGHT);
const [url] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage();
await page.goto(url, { waitUntil: "load", timeout: 30_000 });
await page.waitForFunction(() => globalThis.__done === true, null, { timeout: 120_000 });
console.log(await page.evaluate(() => JSON.stringify(globalThis.__rows)));
console.log("chromium", browser.version());
await browser.close();
