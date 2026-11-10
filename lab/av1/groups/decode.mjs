/**
 * The groups protocol's in-order decode timing (docs/av1/groups.md §6.5): each round a fresh headless Chromium, the
 * series in a Williams row and every (stream, decoder) of a series in that round's row, every frame hashed against
 * native dav1d; rows written as each round ends, resumed from them.
 *
 *   NODE_PATH=… node lab/av1/groups/decode.mjs --work lab/.av1-work/groups --sets dbts_b1,usb_cine
 *     [--rounds 10] [--until EPOCH_MS] [--mutate hash] [--out rows.json]
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { relative } from "node:path";
import { order } from "../../order.mjs";

const { chromium } = createRequire(import.meta.url)("playwright");
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const ROOT = new URL("../../..", import.meta.url).pathname;
const WORK = arg("--work", "lab/.av1-work/groups");
const SETS = arg("--sets", "dbts_b1").split(",");
const ROUNDS = Number(arg("--rounds", 10));
const UNTIL = Number(arg("--until", Infinity));
const MUTATE = arg("--mutate", "");
const OUT = arg("--out", null);
const PORT = 30000 + ((Math.random() * 10000) | 0);

const http = spawn("python3", ["server/dev-server.py", "--port", String(PORT)], { cwd: ROOT, stdio: "ignore" });
process.on("exit", () => http.kill());
await new Promise((r) => setTimeout(r, 1000));

const series = SETS.map((s) => JSON.parse(readFileSync(`${ROOT}/${relative(ROOT, WORK)}/${s}.decode.json`, "utf8")));
const unitsOf = (e) => {
  const decoders = e.bits <= 10 ? ["dav1d", "webcodecs"] : ["dav1d"];
  const out = [];
  for (const dec of decoders) {
    for (const s of e.streams) out.push({ name: `${s.arm}|G${s.g}|Q${s.q}|${dec}`, dec, s });
    const o = e.streams.find((s) => s.arm === "O" && s.g === 1 && s.why === (e.reference ?? "anchor"));
    out.push({ name: `O'|G1|Q${o.q}|${dec}`, dec, s: o });
  }
  return out;
};

async function inChromium(round) {
  const server = await chromium.launchServer();
  const browser = await chromium.connect(server.wsEndpoint());
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${PORT}/lab/av1/groups/decode.html`);
  await page.waitForFunction(() => globalThis.ready);
  const rows = [];
  for (const e of order(series, round)) {
    let prev = null;
    for (const u of order(unitsOf(e), round)) {
      const got = await page.evaluate((x) => globalThis.unit(x), { file: `/${u.s.file}`, sizes: u.s.sizes, decoder: u.dec });
      const want = u.s.hashes.slice(0, u.s.sizes.length).map((h, i) => (MUTATE === "hash" && i === 1 ? `x${h}` : h));
      const matched = got.hashes ? got.hashes.filter((h, i) => h === want[i]).length : 0;
      rows.push({ round, set: e.name, unit: u.name, prev, arm: u.s.arm, g: u.s.g, q: u.s.q, why: u.s.why, dec: u.dec,
        ms: got.ms ?? null, matched, frames: want.length, error: got.error ?? null });
      if (got.error || matched !== want.length) console.error(`round ${round} ${e.name} ${u.name}: ${matched}/${want.length} ${got.error ?? ""}`);
      prev = u.name;
    }
  }
  await browser.close();
  await server.close();
  return rows;
}

const rows = OUT && existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : [];
let round = rows.length ? Math.max(...rows.map((r) => r.round)) + 1 : 0;
const more = (last) => (Number.isFinite(UNTIL) ? Date.now() + last < UNTIL : round < ROUNDS);
for (let last = 0; more(last); round++) {
  const t0 = Date.now();
  rows.push(...(await inChromium(round)));
  if (OUT) writeFileSync(OUT, JSON.stringify(rows));
  last = Date.now() - t0;
  console.error(`round ${round} done, ${(last / 1000).toFixed(0)} s`);
}
process.exit(0);
