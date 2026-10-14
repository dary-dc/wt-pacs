/**
 * Headless Chromium kept open across a campaign: each line on stdin is a page URL, each line out the
 * page's `__result` as JSON. lab/ask-ahead/README.md
 *
 *   NODE_PATH=$(npm root -g) node lab/ask-ahead/visit.mjs
 */
import readline from "node:readline";
import { createRequire } from "node:module";

const { chromium } = createRequire(import.meta.url)("playwright");
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME_PATH || chromium.executablePath(),
  args: ["--disable-background-networking", "--disable-background-timer-throttling", "--disable-renderer-backgrounding"],
});
console.log(JSON.stringify({ chromium: browser.version() }));
for await (const url of readline.createInterface({ input: process.stdin })) {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  if (process.env.DEBUG) {
    page.on("console", (m) => console.error(`[page] ${m.text()}`));
    page.on("worker", (w) => w.on("console", (m) => console.error(`[worker] ${m.text()}`)));
  }
  let result;
  try {
    await page.goto(url);
    await page.waitForFunction(() => globalThis.__result, null, { timeout: 120000, polling: 50 });
    result = await page.evaluate(() => globalThis.__result);
  } catch (e) {
    result = { error: String(e.message).split("\n")[0] };
  }
  await page.close();
  console.log(JSON.stringify({ ...result, errors }));
}
await browser.close();
