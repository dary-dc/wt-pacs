// One visit of page.html: the fill, a blackout of `blackoutMs` on the link, `l` pressed in it, the page's lines out.
// usage: node drive.mjs <page url> <control port> <blackout ms> <visit ms>
import dgram from "node:dgram";
import { createRequire } from "node:module";

const { chromium } = createRequire(import.meta.url)("playwright");

const [url, control, blackoutMs, visitMs] = process.argv.slice(2);
const browser = await chromium.launch();
const page = await browser.newPage();
const t0 = Date.now();
let filled;
const ready = new Promise((r) => (filled = r));
page.on("console", (m) => {
  const line = m.text();
  console.log(line);
  if (line.includes('"k":"filled"')) filled();
});
page.on("pageerror", (e) => console.log(JSON.stringify({ k: "pageerror", reason: e.message })));
await page.goto(url);
await ready;
const sock = dgram.createSocket("udp4");
await new Promise((r) => sock.send(`blackout ${blackoutMs}`, Number(control), "127.0.0.1", r));
sock.close();
console.log(JSON.stringify({ k: "blackout", ms: Number(blackoutMs) }));
await new Promise((r) => setTimeout(r, 1000));
page.evaluate(() => globalThis.press()).catch(() => {});
await new Promise((r) => setTimeout(r, Math.max(0, Number(visitMs) - (Date.now() - t0))));
await browser.close();
