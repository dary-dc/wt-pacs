/**
 * PREVIEW's decode time: each set's cine decoded whole, in order, in one worker per variant — OpenJPH on
 * the exact HTJ2K frames and on their level-1 prefixes, dav1d-WASM and WebCodecs on every lossy AV1
 * preview — in headless Chromium at each throttle. Every (throttle) cell is a fresh browser, in a
 * Williams order every round; variants rotate inside it the same way. lab/av1/delivery/preview/README.md
 *
 *   NODE_PATH=$(npm root -g) node lab/av1/delivery/preview/time.mjs [--rounds 15] [--throttles 1,4]
 *     [--frames lab/.av1-work/preview] [--mutate hash] [--out rows.json]
 */
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { order } from "../../../order.mjs";
import { throttleTree } from "../../../scripts/cpu_throttle.mjs";

const { chromium } = createRequire(import.meta.url)("playwright");
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const ROUNDS = Number(arg("--rounds", 15));
const THROTTLES = arg("--throttles", "1,4").split(",").map(Number);
const FRAMES = arg("--frames", "lab/.av1-work/preview");
const MUTATE = arg("--mutate", "") === "hash";
const OUT = arg("--out", null);
const ROOT = new URL("../../../..", import.meta.url).pathname;
const PORT = 30000 + ((Math.random() * 10000) | 0);
const BASE = `http://127.0.0.1:${PORT}`;

const manifest = JSON.parse(readFileSync(`${ROOT}/${FRAMES}/manifest.json`, "utf8"));
const prefix = new Map(JSON.parse(readFileSync(`${ROOT}/${FRAMES}/prefix.json`, "utf8")).map((p) => [p.name, p]));

const http = spawn("python3", ["server/dev-server.py", "--port", String(PORT)], { cwd: ROOT, stdio: "ignore" });
process.on("exit", () => http.kill());
await new Promise((r) => setTimeout(r, 1000));

/** Every variant of every set: what the worker is handed and the hashes its frames must have. */
const variants = manifest.flatMap((s) => {
  const url = (dir, ext) => Array.from({ length: s.frames }, (_, i) => `/${FRAMES}/${dir}/${String(i).padStart(3, "0")}.${ext}`);
  const l1 = prefix.get(s.name).levels[1];
  return [
    { set: s.name, variant: "htj2k", o: { variant: "htj2k", level: 0, group: 1, urls: url(s.name, "htj2k") }, want: s.truth },
    { set: s.name, variant: "htj2k-l1", o: { variant: "htj2k", level: 1, group: 1, urls: url(s.name, "htj2k"), lengths: l1.map((f) => f.bytes) },
      want: l1.map((f) => f.digest) },
    ...s.previews.flatMap((p) => [
      { set: s.name, variant: `dav1d ${p.cell}`, o: { variant: "dav1d", group: p.group, urls: url(`${s.name}/${p.cell}`, "av1") }, want: p.hashes },
      { set: s.name, variant: `webcodecs ${p.cell}`, o: { variant: "webcodecs", group: p.group, codec: p.webcodecs, grey: s.channels === 1,
        urls: url(`${s.name}/${p.cell}`, "av1") }, want: p.hashes },
    ]),
  ];
});

async function inChromium(throttle, round) {
  const server = await chromium.launchServer({ executablePath: process.env.CHROME_PATH || chromium.executablePath() });
  const browser = await chromium.connect(server.wsEndpoint());
  const page = await browser.newPage();
  await page.goto(`${BASE}/lab/av1/delivery/preview/index.html`);
  await page.waitForFunction(() => globalThis.ready);
  const stop = throttleTree(server.process().pid, throttle);
  const rows = [];
  for (const a of order(variants, round)) {
    const got = await page.evaluate((o) => globalThis.variant(o), a.o);
    const want = MUTATE ? a.want.map((h) => h.replace(/^./, (c) => (c === "0" ? "1" : "0"))) : a.want;
    const exact = got.hashes ? got.hashes.filter((h, i) => h === want[i]).length : 0;
    rows.push({ round, throttle, set: a.set, variant: a.variant, frames: a.want.length, exact, ms: got.ms, error: got.error });
  }
  stop();
  await browser.close();
  await server.close();
  return rows;
}

const rows = [];
for (let round = 0; round < ROUNDS; round++) {
  for (const throttle of order(THROTTLES, round)) {
    const got = await inChromium(throttle, round);
    rows.push(...got);
    for (const r of got.filter((r) => r.error || r.exact !== r.frames)) {
      console.error(`round ${round} ${throttle}x ${r.set} ${r.variant}: ${r.exact}/${r.frames} ${r.error ?? ""}`);
    }
    console.error(`round ${round} ${throttle}x done`);
  }
}
if (OUT) writeFileSync(OUT, JSON.stringify(rows));

const med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
console.log("ms a frame, a whole cine in one worker: median of rounds [min–max], n; exact frames");
for (const throttle of THROTTLES) {
  for (const { set, variant } of variants) {
    const rs = rows.filter((r) => r.throttle === throttle && r.set === set && r.variant === variant);
    const per = rs.filter((r) => r.ms !== undefined).map((r) => r.ms / r.frames);
    const exact = `${rs.reduce((n, r) => n + r.exact, 0)}/${rs.reduce((n, r) => n + r.frames, 0)}`;
    const t = per.length ? `${med(per).toFixed(2)} [${Math.min(...per).toFixed(2)}–${Math.max(...per).toFixed(2)}] n=${per.length}` : `failed (${rs[0]?.error})`;
    console.log(`${throttle}x\t${set}\t${variant}\t${t}\texact ${exact}`);
  }
}
process.exit(0);
