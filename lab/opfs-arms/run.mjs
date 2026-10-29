// The cache arms in the view worker, one cell at a time: docs/adr/frame-path.md §The cache I/O in the view worker.
//
//   NODE_PATH=$(npm root -g) node lab/opfs-arms/run.mjs --cell late|rate|miss|drag|probe --size 512|2560|3328 [--throttle 1|4]
//     [--engine chromium|firefox] [--rounds 12] [--arms A-arrival,C,...] [--mutant write-before-paint|drop-writes|late-input]
//     [--out rows.jsonl]
import { execFileSync } from "node:child_process";
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { chromiumAt, chromiumPath, firefoxAt, staticHost, treePss } from "../opfs-cache/browser.mjs";
import { order } from "../order.mjs";
import { throttleTree } from "../scripts/cpu_throttle.mjs";

const HERE = new URL(".", import.meta.url).pathname;
const WORK = path.join(HERE, "work");
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const CELL = arg("--cell");
const ENGINE = arg("--engine", "chromium");
const SIZE = arg("--size", "512");
const THROTTLE = Number(arg("--throttle", 1));
const ROUNDS = Number(arg("--rounds", 12));
const MUTANT = arg("--mutant", "");
const OUT = path.resolve(arg("--out", path.join(WORK, `${CELL}-${ENGINE}-${SIZE}-${THROTTLE}x.jsonl`)));
mkdirSync(WORK, { recursive: true });

/** Width, height; 16-bit grey. */
const SIZES = { 512: [512, 512], 2560: [2560, 3328], 3328: [3328, 4096] };
/** The arms: the cache's thread and API, and the order of paint and write. C2 is C again, the A/A pair; D's decoders write. */
const ARMS = {
  none: { arm: "none" }, "A-arrival": { arm: "A", order: "arrival" }, "A-paint": { arm: "A", order: "paint" },
  "B-arrival": { arm: "B", order: "arrival" }, "B-paint": { arm: "B", order: "paint" }, C: { arm: "C" }, C2: { arm: "C" },
  D: { arm: "D" },
};
const CELLS = {
  late: ["none", "A-arrival", "A-paint", "B-arrival", "B-paint", "C", "C2", "D"],
  rate: ["A-arrival", "A-paint", "B-arrival", "B-paint", "C", "C2", "D"],
  miss: ["A-arrival", "B-arrival", "C", "C2", "D"],
  drag: ["none", "A-paint", "C", "C2", "D"],
};
const HELD = 4;
const SECONDS = 10;
const RATE_MBPS = 125;
const RATE_CELL_MB = 1000;
const DECODERS = 3;

function params(name) {
  const [w, h] = SIZES[SIZE];
  const mb = (w * h * 2) / 1e6;
  const late = Math.ceil((RATE_MBPS * SECONDS) / mb);
  const fill = { late, drag: late, rate: Math.ceil(RATE_CELL_MB / mb), miss: 32 }[CELL];
  return { cell: CELL, ...ARMS[name], mutant: MUTANT, w, h, n: HELD + fill, held: HELD, rate: RATE_MBPS, seconds: SECONDS,
    cineEvery: CELL === "drag" ? 0 : SIZE === "512" ? 1 : 6, budgetMs: 8, chunkBytes: 1 << 20, misses: 16, decoders: DECODERS };
}

async function browser(profile) {
  if (ENGINE === "chromium") return chromiumAt(profile, ["--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"]);
  return firefoxAt(profile, { "browser.cache.disk.enable": false, "browser.sessionstore.resume_from_crash": false });
}

async function once(origin, p) {
  const dir = mkdtempSync(path.join(WORK, "profile-"));
  const b = await browser(dir);
  const unthrottle = throttleTree(b.pid, THROTTLE);
  const baseline = treePss(b.pid);
  let peak = baseline;
  const sampler = setInterval(() => (peak = Math.max(peak, treePss(b.pid))), 1000);
  try {
    await b.page.goto(`${origin}/lab/opfs-arms/index.html?${new URLSearchParams(p)}`);
    const result = b.page.evaluate(() => globalThis.result);
    const dragging = p.cell === "drag" ? drag(b.page, result) : null;
    const r = await Promise.race([result, new Promise((res) => setTimeout(() => res({ error: "timed out" }), 300000))]);
    await dragging;
    return { ...r, peakGrowthMiB: peak - baseline };
  } finally {
    clearInterval(sampler);
    unthrottle();
    await b.context.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

/** A window drag held across the canvas, a pointer move every 16 ms, until the cell's result settles. */
async function drag(page, settled) {
  let done = false;
  settled.finally(() => (done = true));
  await page.mouse.move(10, 256);
  await page.mouse.down();
  for (let k = 0; !done; k++) {
    await page.mouse.move(10 + (k % 490), 256);
    await new Promise((res) => setTimeout(res, 16));
  }
  await page.mouse.up().catch(() => {});
}

const write = (row) => { appendFileSync(OUT, JSON.stringify(row) + "\n"); console.log(JSON.stringify(row).slice(0, 600)); };
const version = () => execFileSync(ENGINE === "firefox" ? process.env.FIREFOX_PATH : chromiumPath(), ["--version"]).toString().trim();
const host = () => ({ browser: version(), cpus: readFileSync("/proc/cpuinfo", "utf8").match(/^processor/gm).length,
  memMiB: Math.round(Number(/MemTotal:\s+(\d+)/.exec(readFileSync("/proc/meminfo", "utf8"))[1]) / 1024) });

/** Per row, the checks a mutant must fail: every write read back exact, lateness at least what the blocks predict, and
 *  an input held back seen at least as late as it was held. */
function checks(r, p) {
  if (r.error) return { ran: false };
  return { ran: true, writesVerified: p.arm === "none" ? null : r.complete && r.verify?.notOk === 0, lateAsPredicted: r.lateAsPredicted,
    lateInputAsPredicted: r.lateInputAsPredicted };
}

const origin = await staticHost();
if (CELL === "probe") {
  write({ cell: "probe", engine: ENGINE, host: host(), ...(await once(origin, { cell: "probe" })) });
  process.exit(0);
}
const arms = arg("--arms")?.split(",") ?? CELLS[CELL];
write({ settings: true, cell: CELL, engine: ENGINE, size: SIZE, throttle: THROTTLE, mutant: MUTANT || null, at: new Date().toISOString(), host: host(),
  arms: Object.fromEntries(arms.map((a) => [a, params(a)])) });
for (let round = 0; round < ROUNDS; round++) {
  let prev = null;
  for (const name of order(arms, round)) {
    const p = params(name);
    const r = await once(origin, p);
    const { config, ...rest } = r;
    write({ cell: CELL, engine: ENGINE, size: SIZE, throttle: THROTTLE, round, unit: name, prev, mutant: MUTANT || null, checks: checks(r, p), ...rest });
    prev = name;
  }
}
process.exit(0);
