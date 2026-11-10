// In the phone's namespace: open the page, wait for the fill, press `l`, read the label, the overlay and the status.
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)(process.env.PW || "playwright");
const browser = await chromium.launch();
const page = await browser.newPage();
page.on("console", (m) => /preload/.test(m.text()) || console.log("console:", m.text()));
await page.goto("http://127.0.0.1:8765/?overlay=1");
const read = () => page.evaluate(() => ({ quality: document.getElementById("quality").textContent,
  overlay: document.getElementById("overlay").textContent, status: document.getElementById("status").textContent }));
await page.waitForFunction(() => /received (\d+)/.exec(document.getElementById("status").textContent)?.[1] > 0, null, { timeout: 60000 }).catch(async () => { console.log("no frame:", JSON.stringify(await read())); process.exit(1); });
await page.waitForTimeout(2000);
console.log("before l:", JSON.stringify(await read()));
await page.keyboard.press("l");
await page.waitForFunction(() => ["Lossless", "Lossless check failed · optimal quality shown"].includes(document.getElementById("quality").textContent), null, { timeout: 60000 }).catch(() => {});
console.log("after l:", JSON.stringify(await read()));
await browser.close();
