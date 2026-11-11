// In the phone's namespace: open the page at the laptop's address, wait for the fill, press `l`, read the screen.
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");
const url = process.env.URL;
const args = process.env.ARM === "noflag" ? [] : [`--unsafely-treat-insecure-origin-as-secure=${url}`];
// The headless shell ignores the flag; the full browser, as on the phone, honors it.
const browser = await chromium.launch({ channel: "chromium", args });
const page = await browser.newPage();
page.on("console", (m) => /preload/.test(m.text()) || console.log("console:", m.text().slice(0, 300)));
await page.goto(`${url}/?overlay=1`);
console.log("context:", JSON.stringify(await page.evaluate(() => ({ isSecureContext, crossOriginIsolated, WebTransport: typeof WebTransport }))));
const read = () => page.evaluate(() => ({ quality: document.getElementById("quality").textContent,
  overlay: document.getElementById("overlay").textContent, status: document.getElementById("status").textContent }));
const total = () => page.evaluate(() => /received (\d+)/.exec(document.getElementById("status").textContent)?.[1]);
await page.waitForFunction(() => /received (\d+)/.exec(document.getElementById("status").textContent)?.[1] > 0, null, { timeout: 60000 })
  .catch(async () => { console.log("no frame:", JSON.stringify(await read())); await browser.close(); process.exit(1); });
let last = -1;
for (let i = 0; i < 60 && (await total()) !== last; i++) { last = await total(); await page.waitForTimeout(2000); }
console.log("before l:", JSON.stringify(await read()));
await page.keyboard.press("l");
await page.waitForFunction(() => ["Lossless", "Lossless check failed · optimal quality shown"].includes(document.getElementById("quality").textContent), null, { timeout: 60000 }).catch(() => {});
console.log("after l:", JSON.stringify(await read()));
await browser.close();
