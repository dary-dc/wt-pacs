/**
 * The passes protocol's rounds: a fresh headless Chromium per round × throttle; sets and then arms in a Williams
 * order inside it. The 4× rounds are spread evenly through the 1× ones. Rows go to --out as they come. README.md here
 *
 *   NODE_PATH=$(npm root -g) node lab/av1/decode/passes/run.mjs [--frames lab/.av1-work/passes/frames]
 *     [--rounds 1:150,4:42] [--product /client/decode] [--arms W,W2] [--sets dbts_a1] [--mutate] [--out rows.json]
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { order } from "../../../order.mjs";
import { throttleTree } from "../../../scripts/cpu_throttle.mjs";
import { CHROME, serve } from "../breakdown/run.mjs";

const { chromium } = createRequire(import.meta.url)("playwright");

/** One fresh browser at `throttle`, running page.js's run(o); its rows. */
async function inChromium(base, throttle, o) {
  const server = await chromium.launchServer({ executablePath: CHROME });
  const browser = await chromium.connect(server.wsEndpoint());
  const page = await browser.newPage();
  await page.goto(`${base}/lab/av1/decode/passes/index.html`);
  if (!(await page.waitForFunction(() => globalThis.ready !== undefined).then((h) => h.jsonValue()))) {
    throw new Error("page is not cross-origin isolated");
  }
  const version = browser.version();
  const stop = throttleTree(server.process().pid, throttle);
  const rows = await page.evaluate((x) => globalThis.run(x), o);
  stop();
  await browser.close();
  await server.close();
  return rows.map((r) => ({ ...r, throttle, chromium: version }));
}

/** [round, throttle] in run order: each throttle's rounds spread over the longest's, the pair at a slot in Williams order. */
export function schedule(counts) {
  const longest = Math.max(...Object.values(counts));
  const slots = Array.from({ length: longest }, () => []);
  for (const [t, n] of Object.entries(counts)) {
    for (let r = 0; r < n; r++) slots[Math.floor((r * longest) / n)].push([r, Number(t)]);
  }
  return slots.flatMap((s, i) => order(s, i));
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
  const list = (k) => arg(k, null)?.split(",");
  const counts = Object.fromEntries(arg("--rounds", "1:150,4:42").split(",").map((c) => c.split(":").map(Number)));
  const OUT = arg("--out", null);
  const o = {
    frames: arg("--frames", "lab/.av1-work/passes/frames"),
    product: arg("--product", "/client/decode"),
    mutate: process.argv.includes("--mutate"),
    only: list("--arms"),
    sets: list("--sets"),
  };
  // A run cut short resumes: a (round, throttle) already in --out is not run again.
  const rows = OUT && existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : [];
  const done = new Set(rows.map((r) => `${r.round}:${r.throttle}`));
  const { base } = await serve();
  for (const [round, throttle] of schedule(counts)) {
    if (done.has(`${round}:${throttle}`)) continue;
    const got = await inChromium(base, throttle, { ...o, round });
    rows.push(...got.map((r) => ({ round, ...r })));
    for (const r of got.filter((r) => r.error || r.exact !== r.n)) {
      console.error(`round ${round} ${throttle}x ${r.set} ${r.arm}: ${r.exact}/${r.n} exact ${r.error ?? ""}`);
    }
    console.error(`round ${round} ${throttle}x done ${new Date().toISOString()}`);
    if (OUT) writeFileSync(OUT, JSON.stringify(rows));
  }
  process.exit(0);
}
