/**
 * EMBED's decode time: each set's first FRAMES frames decoded in order in one worker per arm —
 * OpenJPH on the served HTJ2K, OpenJPEG on the first quality layer's prefix and on the whole layered
 * codestream, libjxl on the prefix it first draws a picture from and on the whole progressive and plain
 * codestreams — in headless Chromium at each throttle. Every throttle cell is a fresh browser, in a
 * Williams order every round; arms rotate inside it the same way. lab/av1/embed/README.md
 *
 *   NODE_PATH=$(npm root -g) node lab/av1/embed/time.mjs [--rounds 12] [--throttles 1,4]
 *     [--frames 18] [--work lab/.av1-work/embed] [--mutate hash] [--out rows.json]
 */
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { order } from "../../order.mjs";
import { throttleTree } from "../../scripts/cpu_throttle.mjs";

const { chromium } = createRequire(import.meta.url)("playwright");
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const ROUNDS = Number(arg("--rounds", 12));
const THROTTLES = arg("--throttles", "1,4").split(",").map(Number);
const FRAMES = Number(arg("--frames", 18));
const WORK = arg("--work", "lab/.av1-work/embed");
const MUTATE = arg("--mutate", "") === "hash";
const OUT = arg("--out", null);
const ROOT = new URL("../../..", import.meta.url).pathname;
const PORT = 30000 + ((Math.random() * 10000) | 0);
const BASE = `http://127.0.0.1:${PORT}`;

const { sets } = JSON.parse(readFileSync(`${ROOT}/${WORK}/manifest.json`, "utf8"));
const found = new Map(JSON.parse(readFileSync(`${ROOT}/${WORK}/layers.json`, "utf8")).map((r) => [r.name, r]));

const http = spawn("python3", ["server/dev-server.py", "--port", String(PORT)], { cwd: ROOT, stdio: "ignore" });
process.on("exit", () => http.kill());
await new Promise((r) => setTimeout(r, 1000));

/** Every arm of every set: what the worker is handed and the hashes its frames must have. */
const arms = sets.flatMap((s) => {
  const n = Math.min(FRAMES, s.frames);
  const url = (c) => Array.from({ length: n }, (_, i) => `/${WORK}/${s.name}/${c}/${String(i).padStart(3, "0")}.${c.split("-")[0]}`);
  const f = found.get(s.name);
  const truth = s.truth.slice(0, n);
  const layer1 = f.layers.slice(0, n).map((l) => l[0]);
  const first = f.jxl["jxl-prog"].slice(0, n).map((j) => j.first);
  const fmt = { bits: s.stored, signed: s.signed, shift: s.shift };
  return [
    { set: s.name, arm: "htj2k", o: { arm: "htj2k", urls: url("htj2k"), ...fmt }, want: truth },
    { set: s.name, arm: "j2k layer 1", o: { arm: "opj", urls: url("j2k-layers"), lengths: layer1.map((l) => l.bytes), ...fmt },
      want: layer1.map((l) => l.digest) },
    { set: s.name, arm: "j2k all", o: { arm: "opj", urls: url("j2k-layers"), ...fmt }, want: truth },
    { set: s.name, arm: "jxl-prog first picture", o: { arm: "jxl", urls: url("jxl-prog"), lengths: first.map((j) => j.bytes), ...fmt },
      want: first.map((j) => j.digest) },
    { set: s.name, arm: "jxl-prog all", o: { arm: "jxl", urls: url("jxl-prog"), ...fmt }, want: truth },
    { set: s.name, arm: "jxl all", o: { arm: "jxl", urls: url("jxl"), ...fmt }, want: truth },
  ];
});

async function inChromium(throttle, round) {
  const server = await chromium.launchServer({ executablePath: process.env.CHROME_PATH || chromium.executablePath() });
  const browser = await chromium.connect(server.wsEndpoint());
  const page = await browser.newPage();
  await page.goto(`${BASE}/lab/av1/embed/index.html`);
  await page.waitForFunction(() => globalThis.ready);
  const stop = throttleTree(server.process().pid, throttle);
  const rows = [];
  for (const a of order(arms, round)) {
    const got = await page.evaluate((o) => globalThis.arm(o), a.o);
    const want = MUTATE ? a.want.map((h) => h.replace(/^./, (c) => (c === "0" ? "1" : "0"))) : a.want;
    const exact = got.hashes ? got.hashes.filter((h, i) => h === want[i]).length : 0;
    rows.push({ round, throttle, set: a.set, arm: a.arm, frames: a.want.length, exact, ms: got.ms, error: got.error });
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
      console.error(`round ${round} ${throttle}x ${r.set} ${r.arm}: ${r.exact}/${r.frames} ${r.error ?? ""}`);
    }
    console.error(`round ${round} ${throttle}x done`);
  }
}
if (OUT) writeFileSync(OUT, JSON.stringify(rows));

const med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
console.log("ms a frame, a set's frames in order in one worker: median of rounds [min–max], n; exact frames");
for (const throttle of THROTTLES) {
  for (const { set, arm } of arms) {
    const rs = rows.filter((r) => r.throttle === throttle && r.set === set && r.arm === arm);
    const per = rs.filter((r) => r.ms !== undefined).map((r) => r.ms / r.frames);
    const exact = `${rs.reduce((n, r) => n + r.exact, 0)}/${rs.reduce((n, r) => n + r.frames, 0)}`;
    const t = per.length ? `${med(per).toFixed(2)} [${Math.min(...per).toFixed(2)}–${Math.max(...per).toFixed(2)}] n=${per.length}` : `failed (${rs[0]?.error})`;
    console.log(`${throttle}x\t${set}\t${arm}\t${t}\texact ${exact}`);
  }
}
process.exit(0);
