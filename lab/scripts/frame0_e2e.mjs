// Regression: connect, requestExactFrame(0), then a bulk 0..2 on the harness page of one arm.
// usage: node frame0_e2e.mjs <http-base> <ts|wasm>
// Env: PLAYWRIGHT_MODULE (path to playwright's index.mjs), CHROME_BIN (Chromium binary).
const PLAYWRIGHT = process.env.PLAYWRIGHT_MODULE ?? "/opt/node22/lib/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROME_BIN ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const { chromium } = await import(PLAYWRIGHT);

const [httpBase, arm] = process.argv.slice(2);
const path = arm === "wasm" ? "/harness/" : "/harness/ts.html";
const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--enable-features=WebTransport", "--no-sandbox"],
});
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
const logHas = (needle) => page.waitForFunction(
  (n) => (document.getElementById("log")?.textContent || "").includes(n),
  needle,
  { timeout: 20_000 },
);
await page.goto(`${httpBase}${path}`, { waitUntil: "networkidle", timeout: 30_000 });
await page.waitForFunction(
  () => /(^|\n)connect /.test(document.getElementById("log")?.textContent || "") ||
    (document.getElementById("log")?.textContent || "").includes("boot error"),
  null,
  { timeout: 20_000 },
);
await page.click("#frame0");
await logHas("frame0 bytes");
await page.click("#bulk");
await logHas("bulk 2 ");
const log = await page.locator("#log").innerText();
await browser.close();
const lines = log.split("\n").filter((l) => /^(frame0 bytes|bulk )/.test(l));
console.log(JSON.stringify({ arm, ok: lines.length === 4 && errors.length === 0, lines, page_errors: errors }));
