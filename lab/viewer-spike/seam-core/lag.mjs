// How far the annotation, drawn on the page, lags the image, drawn in the view worker, during a pan and a scroll,
// in compositor frames, read off the screencast. Indicative: headless Chromium on SwiftShader. README.md here.
//   NODE_PATH=$(npm root -g) node lag.mjs --core DIR --series X.sbnd [--rounds 3]
import { createRequire } from "node:module";
import { decodePng } from "./png.mjs";
import { MARK } from "./shape.mjs";
import { hosts, visit } from "./run.mjs";

const { chromium } = createRequire(import.meta.url)("playwright");
const rounds = Number(process.argv[process.argv.indexOf("--rounds") + 1] || 3);
/** The annotation's column: this many image pixels right of the marker, so neither covers the other. */
const OFFSET = 20;
/** css px the pan moves each page frame. */
const STEP = 2;
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : NaN; };

/** Every frame the compositor hands the screencast while `act` runs in the page, as PNGs, in order. */
async function filmed(page, act) {
  const cdp = await page.context().newCDPSession(page);
  const frames = [];
  cdp.on("Page.screencastFrame", ({ data, sessionId, metadata }) => {
    frames.push({ png: Buffer.from(data, "base64"), t: metadata.timestamp });
    cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
  });
  await cdp.send("Page.startScreencast", { format: "png", everyNthFrame: 1 });
  await page.waitForTimeout(300);
  await page.evaluate(act);
  await page.waitForTimeout(300);
  await cdp.send("Page.stopScreencast");
  await cdp.detach();
  return frames.map((f) => ({ ...f, img: decodePng(f.png) }));
}

/** In rows [y0, y1) of vp1: the column holding most white (the marker) and most yellow (the annotation's line), css px. */
function columns(img, y0, y1) {
  const white = new Array(256).fill(0), yellow = new Array(256).fill(0);
  for (let y = y0; y < y1; y++) for (let x = 0; x < 256; x++) {
    const [r, g, b] = img.at(x, y);
    if (r > 170 && Math.abs(r - b) < 20) white[x]++;
    if (r > 100 && g > 100 && b < 60) yellow[x]++;
  }
  const densest = (a) => { const m = Math.max(...a); return m >= (y1 - y0) / 2 ? a.indexOf(m) : null; };
  return { white: densest(white), yellow: densest(yellow), shown: yellow.some((n) => n > 0) };
}

const setup = (slices) => `(() => {
  const v = spike.viewports.vp1;
  spike.clear();
  spike.activate("Pan");
  v.voiRange = { lower: 0, upper: 30000 };
  v.resetCamera();
  // Given its image: hydrate refuses a viewport class it does not know otherwise (AnnotationTool.hydrateBase).
  for (const k of ${JSON.stringify(slices)}) window.spikeTools.LengthTool.hydrate("vp1", [[${(MARK + OFFSET) * 0.5}, 5, k], [${(MARK + OFFSET) * 0.5}, 43, k]], { referencedImageId: \`wtp:series/\${k}\` });
  v.render();
})()`;

async function pan(page) {
  await page.evaluate(setup([0]));
  await page.evaluate(() => spike.shownAll());
  const frames = await filmed(page, () => new Promise((done) => {
    const v = spike.viewports.vp1;
    let n = 0;
    const tick = () => {
      if (n++ === 60) return done();
      v.setPan([-60 + 2 * n, 0]);
      v.render();
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }));
  const scale = await page.evaluate(() => spike.viewports.vp1.scale);
  const lags = [];
  let prev = null;
  for (const f of frames) {
    const c = columns(f.img, 80, 100);
    if (c.white === null || c.yellow === null) continue;
    const key = `${c.white},${c.yellow}`;
    if (key === prev) continue;
    prev = key;
    // In step the yellow line sits OFFSET image px right of the white column; a lagging image sits STEP px a frame behind.
    lags.push((c.yellow - OFFSET * scale - c.white) / STEP);
  }
  return lags;
}

async function scroll(page) {
  const even = Array.from({ length: 12 }, (_, k) => 2 * k);
  await page.evaluate(setup(even));
  await page.evaluate(() => spike.shownAll());
  const frames = await filmed(page, () => new Promise((done) => {
    const v = spike.viewports.vp1;
    let n = 0;
    const tick = () => {
      if (n === 3 * 23) return done();
      if (n++ % 3 === 0) v.setImageIdIndex(n / 3 | 0);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }));
  const code = (k) => Math.round(((2150 + 1000 * k) / 30000) * 255);
  const seq = [];
  for (const f of frames) {
    const g = f.img.at(11, 11)[0];
    const k = Array.from({ length: 24 }, (_, k) => k).reduce((best, k) => (Math.abs(code(k) - g) < Math.abs(code(best) - g) ? k : best), 0);
    const { shown } = columns(f.img, 30, 60);
    if (seq.length && seq.at(-1).k === k && seq.at(-1).shown === shown) continue;
    seq.push({ k, shown, t: f.t });
  }
  // Each distinct frame where the annotation's presence disagrees with the image's slice parity is a frame of lag;
  // it lasts until the next distinct frame (screencast timestamps are in s).
  const wrong = seq.slice(0, -1).map((s, n) => ({ ...s, ms: (seq[n + 1].t - s.t) * 1000 })).filter((s) => s.shown !== (s.k % 2 === 0));
  return { distinct: seq.length, wrong: wrong.length, ms: median(wrong.map((w) => w.ms)), seq };
}

const { server, url } = await hosts();
const browser = await chromium.launch({ args: ["--enable-unsafe-swiftshader"] });
try {
  console.log(`Chromium ${browser.version()}; pan ${STEP} css px a frame for 60 frames; scroll one slice every 3 frames, the annotation on even slices`);
  for (let r = 1; r <= rounds; r++) {
    const { page } = await visit(browser, url);
    await page.evaluate(() => spike.reset());
    const lags = await pan(page);
    const s = await scroll(page);
    const tally = Object.entries(lags.reduce((m, l) => ((m[l.toFixed(1)] = (m[l.toFixed(1)] ?? 0) + 1), m), {})).sort((a, b) => a[0] - b[0]).map(([l, n]) => `${l}:${n}`).join(" ");
    console.log(`round ${r} pan: ${lags.length} distinct frames, lag in frames median ${median(lags).toFixed(1)}, by count ${tally}`);
    console.log(`round ${r} scroll: ${s.distinct} distinct frames, ${s.wrong} with the annotation on the wrong slice, each for a median ${s.ms.toFixed(1)} ms; ${s.seq.map((x) => `${x.k}${x.shown ? "+" : ""}`).join(" ")}`);
    await page.close();
  }
} finally {
  await browser.close();
  server.close();
}
process.exit(0);
